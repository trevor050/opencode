import fs from "fs/promises"
import path from "path"
import { operationPath, operationPlanRequiresCredentialHandoff, slug } from "./artifact"
import {
  containsRawCredentialSecret,
  credentialIndexGaps,
  credentialSubmittedAtGaps,
  expectedCredentialServices,
  missingCredentialServices,
  validCredentialSubmittedAt,
} from "./credential-safety"

export type LiteralRunReadinessStatus = "passed" | "ready" | "incomplete" | "blocked"
export type LiteralRunCheckStatus = "ok" | "warn" | "fail"

export type LiteralRunReadinessInput = {
  operationID: string
  targetElapsedSeconds?: number
  now?: () => Date
}

export type LiteralRunCheck = {
  id: string
  status: LiteralRunCheckStatus
  required: boolean
  detail: string
  path?: string
}

export type LiteralRunReadinessResult = {
  operationID: string
  status: LiteralRunReadinessStatus
  targetElapsedSeconds: number
  checkedAt: string
  literalElapsedSeconds?: number
  checks: LiteralRunCheck[]
  gaps: string[]
  auditPath: string
  markdownPath: string
}

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

async function finalManifestArtifactExists(finalDir: string, artifactPath: unknown) {
  if (typeof artifactPath !== "string" || !artifactPath.trim()) return false
  const resolved = path.resolve(finalDir, artifactPath)
  if (!resolved.startsWith(finalDir + path.sep)) return false
  return exists(resolved)
}

function finalManifestArtifactPath(finalDir: string, artifactPath: unknown) {
  if (typeof artifactPath !== "string" || !artifactPath.trim()) return undefined
  const resolved = path.resolve(finalDir, artifactPath)
  return resolved.startsWith(finalDir + path.sep) ? resolved : undefined
}

function pdfPageCount(pdf: string | undefined) {
  const match = pdf?.match(/\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)/)
  const pages = Number.parseInt(match?.[1] ?? "", 10)
  return Number.isFinite(pages) && pages > 0 ? pages : undefined
}

async function finalStakeholderPackageGaps(finalDir: string, artifacts: Record<string, unknown> | undefined) {
  if (!artifacts) return ["stakeholder artifacts object is missing"]
  const textChecks = [
    { key: "html", label: "report.html", terms: ["<!doctype html", "Finding State Counts", "Operation:"] },
    { key: "readme", label: "README.md", terms: ["## Files", "## Findings", "## Evidence"] },
    { key: "operatorReview", label: "operator-review.md", terms: ["Operation:", "## Handoff State", "## Review Before Client Delivery"] },
    { key: "executiveSummary", label: "executive-summary.md", terms: ["Operation:", "## Overview", "## Priority Items"] },
    { key: "technicalAppendix", label: "technical-appendix.md", terms: ["Operation:", "## Scope And Methodology", "## Evidence Index"] },
    { key: "boardReport", label: "board-report.md", terms: ["Operation:", "## Executive Decision Summary", "## Recommended Board Actions"] },
    { key: "cehTechnicalReport", label: "ceh-technical-report.md", terms: ["Operation:", "## Scope And Methodology", "## Validated Findings", "## Evidence Map"] },
    { key: "ulmTeamReport", label: "ulm-team-report.md", terms: ["Operation:", "## Harness Run State", "## Residual Harness Risks"] },
    { key: "runtimeSummaryMarkdown", label: "runtime-summary.md", terms: ["# Runtime Summary"] },
  ]
  const pdfChecks = [
    { key: "pdf", label: "report.pdf" },
    { key: "boardReportPdf", label: "board-report.pdf" },
    { key: "cehTechnicalReportPdf", label: "ceh-technical-report.pdf" },
    { key: "ulmTeamReportPdf", label: "ulm-team-report.pdf" },
  ]
  const gaps: string[] = []
  for (const item of textChecks) {
    const file = finalManifestArtifactPath(finalDir, artifacts[item.key])
    const body = file ? await readText(file) : undefined
    if (!body?.trim()) {
      gaps.push(`${item.label}:empty`)
      continue
    }
    for (const term of item.terms) {
      if (!body.includes(term)) gaps.push(`${item.label}:missing:${term}`)
    }
  }
  for (const item of pdfChecks) {
    const file = finalManifestArtifactPath(finalDir, artifacts[item.key])
    const body = file ? await readText(file) : undefined
    if (!body?.startsWith("%PDF-")) {
      gaps.push(`${item.label}:not-pdf`)
      continue
    }
    if (!body.includes("/ULMCodeRenderer (styled-html)")) gaps.push(`${item.label}:missing-styled-renderer`)
    if (!pdfPageCount(body)) gaps.push(`${item.label}:page-count-missing`)
  }
  return gaps
}

