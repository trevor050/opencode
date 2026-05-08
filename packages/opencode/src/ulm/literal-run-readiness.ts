import fs from "fs/promises"
import path from "path"
import { operationPath, operationPlanRequiresCredentialHandoff, slug } from "./artifact"

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

const runtimeProofChecks = new Set(["literal-runtime-proof", "literal-work-proof"])
const handoffProofChecks = new Set([
  "final-package",
  "final-operation-audit",
  "credential-handoff-proof",
  "report-outline-proof",
])

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

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

function reportOutlineTargetPages(outline: string | undefined) {
  const match = outline?.match(/^\s*-\s*target_pages:\s*(\d+)\s*$/im)
  const pages = Number.parseInt(match?.[1] ?? "", 10)
  return Number.isFinite(pages) ? pages : undefined
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
  const operationPlanPath = path.join(root, "plans", "operation-plan.json")
  const supervisorManifestPath = path.join(root, "scheduler", "supervisor", "supervisor-manifest.json")
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
  const operationPlan = await readJson<{ timeBudget?: { targetHours?: number } }>(operationPlanPath)
  const requiresLongRunProof = targetElapsedSeconds >= 20 * 60 * 60
  const requiredAuditMinOutlineTargetPages =
    requiresLongRunProof || (operationPlan?.timeBudget?.targetHours ?? 0) >= 20 ? 50 : undefined
  const requiredAuditMinPdfPages = requiredAuditMinOutlineTargetPages
  const requiresCredentialHandoff = operationPlanRequiresCredentialHandoff(operationPlan)
  const credentialReview = await readJson<{ submittedAt?: string; credentials?: unknown[] }>(credentialReviewPath)
  const credentialReviewCount = countItems(credentialReview?.credentials)
  const credentialReviewTime = timestamp(credentialReview?.submittedAt)
  const reportOutline = await readText(reportOutlinePath)
  const outlineTargetPages = reportOutlineTargetPages(reportOutline)
  checks.push(
    check({
      id: "operation-graph",
      status: graph?.safetyMode === "non_destructive" && Array.isArray(graph.lanes) && graph.lanes.length > 0 ? "ok" : "fail",
      required: true,
      detail: graph ? `safety=${graph.safetyMode}; lanes=${graph.lanes?.length ?? 0}` : "operation graph is missing",
      path: graphPath,
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
      status: !requiresCredentialHandoff || (credentialReview?.submittedAt && credentialReviewCount > 0) ? "ok" : "fail",
      required: requiresCredentialHandoff,
      detail: requiresCredentialHandoff
        ? `submitted_at=${credentialReview?.submittedAt ?? "missing"}; credential_count=${credentialReviewCount}`
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

  const heartbeat = await readJson<{
    elapsedSeconds?: number
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
  const heartbeatTime = timestamp(heartbeat?.endedAt) ?? timestamp(heartbeat?.updatedAt)
  const log = await readText(daemonLogPath)
  const workProof = heartbeat ? workProofFromHeartbeat(heartbeat) : undefined
  checks.push(
    check({
      id: "literal-runtime-proof",
      status: literalElapsedSeconds !== undefined && literalElapsedSeconds >= targetElapsedSeconds && !!log?.trim() ? "ok" : "fail",
      required: true,
      detail: heartbeat
        ? `elapsed_seconds=${literalElapsedSeconds ?? "missing"}; reason=${heartbeat.reason ?? "missing"}; log=${log?.trim() ? "present" : "missing"}`
        : "daemon heartbeat is missing; no wall-clock run proof exists",
      path: daemonHeartbeatPath,
    }),
  )
  checks.push(
    check({
      id: "literal-work-proof",
      status: workProof && workProof.total > 0 ? "ok" : "fail",
      required: true,
      detail: workProof
        ? `model_launches=${workProof.modelLaunches}; command_launches=${workProof.commandLaunches}; completed_lanes=${workProof.completedLanes}; synced_jobs=${workProof.syncedJobs}; recoveries=${workProof.recoveries}`
        : "daemon heartbeat is missing; no lane launch, command launch, recovery, or completion proof exists",
      path: daemonHeartbeatPath,
    }),
  )

  checks.push(
    check({
      id: "final-package",
      status: (await exists(finalManifestPath)) ? "ok" : "fail",
      required: true,
      detail: (await exists(finalManifestPath)) ? "final handoff manifest exists" : "final package manifest is missing",
      path: finalManifestPath,
    }),
  )
  const finalAudit = await readJson<{
    ok?: boolean
    blockers?: unknown[]
    generatedAt?: string
    checks?: {
      finalHandoff?: { gates?: { minOutlineTargetPages?: number; minPdfPages?: number } }
      credentialHandoff?: { ok?: boolean; required?: boolean; credentialCount?: number }
    }
  }>(finalAuditPath)
  const finalAuditTime = timestamp(finalAudit?.generatedAt)
  const finalAuditFresh =
    (heartbeatTime === undefined || (finalAuditTime !== undefined && finalAuditTime >= heartbeatTime)) &&
    (!requiresCredentialHandoff || credentialReviewTime === undefined || (finalAuditTime !== undefined && finalAuditTime >= credentialReviewTime))
  const finalAuditMinOutlineTargetPages = finalAudit?.checks?.finalHandoff?.gates?.minOutlineTargetPages
  const finalAuditMinPdfPages = finalAudit?.checks?.finalHandoff?.gates?.minPdfPages
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
        countItems(finalAudit.blockers) === 0 &&
        finalAuditFresh &&
        finalAuditGatesOk &&
        finalAuditCredentialHandoffOk
          ? "ok"
          : "fail",
      required: true,
      detail: finalAudit
        ? `ok=${finalAudit.ok === true ? "true" : "false"}; blockers=${countItems(finalAudit.blockers)}; generated_at=${finalAudit.generatedAt ?? "missing"}; fresh=${finalAuditFresh ? "true" : "false"}; min_outline_target_pages=${finalAuditMinOutlineTargetPages ?? "missing"}${requiredAuditMinOutlineTargetPages ? `; required_min_outline_target_pages=${requiredAuditMinOutlineTargetPages}` : ""}; min_pdf_pages=${finalAuditMinPdfPages ?? "missing"}${requiredAuditMinPdfPages ? `; required_min_pdf_pages=${requiredAuditMinPdfPages}` : ""}; credential_handoff=${
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
