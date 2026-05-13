import fs from "fs/promises"
import { createHash } from "crypto"
import path from "path"
import { operationPath, operationPlanRequiresCredentialHandoff, slug } from "./artifact"
import { hasExactCommandArg, hasExactCommandFlag } from "./command-text"
import {
  containsRawCredentialSecret,
  credentialIndexGaps,
  credentialSubmittedAtGaps,
  expectedCredentialServices,
  missingCredentialServices,
  validCredentialSubmittedAt,
} from "./credential-safety"
import { auditULMModelRoutes } from "./model-route-audit"
import { writeRuntimeGovernorRouteAudit } from "./runtime-governor"
import { acquireManifestTools } from "./tool-acquisition"

export type LaptopPreflightCheckStatus = "ok" | "warn" | "fail"

export type LaptopPreflightCheck = {
  id: string
  status: LaptopPreflightCheckStatus
  required: boolean
  detail: string
  path?: string
}

export type LaptopPreflightInput = {
  operationID: string
  targetHours?: number
  operatorConfirmed?: string[]
  preparePrerequisites?: boolean
  toolManifestPath?: string
  allowSyntheticCredentials?: boolean
  now?: () => Date
}

export type LaptopPreflightResult = {
  operationID: string
  status: "ready" | "blocked"
  targetHours: number
  checkedAt: string
  checks: LaptopPreflightCheck[]
  gaps: string[]
  warnings: string[]
  files: {
    json: string
    markdown: string
  }
}

const REQUIRED_OPERATOR_CONFIRMATIONS = [
  "operator-power",
  "operator-sleep",
  "operator-wifi",
  "operator-scope",
  "operator-clock",
] as const

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function writeBlockedToolPreflight(file: string, operationID: string, error: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        operationID,
        total: 1,
        available: 0,
        blocked: 1,
        installed: 0,
        installAttempted: false,
        tools: [
          {
            operationID,
            toolID: "tool-manifest",
            available: false,
            installed: false,
            blocker: error instanceof Error ? error.message : String(error),
            validationCommand: "read tool manifest",
            fallbacks: [],
          },
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  )
}

async function prepareLaptopPreflightPrerequisites(
  worktree: string,
  input: { operationID: string; toolManifestPath?: string; toolPreflightPath: string },
) {
  if (!(await exists(input.toolPreflightPath))) {
    await acquireManifestTools({
      worktree,
      operationID: input.operationID,
      manifestPath: input.toolManifestPath,
    }).catch((error) => writeBlockedToolPreflight(input.toolPreflightPath, input.operationID, error))
  }
  await auditULMModelRoutes({
    worktree,
    operationID: input.operationID,
    checkLaunchEnv: false,
    includeInstalled: false,
  }).catch(() => writeRuntimeGovernorRouteAudit(worktree, { operationID: input.operationID }).catch(() => undefined))
}