function numberArg(command: string[] | undefined, name: string) {
  if (!command) return undefined
  const index = command.indexOf(name)
  if (index === -1) return undefined
  const parsed = Number(command[index + 1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function check(input: LiteralRunCheck): LiteralRunCheck {
  return input
}

const runtimeProofChecks = new Set([
  "literal-runtime-proof",
  "daemon-heartbeat-continuity",
  "literal-work-proof",
  "laptop-preflight-proof",
  "laptop-preflight-bypass",
])
const handoffProofChecks = new Set([
  "final-package",
  "final-operation-audit",
  "credential-handoff-proof",
  "report-outline-proof",
])
const requiredFinalManifestArtifacts = [
  "html",
  "pdf",
  "readme",
  "findingsJson",
  "evidenceIndex",
  "peopleProfiles",
  "identityGraph",
  "operatorReview",
  "executiveSummary",
  "technicalAppendix",
  "boardReport",
  "boardReportPdf",
  "cehTechnicalReport",
  "cehTechnicalReportPdf",
  "ulmTeamReport",
  "ulmTeamReportPdf",
  "runtimeSummaryMarkdown",
] as const

function statusFor(checks: LiteralRunCheck[], literalElapsedSeconds: number | undefined, targetElapsedSeconds: number) {
  const requiredSetupFailed = checks.some(
    (item) => item.required && item.status === "fail" && !runtimeProofChecks.has(item.id) && !handoffProofChecks.has(item.id),
  )
  if (requiredSetupFailed) return "blocked"
  if (checks.some((item) => runtimeProofChecks.has(item.id) && item.status === "fail")) return "incomplete"
  if (
    literalElapsedSeconds !== undefined &&
    literalElapsedSeconds >= targetElapsedSeconds &&
    !checks.some((item) => item.required && item.status === "fail")
  ) {
    return "passed"
  }
  if (checks.some((item) => handoffProofChecks.has(item.id) && item.status === "fail")) return "incomplete"
  return "ready"
}

function countItems(input: unknown) {
  return Array.isArray(input) ? input.length : 0
}

function syntheticCredentialReason(credentials: unknown[]) {
  const synthetic = credentials
    .map((credential) => JSON.stringify(credential).toLowerCase())
    .find((text) => /\b(?:synthetic|rehearsal|placeholder|fixture|fake)\b/.test(text))
  return synthetic ? "credential review contains a synthetic credential placeholder" : undefined
}

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function reportOutlineTargetPages(outline: string | undefined) {
  const match = outline?.match(/^\s*-\s*target_pages:\s*(\d+)\s*$/im)
  const pages = Number.parseInt(match?.[1] ?? "", 10)
  return Number.isFinite(pages) ? pages : undefined
}

function requiredReportTargetPages(
  operationPlan: { templateName?: string; template?: string; timeBudget?: { targetHours?: number } } | undefined,
  requiresLongRunProof: boolean,
) {
  if (operationPlan?.templateName === "school-laptop-48h" || operationPlan?.template === "school-laptop-48h") return 75
  return requiresLongRunProof || (operationPlan?.timeBudget?.targetHours ?? 0) >= 20 ? 50 : undefined
}

function operationIDMatches(value: string | undefined, operationID: string) {
  return typeof value === "string" && slug(value, "operation") === operationID
}

function workProofFromHeartbeat(heartbeat: {
  cycles?: Array<{
    launchedJobs?: unknown[]
    launchedCommandJobs?: unknown[]
    run?: {
      completedLanes?: unknown[]
      failedLanes?: unknown[]
      syncedJobs?: unknown[]
      completedWorkUnits?: unknown[]
      failedWorkUnits?: unknown[]
    }
  }>
  recoveredJobs?: unknown[]
}) {
  const cycleCounts = (heartbeat.cycles ?? []).reduce(
    (acc, cycle) => ({
      modelLaunches: acc.modelLaunches + countItems(cycle.launchedJobs),
      commandLaunches: acc.commandLaunches + countItems(cycle.launchedCommandJobs),
      completedLanes: acc.completedLanes + countItems(cycle.run?.completedLanes),
      failedLanes: acc.failedLanes + countItems(cycle.run?.failedLanes),
      syncedJobs: acc.syncedJobs + countItems(cycle.run?.syncedJobs),
      completedWorkUnits: acc.completedWorkUnits + countItems(cycle.run?.completedWorkUnits),
      failedWorkUnits: acc.failedWorkUnits + countItems(cycle.run?.failedWorkUnits),
    }),
    {
      modelLaunches: 0,
      commandLaunches: 0,
      completedLanes: 0,
      failedLanes: 0,
      syncedJobs: 0,
      completedWorkUnits: 0,
      failedWorkUnits: 0,
    },
  )
  return {
    ...cycleCounts,
    recoveries: countItems(heartbeat.recoveredJobs),
    total:
      cycleCounts.modelLaunches +
      cycleCounts.commandLaunches +
      cycleCounts.completedLanes +
      cycleCounts.failedLanes +
      cycleCounts.syncedJobs +
      cycleCounts.completedWorkUnits +
      cycleCounts.failedWorkUnits +
      countItems(heartbeat.recoveredJobs),
  }
}

function parseDaemonLogEntries(log: string | undefined) {
  if (!log?.trim()) return []
  return log
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as { startedAt?: string; updatedAt?: string; endedAt?: string; elapsedSeconds?: number }
        return [parsed]
      } catch {
        return []
      }
    })
}

function daemonLogContinuity(log: string | undefined, targetElapsedSeconds: number) {
  const entries = parseDaemonLogEntries(log)
  const times = entries.flatMap((entry) => [timestamp(entry.startedAt), timestamp(entry.updatedAt), timestamp(entry.endedAt)]).filter((time): time is number => time !== undefined)
  const elapsedValues = entries.map((entry) => entry.elapsedSeconds).filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  const firstTime = times.length ? Math.min(...times) : undefined
  const lastTime = times.length ? Math.max(...times) : undefined
  const spanSeconds = firstTime !== undefined && lastTime !== undefined ? (lastTime - firstTime) / 1000 : undefined
  const maxElapsed = elapsedValues.length ? Math.max(...elapsedValues) : undefined
  const continuous =
    entries.length >= 3 &&
    ((spanSeconds !== undefined && spanSeconds >= targetElapsedSeconds) ||
      (maxElapsed !== undefined && maxElapsed >= targetElapsedSeconds))
  return { entries: entries.length, spanSeconds, maxElapsed, continuous }
}

async function cliLaunchProof(root: string, input: { startedAt?: number; endedAt?: number }) {
  const dir = path.join(root, "scheduler", "cli-launches")
  try {
    const files = await fs.readdir(dir)
    return (
      await Promise.all(
        files.map(async (file) => {
          try {
            const record = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as { createdAt?: string }
            const createdAt = timestamp(record.createdAt)
            if (input.startedAt !== undefined && (createdAt === undefined || createdAt < input.startedAt)) return undefined
            if (input.endedAt !== undefined && (createdAt === undefined || createdAt > input.endedAt)) return undefined
            return file
          } catch {
            return undefined
          }
        }),
      )
    )
      .filter((file): file is string => !!file)
      .reduce(
        (acc, file) => ({
          modelLaunches: acc.modelLaunches + (file.includes("-model-") && !file.includes("-model-reuse-") ? 1 : 0),
          commandLaunches: acc.commandLaunches + (file.includes("-command-") ? 1 : 0),
        }),
      { modelLaunches: 0, commandLaunches: 0 },
      )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { modelLaunches: 0, commandLaunches: 0 }
    throw error
  }
}

function formatMarkdown(result: LiteralRunReadinessResult) {
  return [
    `# Literal 20-Hour Run Readiness: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- target_elapsed_seconds: ${result.targetElapsedSeconds}`,
    `- literal_elapsed_seconds: ${result.literalElapsedSeconds ?? "not proven"}`,
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
  ].join("\n")
}