function numberArg(command: string[] | undefined, name: string) {
  const index = command?.indexOf(name) ?? -1
  if (!command || index === -1) return undefined
  const parsed = Number(command[index + 1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function outlineTargetPages(outline: string | undefined) {
  const match = outline?.match(/^\s*-\s*target_pages:\s*(\d+)\s*$/im)
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function requiredReportTargetPages(plan: { templateName?: string; template?: string } | undefined, targetHours: number) {
  if (plan?.templateName === "school-laptop-48h" || plan?.template === "school-laptop-48h") return 75
  return targetHours >= 20 ? 50 : 10
}

function check(input: LaptopPreflightCheck): LaptopPreflightCheck {
  return input
}

function sha256(content: string | undefined) {
  return content === undefined ? undefined : createHash("sha256").update(content).digest("hex")
}

function syntheticCredentialReason(credentials: unknown[]) {
  const synthetic = credentials
    .map((credential) => JSON.stringify(credential).toLowerCase())
    .find((text) => /\b(?:synthetic|rehearsal|placeholder|fixture|fake)\b/.test(text))
  return synthetic ? "credential review contains a synthetic credential placeholder" : undefined
}

function formatMarkdown(result: LaptopPreflightResult) {
  return [
    `# Laptop Preflight: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- target_hours: ${result.targetHours}`,
    `- checked_at: ${result.checkedAt}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Required | Detail |",
    "| --- | --- | --- | --- |",
    ...result.checks.map(
      (item) =>
        `| ${item.id} | ${item.status} | ${item.required ? "yes" : "no"} | ${item.detail.replaceAll("|", "\\|")} |`,
    ),
    "",
    "## Gaps",
    "",
    ...(result.gaps.length ? result.gaps.map((gap) => `- ${gap}`) : ["- none"]),
    "",
    "## Warnings",
    "",
    ...(result.warnings.length ? result.warnings.map((warning) => `- ${warning}`) : ["- none"]),
    "",
  ].join("\n")
}

export async function auditLaptopPreflight(
  worktree: string,
  input: LaptopPreflightInput,
): Promise<LaptopPreflightResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const targetHours = input.targetHours ?? 48
  const targetSeconds = targetHours * 60 * 60
  const confirmations = new Set((input.operatorConfirmed ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean))
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const planPath = path.join(root, "plans", "operation-plan.json")
  const goalPath = path.join(root, "goals", "operation-goal.json")
  const supervisorPath = path.join(root, "scheduler", "supervisor", "supervisor-manifest.json")
  const runbookPath = path.join(root, "scheduler", "supervisor", "supervisor-install.md")
  const toolPreflightPath = path.join(root, "tools", "tool-preflight.json")
  const modelRouteAuditPath = path.join(root, "deliverables", "model-route-audit.json")
  const credentialReviewPath = path.join(root, "credentials", "review-submission.json")
  const reportOutlinePath = path.join(root, "reports", "report-outline.md")
  const files = {
    json: path.join(root, "scheduler", "laptop-preflight.json"),
    markdown: path.join(root, "scheduler", "laptop-preflight.md"),
  }
  const checks: LaptopPreflightCheck[] = []
  const graph = await readJson<{ safetyMode?: string; lanes?: unknown[] }>(graphPath)
  const checkedAt = (input.now ?? (() => new Date()))().toISOString()
  const planText = await readText(planPath)
  const plan = planText
    ? (JSON.parse(planText) as {
        templateName?: string
        template?: string
        writtenAt?: string
        timeBudget?: { targetHours?: number }
      })
    : undefined
  const planSha256 = sha256(planText)
  const goal = await readJson<{ targetDurationHours?: number }>(goalPath)
  const supervisor = await readJson<{ command?: string[]; files?: Record<string, string | undefined> }>(supervisorPath)
  const runbook = await readText(runbookPath)
  if (input.preparePrerequisites) {
    await prepareLaptopPreflightPrerequisites(worktree, {
      operationID,
      toolManifestPath: input.toolManifestPath,
      toolPreflightPath,
    })
  }
  const toolPreflight = await readJson<{ total?: number; available?: number; blocked?: number }>(toolPreflightPath)
  const modelRouteAudit = await readJson<{ ok?: boolean; gaps?: unknown[] }>(modelRouteAuditPath)
  const modelRouteGaps = Array.isArray(modelRouteAudit?.gaps)
    ? modelRouteAudit.gaps.filter((gap): gap is string => typeof gap === "string")
    : []
  const reportOutline = await readText(reportOutlinePath)
  const targetPages = outlineTargetPages(reportOutline)
  const requiredTargetPages = requiredReportTargetPages(plan, targetHours)
  const requiresLaunchReadinessGate = plan?.templateName === "school-laptop-48h" || plan?.template === "school-laptop-48h"
  const runbookHasLaptopChecklist =
    runbook?.includes("48-Hour Laptop Checklist") === true &&
    runbook.includes("Disable sleep/hibernate/modern standby") &&
    runbook.includes("school Wi-Fi") &&
    runbook.includes("credential vault and redacted indexes")
  const runbookHasLaunchReadinessGate =
    runbook?.includes("Launch Readiness Gate") === true &&
    hasExactCommandFlag(runbook, "--require-launch-ready") &&
    hasExactCommandArg(runbook, "--operation-id", operationID)
  const credentialsRequired = operationPlanRequiresCredentialHandoff(plan)
  const credentialReview = await readJson<{ operationID?: string; submittedAt?: string; credentials?: unknown[]; file?: string }>(
    credentialReviewPath,
  )
  const credentialCount = Array.isArray(credentialReview?.credentials) ? credentialReview.credentials.length : 0
  const credentialOperationIDGap =
    credentialsRequired && credentialReview?.operationID && slug(credentialReview.operationID, "operation") !== operationID
      ? "credential review operation id does not match operation"
      : undefined
  const credentialFileReferenceGap =
    credentialsRequired && credentialReview?.file && path.resolve(credentialReview.file) !== path.resolve(credentialReviewPath)
      ? "credential review file reference is not canonical"
      : undefined
  const expectedCredentialServiceList = expectedCredentialServices(plan)
  const missingCredentialServiceList = missingCredentialServices(
    plan,
    Array.isArray(credentialReview?.credentials) ? credentialReview.credentials : [],
  )
  const credentialServiceGaps = missingCredentialServiceList.map(
    (service) => `credential review is missing a submitted record for plan service: ${service}`,
  )
  const credentialSubmittedAtValid = validCredentialSubmittedAt(credentialReview?.submittedAt)
  const submittedAtGaps = credentialSubmittedAtGaps(credentialReview?.submittedAt)
  const syntheticCredentialGap =
    credentialsRequired && targetHours >= 20 && !input.allowSyntheticCredentials && Array.isArray(credentialReview?.credentials)
      ? syntheticCredentialReason(credentialReview.credentials)
      : undefined
  const rawCredentialSecretGap =
    credentialsRequired && containsRawCredentialSecret(credentialReview?.credentials)
      ? "credential review contains raw secret fields instead of redacted records"
      : undefined
  const credentialIndexGapsList =
    credentialsRequired && Array.isArray(credentialReview?.credentials) ? credentialIndexGaps(credentialReview.credentials) : []
  const supervisorDurationSeconds = numberArg(supervisor?.command, "--duration-seconds")
  const planWrittenAtMs = typeof plan?.writtenAt === "string" ? Date.parse(plan.writtenAt) : Number.NaN
  const checkedAtMs = Date.parse(checkedAt)
  const preflightOlderThanPlan =
    Number.isFinite(planWrittenAtMs) && Number.isFinite(checkedAtMs) && checkedAtMs < planWrittenAtMs
  const credentialSubmittedAtMs = credentialSubmittedAtValid ? Date.parse(credentialReview!.submittedAt!) : Number.NaN
  const preflightOlderThanCredentialReview =
    Number.isFinite(checkedAtMs) && Number.isFinite(credentialSubmittedAtMs) && checkedAtMs < credentialSubmittedAtMs

  checks.push(
    check({
      id: "duration-plan",
      status:
        (goal?.targetDurationHours ?? 0) >= targetHours && (plan?.timeBudget?.targetHours ?? 0) >= targetHours
          ? "ok"
          : "fail",
      required: true,
      detail: `goal_target_hours=${goal?.targetDurationHours ?? "missing"}; plan_target_hours=${plan?.timeBudget?.targetHours ?? "missing"}; required_hours=${targetHours}`,
      path: planPath,
    }),
  )
  checks.push(
    check({
      id: "plan-freshness",
      status: preflightOlderThanPlan ? "fail" : "ok",
      required: true,
      detail: `plan_written_at=${plan?.writtenAt ?? "missing"}; preflight_checked_at=${checkedAt}; preflight_stale_plan=${preflightOlderThanPlan}`,
      path: planPath,
    }),
  )
  checks.push(
    check({
      id: "plan-fingerprint",
      status: planSha256 ? "ok" : "fail",
      required: true,
      detail: planSha256 ? `plan_sha256=${planSha256}` : "operation plan is missing",
      path: planPath,
    }),
  )
  checks.push(
    check({
      id: "operation-graph",
      status: graph?.safetyMode === "non_destructive" && Array.isArray(graph.lanes) && graph.lanes.length > 0 ? "ok" : "fail",
      required: true,
      detail: graph ? `safety=${graph.safetyMode}; lanes=${graph.lanes?.length ?? 0}` : "operation graph is missing",
      path: graphPath,
    }),
  )
  checks.push(
    check({
      id: "supervisor-manifest",
      status:
        supervisor && supervisorDurationSeconds !== undefined && supervisorDurationSeconds >= targetSeconds ? "ok" : "fail",
      required: true,
      detail: supervisor
        ? `duration_seconds=${supervisorDurationSeconds ?? "missing"}; launchd=${supervisor.files?.launchdPlist ? "yes" : "no"}; systemd=${supervisor.files?.systemdService ? "yes" : "no"}`
        : "supervisor manifest is missing",
      path: supervisorPath,
    }),
  )
  checks.push(
    check({
      id: "supervisor-runbook",
      status: runbookHasLaptopChecklist && (!requiresLaunchReadinessGate || runbookHasLaunchReadinessGate) ? "ok" : "fail",
      required: true,
      detail: runbook
        ? `runbook contains laptop handoff checklist; launch_readiness_gate=${requiresLaunchReadinessGate ? runbookHasLaunchReadinessGate : "not_required"}`
        : "supervisor install runbook is missing",
      path: runbookPath,
    }),
  )
  checks.push(
    check({
      id: "tool-preflight",
      status: toolPreflight ? (toolPreflight.blocked === 0 ? "ok" : "fail") : "fail",
      required: true,
      detail: toolPreflight
        ? `available=${toolPreflight.available ?? 0}/${toolPreflight.total ?? 0}; blocked=${toolPreflight.blocked ?? 0}`
        : "tool-preflight.json is missing",
      path: toolPreflightPath,
    }),
  )
  checks.push(
    check({
      id: "model-route-audit",
      status: modelRouteAudit?.ok === true || ((await exists(modelRouteAuditPath)) && modelRouteGaps.length === 0) ? "ok" : "fail",
      required: true,
      detail:
        modelRouteAudit?.ok === true || ((await exists(modelRouteAuditPath)) && modelRouteGaps.length === 0)
          ? "model route audit passed"
          : (await exists(modelRouteAuditPath))
            ? `model route audit failed: ${modelRouteGaps.join("; ") || "ok flag missing"}`
            : "model-route-audit.json is missing",
      path: modelRouteAuditPath,
    }),
  )
  checks.push(
    check({
      id: "report-outline",
      status: targetPages !== undefined && targetPages >= requiredTargetPages ? "ok" : "fail",
      required: true,
      detail: reportOutline
        ? `target_pages=${targetPages ?? "missing"}; required_min_target_pages=${requiredTargetPages}`
        : "report-outline.md is missing",
      path: reportOutlinePath,
    }),
  )
  checks.push(
    check({
      id: "credential-vault",
      status:
        !credentialsRequired ||
        (credentialSubmittedAtValid &&
          credentialCount > 0 &&
          !credentialOperationIDGap &&
          !credentialFileReferenceGap &&
          !syntheticCredentialGap &&
          !rawCredentialSecretGap &&
          !preflightOlderThanCredentialReview &&
          credentialIndexGapsList.length === 0 &&
          credentialServiceGaps.length === 0)
          ? "ok"
          : "fail",
      required: credentialsRequired,
      detail: credentialsRequired
        ? [
            `submitted_at=${credentialReview?.submittedAt ?? "missing"}`,
            `expected_services=${expectedCredentialServiceList.length ? expectedCredentialServiceList.join(",") : "none"}`,
            `credential_count=${credentialCount}`,
            credentialSubmittedAtValid && credentialCount > 0
              ? undefined
              : `open_vault=operation_credentials action=open_vault operationID=${slug(operationID, "operation")}`,
            credentialSubmittedAtValid && credentialCount > 0
              ? undefined
              : `vault_path=/ulm/credentials?operationID=${encodeURIComponent(slug(operationID, "operation"))}`,
            ...submittedAtGaps,
            credentialOperationIDGap,
            credentialFileReferenceGap,
            preflightOlderThanCredentialReview
              ? `credential review was submitted after preflight check: submitted_at=${credentialReview?.submittedAt}; preflight_checked_at=${checkedAt}`
              : undefined,
            syntheticCredentialGap,
            rawCredentialSecretGap,
            ...credentialIndexGapsList,
            ...credentialServiceGaps,
          ]
            .filter((item): item is string => item !== undefined)
            .join("; ")
        : "credential handoff is not required by plan",
      path: credentialReviewPath,
    }),
  )
  for (const id of REQUIRED_OPERATOR_CONFIRMATIONS) {
    const confirmation = id.replace("operator-", "")
    checks.push(
      check({
        id,
        status: confirmations.has(confirmation) ? "ok" : "fail",
        required: true,
        detail: confirmations.has(confirmation) ? "operator confirmed" : `operator confirmation missing: ${confirmation}`,
      }),
    )
  }

  const gaps = checks
    .filter((item) => item.required && item.status === "fail")
    .map((item) => `${item.id}: ${item.detail}`)
  const warnings = checks
    .filter((item) => item.status === "warn")
    .map((item) => `${item.id}: ${item.detail}`)
  const result: LaptopPreflightResult = {
    operationID,
    status: gaps.length ? "blocked" : "ready",
    targetHours,
    checkedAt,
    checks,
    gaps,
    warnings,
    files,
  }
  await fs.mkdir(path.dirname(files.json), { recursive: true })
  await fs.writeFile(files.json, JSON.stringify(result, null, 2) + "\n")
  await fs.writeFile(files.markdown, formatMarkdown(result))
  return result
}

export function formatLaptopPreflight(result: LaptopPreflightResult) {
  return [
    `# Laptop Preflight: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- target_hours: ${result.targetHours}`,
    `- gaps: ${result.gaps.length}`,
    `- warnings: ${result.warnings.length}`,
    `- json: ${result.files.json}`,
    `- markdown: ${result.files.markdown}`,
  ].join("\n")
}