export async function auditLiteralRunReadiness(
  worktree: string,
  input: LiteralRunReadinessInput,
): Promise<LiteralRunReadinessResult> {
  const operationID = slug(input.operationID, "operation")
  const targetElapsedSeconds = Math.max(1, Math.floor(input.targetElapsedSeconds ?? 20 * 60 * 60))
  const root = operationPath(worktree, operationID)
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const operationGoalPath = path.join(root, "goals", "operation-goal.json")
  const operationPlanPath = path.join(root, "plans", "operation-plan.json")
  const supervisorManifestPath = path.join(root, "scheduler", "supervisor", "supervisor-manifest.json")
  const laptopPreflightPath = path.join(root, "scheduler", "laptop-preflight.json")
  const laptopPreflightBypassPath = path.join(root, "scheduler", "laptop-preflight-bypass.json")
  const daemonHeartbeatPath = path.join(root, "scheduler", "daemon-heartbeat.json")
  const daemonLogPath = path.join(root, "scheduler", "daemon.jsonl")
  const burnInProofPath = path.join(root, "burnin", "burnin-proof.json")
  const toolPreflightPath = path.join(root, "tools", "tool-preflight.json")
  const modelRouteAuditPath = path.join(root, "deliverables", "model-route-audit.json")
  const reportOutlinePath = path.join(root, "reports", "report-outline.md")
  const finalManifestPath = path.join(root, "deliverables", "final", "manifest.json")
  const finalAuditPath = path.join(root, "deliverables", "operation-audit.json")
  const credentialReviewPath = path.join(root, "credentials", "review-submission.json")
  const auditPath = path.join(root, "scheduler", "literal-run-readiness.json")
  const markdownPath = path.join(root, "scheduler", "literal-run-readiness.md")
  const checks: LiteralRunCheck[] = []

  const graph = await readJson<{ safetyMode?: string; lanes?: unknown[] }>(graphPath)
  const operationGoal = await readJson<{ targetDurationHours?: number }>(operationGoalPath)
  const operationPlan = await readJson<{ templateName?: string; template?: string; timeBudget?: { targetHours?: number } }>(
    operationPlanPath,
  )
  const requiresLongRunProof = targetElapsedSeconds >= 20 * 60 * 60
  const targetHours = targetElapsedSeconds / (60 * 60)
  const requiredAuditMinOutlineTargetPages = requiredReportTargetPages(operationPlan, requiresLongRunProof)
  const requiredAuditMinPdfPages = requiredAuditMinOutlineTargetPages
  const requiresCredentialHandoff = operationPlanRequiresCredentialHandoff(operationPlan)
  const credentialReview = await readJson<{ operationID?: string; submittedAt?: string; credentials?: unknown[]; file?: string }>(
    credentialReviewPath,
  )
  const credentialReviewCount = countItems(credentialReview?.credentials)
  const credentialOperationIDGap =
    requiresCredentialHandoff && credentialReview?.operationID && !operationIDMatches(credentialReview.operationID, operationID)
      ? "credential review operation id does not match operation"
      : undefined
  const credentialFileReferenceGap =
    requiresCredentialHandoff && credentialReview?.file && path.resolve(credentialReview.file) !== path.resolve(credentialReviewPath)
      ? "credential review file reference is not canonical"
      : undefined
  const expectedCredentialServiceList = expectedCredentialServices(operationPlan)
  const missingCredentialServiceList = missingCredentialServices(
    operationPlan,
    Array.isArray(credentialReview?.credentials) ? credentialReview.credentials : [],
  )
  const credentialServiceGaps = missingCredentialServiceList.map(
    (service) => `credential review is missing a submitted record for plan service: ${service}`,
  )
  const credentialReviewTime = timestamp(credentialReview?.submittedAt)
  const credentialSubmittedAtValid = validCredentialSubmittedAt(credentialReview?.submittedAt)
  const submittedAtGaps = credentialSubmittedAtGaps(credentialReview?.submittedAt)
  const syntheticCredentialGap =
    requiresCredentialHandoff && Array.isArray(credentialReview?.credentials)
      ? syntheticCredentialReason(credentialReview.credentials)
      : undefined
  const rawCredentialSecretGap =
    requiresCredentialHandoff && containsRawCredentialSecret(credentialReview?.credentials)
      ? "credential review contains raw secret fields instead of redacted records"
      : undefined
  const credentialIndexGapsList =
    requiresCredentialHandoff && Array.isArray(credentialReview?.credentials) ? credentialIndexGaps(credentialReview.credentials) : []
  const reportOutline = await readText(reportOutlinePath)
  const outlineTargetPages = reportOutlineTargetPages(reportOutline)
  const heartbeat = await readJson<{
    operationID?: string
    elapsedSeconds?: number
    startedAt?: string
    endedAt?: string
    updatedAt?: string
    reason?: string
    cycles?: Array<{
      launchedJobs?: unknown[]
      launchedCommandJobs?: unknown[]
      run?: {
        completedLanes?: unknown[]
        failedLanes?: unknown[]
        syncedJobs?: unknown[]
        completedWorkUnits?: unknown[]
        failedWorkUnits?: unknown[]
      }
    }>
    recoveredJobs?: unknown[]
  }>(daemonHeartbeatPath)
  const literalElapsedSeconds = heartbeat?.elapsedSeconds
  const heartbeatOperationMatches = operationIDMatches(heartbeat?.operationID, operationID)
  const heartbeatStartedAt = timestamp(heartbeat?.startedAt)
  const heartbeatTime = timestamp(heartbeat?.endedAt) ?? timestamp(heartbeat?.updatedAt)
  const credentialAfterHeartbeatGap =
    requiresCredentialHandoff &&
    credentialReviewTime !== undefined &&
    heartbeatTime !== undefined &&
    credentialReviewTime > heartbeatTime
      ? "credential review was submitted after daemon ended"
      : undefined
  const credentialAfterDaemonStartGap =
    requiresCredentialHandoff &&
    credentialReviewTime !== undefined &&
    heartbeatStartedAt !== undefined &&
    credentialReviewTime > heartbeatStartedAt
      ? "credential review was submitted after daemon started"
      : undefined
  const credentialBeforeDaemonStart =
    requiresCredentialHandoff &&
    credentialReviewTime !== undefined &&
    heartbeatStartedAt !== undefined &&
    credentialReviewTime <= heartbeatStartedAt
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
      id: "duration-plan-proof",
      status:
        !requiresLongRunProof ||
        ((operationGoal?.targetDurationHours ?? 0) >= targetHours && (operationPlan?.timeBudget?.targetHours ?? 0) >= targetHours)
          ? "ok"
          : "fail",
      required: requiresLongRunProof,
      detail: requiresLongRunProof
        ? `goal_target_hours=${operationGoal?.targetDurationHours ?? "missing"}; plan_target_hours=${operationPlan?.timeBudget?.targetHours ?? "missing"}; required_hours=${targetHours}`
        : "duration-sized plan proof is not required",
      path: operationPlanPath,
    }),
  )

  const supervisor = await readJson<{ command?: string[]; files?: Record<string, string | undefined> }>(supervisorManifestPath)
  const supervisorDurationSeconds = numberArg(supervisor?.command, "--duration-seconds")
  checks.push(
    check({
      id: "service-supervisor",
      status:
        supervisor && supervisorDurationSeconds !== undefined && supervisorDurationSeconds >= targetElapsedSeconds ? "ok" : "fail",
      required: false,
      detail: supervisor
        ? `duration_seconds=${supervisorDurationSeconds ?? "missing"}; launchd=${supervisor.files?.launchdPlist ? "yes" : "no"}; systemd=${supervisor.files?.systemdService ? "yes" : "no"}`
        : "launchd/systemd supervisor manifest is missing",
      path: supervisorManifestPath,
    }),
  )

  const burnIn = await readJson<{ auditStatus?: string; elapsedTargetSeconds?: number; simulatedElapsedSeconds?: number }>(
    burnInProofPath,
  )
  checks.push(
    check({
      id: "accelerated-burnin-proof",
      status:
        burnIn?.auditStatus === "passed" &&
        (burnIn.elapsedTargetSeconds ?? 0) >= targetElapsedSeconds &&
        (burnIn.simulatedElapsedSeconds ?? 0) >= targetElapsedSeconds
          ? "ok"
          : "warn",
      required: false,
      detail: burnIn
        ? `audit=${burnIn.auditStatus}; simulated_elapsed_seconds=${burnIn.simulatedElapsedSeconds ?? "missing"}`
        : "accelerated burn-in proof is missing",
      path: burnInProofPath,
    }),
  )

  const toolPreflight = await readJson<{ total?: number; available?: number; blocked?: number }>(toolPreflightPath)
  checks.push(
    check({
      id: "tool-preflight",
      status: toolPreflight ? (toolPreflight.blocked === 0 ? "ok" : requiresLongRunProof ? "fail" : "warn") : requiresLongRunProof ? "fail" : "warn",
      required: requiresLongRunProof,
      detail: toolPreflight
        ? `available=${toolPreflight.available ?? 0}/${toolPreflight.total ?? 0}; blocked=${toolPreflight.blocked ?? 0}`
        : "tool-preflight.json is missing",
      path: toolPreflightPath,
    }),
  )

  checks.push(
    check({
      id: "model-route-audit",
      status: (await exists(modelRouteAuditPath)) ? "ok" : requiresLongRunProof ? "fail" : "warn",
      required: requiresLongRunProof,
      detail: (await exists(modelRouteAuditPath)) ? "model route audit exists" : "model-route-audit.json is missing",
      path: modelRouteAuditPath,
    }),
  )
  checks.push(
    check({
      id: "credential-handoff-proof",
      status:
        !requiresCredentialHandoff ||
        (credentialSubmittedAtValid &&
          credentialReviewCount > 0 &&
          !credentialOperationIDGap &&
          !credentialFileReferenceGap &&
          !credentialAfterHeartbeatGap &&
          !credentialAfterDaemonStartGap &&
          !syntheticCredentialGap &&
          !rawCredentialSecretGap &&
          credentialIndexGapsList.length === 0 &&
          credentialServiceGaps.length === 0)
          ? "ok"
          : "fail",
      required: requiresCredentialHandoff,
      detail: requiresCredentialHandoff
        ? `submitted_at=${credentialReview?.submittedAt ?? "missing"}; expected_services=${expectedCredentialServiceList.length ? expectedCredentialServiceList.join(",") : "none"}; credential_count=${credentialReviewCount}${
            credentialOperationIDGap ? `; ${credentialOperationIDGap}` : ""
          }${credentialFileReferenceGap ? `; ${credentialFileReferenceGap}` : ""}${
            credentialAfterHeartbeatGap ? `; ${credentialAfterHeartbeatGap}` : ""
          }${
            credentialAfterDaemonStartGap ? `; ${credentialAfterDaemonStartGap}` : ""
          }; credential_before_daemon_start=${credentialBeforeDaemonStart ? "true" : "false"}${
            heartbeatStartedAt !== undefined ? `; daemon_started_at=${heartbeat?.startedAt ?? "missing"}` : ""
          }${
            syntheticCredentialGap ? `; ${syntheticCredentialGap}` : ""
          }${rawCredentialSecretGap ? `; ${rawCredentialSecretGap}` : ""}${
            credentialIndexGapsList.length ? `; ${credentialIndexGapsList.join("; ")}` : ""
          }${credentialServiceGaps.length ? `; ${credentialServiceGaps.join("; ")}` : ""}${
            submittedAtGaps.length ? `; ${submittedAtGaps.join("; ")}` : ""
          }`
        : "credentialed plan proof is not required",
      path: credentialReviewPath,
    }),
  )
  checks.push(
    check({
      id: "report-outline-proof",
      status:
        requiredAuditMinOutlineTargetPages === undefined || (outlineTargetPages ?? 0) >= requiredAuditMinOutlineTargetPages
          ? "ok"
          : "fail",
      required: requiredAuditMinOutlineTargetPages !== undefined,
      detail:
        requiredAuditMinOutlineTargetPages === undefined
          ? "long-report outline proof is not required"
          : `target_pages=${outlineTargetPages ?? "missing"}; required_min_outline_target_pages=${requiredAuditMinOutlineTargetPages}`,
      path: reportOutlinePath,
    }),
  )
  const laptopPreflight = await readJson<{ operationID?: string; status?: string; targetHours?: number; gaps?: string[] }>(
    laptopPreflightPath,
  )
  const laptopPreflightTargetSeconds = (laptopPreflight?.targetHours ?? 0) * 60 * 60
  const laptopPreflightOk =
    !requiresLongRunProof ||
    (operationIDMatches(laptopPreflight?.operationID, operationID) &&
      laptopPreflight?.status === "ready" &&
      laptopPreflightTargetSeconds >= targetElapsedSeconds)
  checks.push(
    check({
      id: "laptop-preflight-proof",
      status: laptopPreflightOk ? "ok" : "fail",
      required: requiresLongRunProof,
      detail: laptopPreflight
        ? `preflight_operation_id=${laptopPreflight.operationID ?? "missing"}; selected_operation_id=${operationID}; status=${laptopPreflight.status ?? "missing"}; target_hours=${laptopPreflight.targetHours ?? "missing"}; gaps=${laptopPreflight.gaps?.length ? laptopPreflight.gaps.join("; ") : "none"}`
        : requiresLongRunProof
          ? "laptop-preflight.json is missing"
          : "laptop preflight proof is not required",
      path: laptopPreflightPath,
    }),
  )
  const laptopPreflightBypass = await readJson<{ reason?: string; durationSeconds?: number }>(laptopPreflightBypassPath)
  checks.push(
    check({
      id: "laptop-preflight-bypass",
      status: !requiresLongRunProof || !laptopPreflightBypass ? "ok" : "fail",
      required: requiresLongRunProof,
      detail: laptopPreflightBypass
        ? `controlled test bypass present; duration_seconds=${laptopPreflightBypass.durationSeconds ?? "missing"}; reason=${laptopPreflightBypass.reason ?? "missing"}`
        : "no long-run laptop preflight bypass artifact is present",
      path: laptopPreflightBypassPath,
    }),
  )

  const log = await readText(daemonLogPath)
  const continuity = daemonLogContinuity(log, targetElapsedSeconds)
  const workProof = heartbeat ? workProofFromHeartbeat(heartbeat) : undefined
  const cliProof = await cliLaunchProof(root, { startedAt: heartbeatStartedAt, endedAt: heartbeatTime })
  const combinedWorkProof = workProof
    ? {
        ...workProof,
        modelLaunches: workProof.modelLaunches + cliProof.modelLaunches,
        commandLaunches: workProof.commandLaunches + cliProof.commandLaunches,
        total: workProof.total + cliProof.modelLaunches + cliProof.commandLaunches,
      }
    : undefined
  checks.push(
    check({
      id: "literal-runtime-proof",
      status:
        heartbeatOperationMatches &&
        literalElapsedSeconds !== undefined &&
        literalElapsedSeconds >= targetElapsedSeconds &&
        !!log?.trim()
          ? "ok"
          : "fail",
      required: true,
      detail: heartbeat
        ? `heartbeat_operation_id=${heartbeat.operationID ?? "missing"}; selected_operation_id=${operationID}; elapsed_seconds=${literalElapsedSeconds ?? "missing"}; reason=${heartbeat.reason ?? "missing"}; log=${log?.trim() ? "present" : "missing"}`
        : "daemon heartbeat is missing; no wall-clock run proof exists",
      path: daemonHeartbeatPath,
    }),
  )
  checks.push(
    check({
      id: "daemon-heartbeat-continuity",
      status: continuity.continuous ? "ok" : "fail",
      required: true,
      detail: `entries=${continuity.entries}; span_seconds=${continuity.spanSeconds ?? "missing"}; max_elapsed_seconds=${continuity.maxElapsed ?? "missing"}`,
      path: daemonLogPath,
    }),
  )
  checks.push(
    check({
      id: "literal-work-proof",
      status: combinedWorkProof && combinedWorkProof.total > 0 ? "ok" : "fail",
      required: true,
      detail: combinedWorkProof
        ? `model_launches=${combinedWorkProof.modelLaunches}; command_launches=${combinedWorkProof.commandLaunches}; completed_lanes=${combinedWorkProof.completedLanes}; synced_jobs=${combinedWorkProof.syncedJobs}; recoveries=${combinedWorkProof.recoveries}`
        : "daemon heartbeat is missing; no lane launch, command launch, recovery, or completion proof exists",
      path: daemonHeartbeatPath,
    }),
  )

  const finalManifest = await readJson<{ operationID?: string; generatedAt?: string; artifacts?: Record<string, unknown> }>(finalManifestPath)
  const finalManifestExists = finalManifest !== undefined
  const finalManifestOperationMatches = operationIDMatches(finalManifest?.operationID, operationID)
  const missingFinalManifestArtifacts = requiredFinalManifestArtifacts.filter(
    (key) => typeof finalManifest?.artifacts?.[key] !== "string" || !finalManifest.artifacts[key],
  )
  const finalDir = path.dirname(finalManifestPath)
  const missingFinalManifestFiles = (
    await Promise.all(
      requiredFinalManifestArtifacts.map(async (key) => ({
        key,
        exists: await finalManifestArtifactExists(finalDir, finalManifest?.artifacts?.[key]),
      })),
    )
  )
    .filter((item) => !item.exists)
    .map((item) => item.key)
  const finalStakeholderGaps = await finalStakeholderPackageGaps(finalDir, finalManifest?.artifacts)
  checks.push(
    check({
      id: "final-package",
      status:
        finalManifestExists &&
        finalManifestOperationMatches &&
        missingFinalManifestArtifacts.length === 0 &&
        missingFinalManifestFiles.length === 0 &&
        finalStakeholderGaps.length === 0
          ? "ok"
          : "fail",
      required: true,
      detail: finalManifestExists
        ? `manifest_operation_id=${finalManifest?.operationID ?? "missing"}; selected_operation_id=${operationID}; missing_manifest_artifacts=${missingFinalManifestArtifacts.length ? missingFinalManifestArtifacts.join(",") : "none"}; missing_manifest_files=${missingFinalManifestFiles.length ? missingFinalManifestFiles.join(",") : "none"}; stakeholder_gaps=${finalStakeholderGaps.length ? finalStakeholderGaps.join(",") : "none"}`
        : "final package manifest is missing",
      path: finalManifestPath,
    }),
  )
  const finalAudit = await readJson<{
    operationID?: string
    ok?: boolean
    blockers?: unknown[]
    generatedAt?: string
    checks?: {
      finalHandoff?: { ok?: boolean; gates?: { minOutlineTargetPages?: number; minPdfPages?: number } }
      credentialHandoff?: { ok?: boolean; required?: boolean; credentialCount?: number }
    }
  }>(finalAuditPath)
  const finalAuditTime = timestamp(finalAudit?.generatedAt)
  const finalManifestTime = timestamp(finalManifest?.generatedAt)
  const finalAuditFresh =
    finalAuditTime !== undefined &&
    (heartbeatTime === undefined || (finalAuditTime !== undefined && finalAuditTime >= heartbeatTime)) &&
    (!requiresCredentialHandoff || credentialReviewTime === undefined || (finalAuditTime !== undefined && finalAuditTime >= credentialReviewTime)) &&
    (finalManifestTime === undefined || finalAuditTime >= finalManifestTime)
  const finalAuditMinOutlineTargetPages = finalAudit?.checks?.finalHandoff?.gates?.minOutlineTargetPages
  const finalAuditMinPdfPages = finalAudit?.checks?.finalHandoff?.gates?.minPdfPages
  const finalAuditOperationMatches = operationIDMatches(finalAudit?.operationID, operationID)
  const finalAuditHandoffOk = finalAudit?.checks?.finalHandoff?.ok === true
  const finalAuditGatesOk =
    (requiredAuditMinOutlineTargetPages === undefined ||
      (finalAuditMinOutlineTargetPages ?? 0) >= requiredAuditMinOutlineTargetPages) &&
    (requiredAuditMinPdfPages === undefined || (finalAuditMinPdfPages ?? 0) >= requiredAuditMinPdfPages)
  const finalAuditCredentialHandoff = finalAudit?.checks?.credentialHandoff
  const finalAuditCredentialHandoffOk =
    !requiresCredentialHandoff ||
    (finalAuditCredentialHandoff?.ok === true &&
      finalAuditCredentialHandoff.required === true &&
      (finalAuditCredentialHandoff.credentialCount ?? 0) > 0)
  checks.push(
    check({
      id: "final-operation-audit",
      status:
        finalAudit?.ok === true &&
        finalAuditOperationMatches &&
        countItems(finalAudit.blockers) === 0 &&
        finalAuditFresh &&
        finalAuditHandoffOk &&
        finalAuditGatesOk &&
        finalAuditCredentialHandoffOk
          ? "ok"
          : "fail",
      required: true,
      detail: finalAudit
        ? `ok=${finalAudit.ok === true ? "true" : "false"}; audit_operation_id=${finalAudit.operationID ?? "missing"}; selected_operation_id=${operationID}; blockers=${countItems(finalAudit.blockers)}; generated_at=${finalAudit.generatedAt ?? "missing"}; final_manifest_generated_at=${finalManifest?.generatedAt ?? "missing"}; fresh=${finalAuditFresh ? "true" : "false"}; final_handoff=${finalAuditHandoffOk ? "proved" : "missing"}; min_outline_target_pages=${finalAuditMinOutlineTargetPages ?? "missing"}${requiredAuditMinOutlineTargetPages ? `; required_min_outline_target_pages=${requiredAuditMinOutlineTargetPages}` : ""}; min_pdf_pages=${finalAuditMinPdfPages ?? "missing"}${requiredAuditMinPdfPages ? `; required_min_pdf_pages=${requiredAuditMinPdfPages}` : ""}; credential_handoff=${
            requiresCredentialHandoff
              ? finalAuditCredentialHandoffOk
                ? "proved"
                : "missing"
              : "not_required"
          }`
        : "final operation audit is missing",
      path: finalAuditPath,
    }),
  )

  const status = statusFor(checks, literalElapsedSeconds, targetElapsedSeconds)
  const gaps = checks
    .filter((item) => item.status !== "ok")
    .map((item) => `${item.id}: ${item.detail}`)
  const result: LiteralRunReadinessResult = {
    operationID,
    status,
    targetElapsedSeconds,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    literalElapsedSeconds,
    checks,
    gaps,
    auditPath,
    markdownPath,
  }
  await fs.mkdir(path.dirname(auditPath), { recursive: true })
  await fs.writeFile(auditPath, JSON.stringify(result, null, 2) + "\n")
  await fs.writeFile(markdownPath, formatMarkdown(result))
  return result
}

export function formatLiteralRunReadiness(result: LiteralRunReadinessResult) {
  return [
    `# Literal Run Readiness: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- target_elapsed_seconds: ${result.targetElapsedSeconds}`,
    `- literal_elapsed_seconds: ${result.literalElapsedSeconds ?? "not proven"}`,
    `- audit: ${result.auditPath}`,
    `- markdown: ${result.markdownPath}`,
  ].join("\n")
}
