import fs from "fs/promises"
import path from "path"
import type { BackgroundJob } from "@/background/job"
import { operationPath, slug } from "./artifact"
import { containsRawCredentialSecret } from "./credential-safety"
import { decideOperationNext, type OperationNextAction } from "./operation-next"
import type { OperationGraphRecord, OperationLane, OperationLaneCoverageImpact } from "./operation-graph"
import { syncWorkQueueJobs } from "./work-queue"

export type OperationRunMode = "advance" | "complete_lane" | "skip_lane" | "block_lane" | "fail_lane"

export type OperationRunInput = {
  operationID: string
  mode?: OperationRunMode
  controller?: "scheduler" | "tool"
  now?: Date | string
  laneID?: string
  jobID?: string
  summary?: string
  artifacts?: readonly string[]
  evidenceRefs?: readonly string[]
  coverageImpact?: OperationLaneCoverageImpact
  releaseRequired?: boolean
  autoComplete?: boolean
  backgroundJobs?: BackgroundJob.Info[]
}

export type OperationRunResult = {
  operationID: string
  mode: OperationRunMode
  action: OperationNextAction["action"]
  reason: string
  laneID?: string
  graphPath: string
  runLogPath: string
  taskParams?: {
    description: string
    prompt: string
    subagent_type: string
    operationID: string
    laneID: string
    modelRoute: string
    allowedTools: string[]
    background: boolean
  }
  commandProfiles?: string[]
  completedLanes: string[]
  skippedLanes: string[]
  blockedLanes: string[]
  failedLanes: string[]
  syncedJobs: string[]
  syncedWorkUnits: string[]
  completedWorkUnits: string[]
  failedWorkUnits: string[]
  blockers: string[]
  repairHints: string[]
}

export type OperationRuntimeSyncInput = {
  operationID: string
  backgroundJobs?: BackgroundJob.Info[]
  autoComplete?: boolean
}

export type OperationRuntimeSyncResult = {
  operationID: string
  graph: OperationGraphRecord
  graphPath: string
  completedLanes: string[]
  skippedLanes: string[]
  blockedLanes: string[]
  failedLanes: string[]
  syncedJobs: string[]
  syncedWorkUnits: string[]
  completedWorkUnits: string[]
  failedWorkUnits: string[]
}

export type LaneCompletionProof = {
  operationID: string
  laneID: string
  status: "complete" | "skipped" | "blocked" | "failed"
  completedAt: string
  summary: string
  artifacts: string[]
  evidenceRefs: string[]
  coverageImpact?: OperationLaneCoverageImpact
  releaseRequired?: boolean
  jobID?: string
}

type RunLogRecord = {
  time: string
  mode: OperationRunMode
  laneID?: string
  jobID?: string
  summary?: string
  action: OperationRunResult["action"]
  reason: string
}

function toDate(value: Date | string | undefined) {
  if (!value) return new Date()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : new Date()
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function appendJsonl(file: string, value: RunLogRecord) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(value) + "\n")
}

function graphPaths(worktree: string, operationID: string) {
  const root = operationPath(worktree, operationID)
  return {
    root,
    graphPath: path.join(root, "plans", "operation-graph.json"),
    runLogPath: path.join(root, "plans", "operation-run.jsonl"),
  }
}

function laneProofPath(root: string, laneID: string) {
  return path.join(root, "lane-complete", `${laneID}.json`)
}

function findLane(graph: OperationGraphRecord, laneID: string) {
  const lane = graph.lanes.find((item) => item.id === laneID)
  if (!lane) throw new Error(`lane ${laneID} is missing from operation graph`)
  return lane
}

function markDependentsReady(graph: OperationGraphRecord) {
  const complete = new Set(
    graph.lanes
      .filter(
        (lane) =>
          lane.status === "complete" ||
          ((lane.status === "skipped" || lane.status === "blocked") &&
            lane.releaseRequired === false &&
            lane.coverageImpact !== "blocks_release"),
      )
      .map((lane) => lane.id),
  )
  for (const lane of graph.lanes) {
    if (lane.status === "pending" && lane.dependsOn.every((dependency) => complete.has(dependency))) {
      lane.status = "ready"
    }
  }
}

async function expectedArtifactExists(root: string, expected: string) {
  const relative = expected.replace(/\/+$/g, "")
  if (!relative || relative.includes("*") || path.isAbsolute(relative)) return false
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) return false
  try {
    const stat = await fs.stat(resolved)
    if (stat.isDirectory()) {
      const entries = await fs.readdir(resolved)
      return entries.length > 0
    }
    return stat.size > 0 || expected.endsWith("/stderr.log")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function artifactCoversExpected(artifact: string, expected: string) {
  const cleanArtifact = artifact.replace(/\/+$/g, "")
  const cleanExpected = expected.replace(/\/+$/g, "")
  if (expected.endsWith("/")) return cleanArtifact === cleanExpected || cleanArtifact.startsWith(`${cleanExpected}/`)
  return cleanArtifact === cleanExpected
}

function jobMatchesWorktree(job: BackgroundJob.Info, worktree: string) {
  const metadataWorktree = job.metadata?.worktree
  return typeof metadataWorktree !== "string" || path.resolve(metadataWorktree) === path.resolve(worktree)
}

function laneRequiresEvidenceRefs(lane: OperationLane) {
  return lane.id.startsWith("planned_work_") || [
    "evidence_normalization",
    "finding_validation",
    "report_writing",
    "report_review",
    "operator_summary",
  ].includes(lane.id)
}

function incompletePlannedWorkExists(graph: OperationGraphRecord) {
  return graph.lanes.some(
    (lane) =>
      lane.id.startsWith("planned_work_") &&
      lane.status !== "complete" &&
      !(
        (lane.status === "skipped" || lane.status === "blocked") &&
        lane.releaseRequired === false &&
        lane.coverageImpact !== "blocks_release"
      ),
  )
}

const REPORT_AUTOCOMPLETE_LANES = new Set([
  "report_evidence_index",
  "report_writing",
  "report_technical_review",
  "report_executive_review",
  "report_review",
  "operator_summary",
])

function operationRunRepairHints(blockers: readonly string[], next?: OperationNextAction) {
  const hints = new Set<string>()
  const missingExpected = blockers
    .map((blocker) => blocker.match(/^proof does not cover expected artifact: (.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
  const missingFinalArtifacts = missingExpected.filter((artifact) => artifact.startsWith("deliverables/final/"))
  if (missingFinalArtifacts.length) {
    hints.add(
      `Final package proof is missing ${missingFinalArtifacts.join(", ")}. Run report_render, then runtime_summary if runtime-summary.md is expected, then retry operation_run complete_lane with the generated deliverables/final paths.`,
    )
  }
  const missingEvalArtifacts = missingExpected.filter((artifact) => artifact === "deliverables/eval-scorecard.json" || artifact === "deliverables/eval-scorecard.md")
  if (missingEvalArtifacts.length) {
    hints.add(
      `Evaluation proof is missing ${missingEvalArtifacts.join(", ")}. Run eval_scorecard, then retry operation_run complete_lane with deliverables/eval-scorecard.json and any other expected operator-summary artifacts.`,
    )
  }
  const missingStageGates = missingExpected.filter((artifact) => artifact.startsWith("deliverables/stage-gates/"))
  if (missingStageGates.length) {
    hints.add(
      `Stage-gate proof is missing ${missingStageGates.join(", ")}. Run operation_stage_gate for the required stage, then retry operation_run complete_lane with the generated stage-gate artifact path.`,
    )
  }
  const missingEvidenceArtifacts = missingExpected.filter(
    (artifact) => artifact.startsWith("evidence/") || artifact === "evidence-index.json" || artifact === "findings/",
  )
  if (missingEvidenceArtifacts.length) {
    hints.add(
      `Evidence proof is missing ${missingEvidenceArtifacts.join(", ")}. Record or normalize evidence/findings first, then retry operation_run complete_lane with those operation-relative artifact paths.`,
    )
  }
  if (next?.action === "launch_lane") {
    hints.add(
      `Next lane ready: ${next.lane.id}. Do not call operation_schedule for active-run continuation. Use runtime_scheduler/runtime_daemon to launch lanes, or produce the lane artifacts (${next.lane.expectedArtifacts.join(", ")}) and retry operation_run complete_lane for ${next.lane.id}.`,
    )
  } else if (next?.action === "wait" && next.blockers.length) {
    hints.add(
      `Operation is waiting on blockers, not a new schedule: ${next.blockers.join("; ")}. Use ${next.recommendedTools.join(", ")} to repair or inspect progress; do not call operation_schedule.`,
    )
  } else if (next?.action === "wait") {
    hints.add(
      `Operation is waiting: ${next.reason}. Use ${next.recommendedTools.join(", ")} to inspect or continue; do not call operation_schedule for an already scheduled active run.`,
    )
  } else if (next?.action === "stop") {
    hints.add(
      `All scheduler lanes are complete. Do not call operation_schedule again; call operation_checkpoint with stage=handoff and status=complete, then run operation_audit finalHandoff=true and repair any reported final handoff gaps.`,
    )
  } else if (next?.action === "compact") {
    hints.add(
      `Runtime context needs maintenance before more lane work: ${next.reason}. Use ${next.recommendedTools.join(", ")}; do not reschedule the operation graph.`,
    )
  } else if (next?.action === "research_charter") {
    hints.add(
      `Discovery Charter research is next. Launch the ${next.laneID} pass, record evidence and operation memory, then write the full duration-aware operation_plan before operation_schedule.`,
    )
  }
  return [...hints]
}

const COVERAGE_RANK: Record<OperationLaneCoverageImpact, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  blocks_release: 4,
}

async function validateLaneCompletionProof(root: string, lane: OperationLane, proof: LaneCompletionProof) {
  const blockers: string[] = []
  if (proof.operationID !== lane.operationID) blockers.push("proof operationID does not match lane")
  if (proof.laneID !== lane.id) blockers.push("proof laneID does not match lane")
  if (proof.status !== "complete") blockers.push("proof status must be complete")
  if (!proof.summary.trim()) blockers.push("proof summary is required")
  if (!proof.artifacts.length) blockers.push("proof artifacts are required")
  if (laneRequiresEvidenceRefs(lane) && !proof.evidenceRefs.length)
    blockers.push(`${lane.id}: evidenceRefs are required`)
  for (const artifact of proof.artifacts) {
    if (!artifact || path.isAbsolute(artifact) || artifact.includes("..")) {
      blockers.push(`invalid proof artifact path: ${artifact}`)
      continue
    }
    if (!(await expectedArtifactExists(root, artifact)))
      blockers.push(`proof artifact is missing or empty: ${artifact}`)
  }
  for (const expected of lane.expectedArtifacts) {
    if (!proof.artifacts.some((artifact) => artifactCoversExpected(artifact, expected))) {
      blockers.push(`proof does not cover expected artifact: ${expected}`)
    }
  }
  blockers.push(...validatePlannedWorkRuntime(lane, proof.completedAt))
  return blockers
}

function validatePlannedWorkRuntime(lane: OperationLane, completedAt: string) {
  if (!lane.id.startsWith("planned_work_")) return []
  const minRuntimeMinutes = lane.minRuntimeMinutes ?? 0
  if (minRuntimeMinutes <= 0) return []
  const startedAt = lane.startedAt ? Date.parse(lane.startedAt) : Number.NaN
  const finishedAt = Date.parse(completedAt)
  if (!Number.isFinite(finishedAt)) return [`${lane.id}: completion proof has invalid completedAt`]
  if (!Number.isFinite(startedAt)) {
    // Recovery runs can rebuild a graph after the actual lane artifacts already exist.
    // The artifact/evidence proof still has to pass validation before this path is reached.
    return []
  }
  const elapsedMinutes = (finishedAt - startedAt) / 60 / 1000
  if (elapsedMinutes < minRuntimeMinutes) {
    return [
      `${lane.id}: planned work ran ${elapsedMinutes.toFixed(1)}m, requires at least ${minRuntimeMinutes}m before completion`,
    ]
  }
  return []
}

async function proofIsValid(root: string, lane: OperationLane, proof: LaneCompletionProof) {
  try {
    return (await validateLaneCompletionProof(root, lane, proof)).length === 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function validateInputProof(root: string, lane: OperationLane, input: OperationRunInput, now: Date) {
  const artifacts = [...(input.artifacts ?? [])]
  for (const expected of lane.expectedArtifacts) {
    if (artifacts.some((artifact) => artifactCoversExpected(artifact, expected))) continue
    if (await expectedArtifactExists(root, expected)) artifacts.push(expected)
  }
  const proof: LaneCompletionProof = {
    operationID: lane.operationID,
    laneID: lane.id,
    status: "complete",
    completedAt: now.toISOString(),
    summary: input.summary?.trim() || "",
    artifacts,
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    ...(input.jobID ? { jobID: input.jobID } : {}),
  }
  return { proof, blockers: await validateLaneCompletionProof(root, lane, proof) }
}

async function persistLaneCompletionProof(root: string, proof: LaneCompletionProof) {
  await writeJson(laneProofPath(root, proof.laneID), proof)
}

async function persistLaneTerminalProof(
  root: string,
  lane: OperationLane,
  input: OperationRunInput,
  status: "skipped" | "blocked",
  now: Date,
) {
  const proof: LaneCompletionProof = {
    operationID: lane.operationID,
    laneID: lane.id,
    status,
    completedAt: now.toISOString(),
    summary: input.summary?.trim() || "",
    artifacts: [...(input.artifacts ?? [])],
    evidenceRefs: [...(input.evidenceRefs ?? [])],
    coverageImpact: input.coverageImpact ?? lane.coverageImpact ?? (status === "blocked" ? "blocks_release" : "high"),
    releaseRequired: input.releaseRequired ?? lane.releaseRequired ?? true,
    ...(input.jobID ? { jobID: input.jobID } : {}),
  }
  const blockers: string[] = []
  if (!proof.summary) blockers.push(`${lane.id}: ${status} lanes require summary`)
  if (lane.releaseRequired === true && input.releaseRequired === false) {
    blockers.push(`${lane.id}: releaseRequired cannot be downgraded by ${status}`)
  }
  if (
    lane.coverageImpact &&
    input.coverageImpact &&
    COVERAGE_RANK[input.coverageImpact] < COVERAGE_RANK[lane.coverageImpact]
  ) {
    blockers.push(`${lane.id}: coverageImpact cannot be downgraded from ${lane.coverageImpact} to ${input.coverageImpact}`)
  }
  if (lane.id.startsWith("planned_work_")) {
    if (!proof.artifacts.length) blockers.push(`${lane.id}: planned work ${status} proof requires artifacts`)
    if (!proof.evidenceRefs.length) blockers.push(`${lane.id}: planned work ${status} proof requires evidenceRefs`)
    for (const expected of lane.expectedArtifacts) {
      if (!proof.artifacts.some((artifact) => artifactCoversExpected(artifact, expected))) {
        blockers.push(`${lane.id}: planned work ${status} proof does not cover expected artifact: ${expected}`)
      } else if (!(await expectedArtifactExists(root, expected))) {
        blockers.push(`${lane.id}: planned work ${status} expected artifact is missing or empty: ${expected}`)
      }
    }
  }
  if (!blockers.length) await persistLaneCompletionProof(root, proof)
  return { proof, blockers }
}

async function readLaneCompletionProof(root: string, lane: OperationLane) {
  const proof = await readJson<LaneCompletionProof>(laneProofPath(root, lane.id))
  if (!proof) return undefined
  if (proof.operationID !== lane.operationID) return undefined
  if (proof.laneID !== lane.id) return undefined
  if (proof.status !== "complete") return undefined
  return proof
}

async function evidenceRefsForAutoProof(root: string) {
  const evidenceDir = path.join(root, "evidence")
  const entries = await fs.readdir(evidenceDir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/g, ""))
    .sort((left, right) => left.localeCompare(right))
}

function dependenciesSatisfied(graph: OperationGraphRecord, lane: OperationLane) {
  const complete = new Set(
    graph.lanes
      .filter(
        (item) =>
          item.status === "complete" ||
          ((item.status === "skipped" || item.status === "blocked") &&
            item.releaseRequired === false &&
            item.coverageImpact !== "blocks_release"),
      )
      .map((item) => item.id),
  )
  return lane.dependsOn.every((dependency) => complete.has(dependency))
}

async function autoCompleteReportLane(root: string, graph: OperationGraphRecord, lane: OperationLane) {
  if (!REPORT_AUTOCOMPLETE_LANES.has(lane.id)) return false
  if (incompletePlannedWorkExists(graph)) return false
  if (lane.status !== "ready" && lane.status !== "running") return false
  if (!dependenciesSatisfied(graph, lane)) return false
  if (!(await Promise.all(lane.expectedArtifacts.map((artifact) => expectedArtifactExists(root, artifact)))).every(Boolean)) {
    return false
  }
  const evidenceRefs = laneRequiresEvidenceRefs(lane) ? await evidenceRefsForAutoProof(root) : []
  if (laneRequiresEvidenceRefs(lane) && !evidenceRefs.length) return false
  await persistLaneCompletionProof(root, {
    operationID: lane.operationID,
    laneID: lane.id,
    status: "complete",
    completedAt: new Date().toISOString(),
    summary: `Auto-completed from existing rendered report artifacts for ${lane.title}.`,
    artifacts: [...lane.expectedArtifacts],
    evidenceRefs,
    jobID: "auto-final-package-proof",
  })
  lane.status = "complete"
  lane.terminalState = "complete"
  return true
}

async function autoCompleteLanes(root: string, graph: OperationGraphRecord) {
  const completed: string[] = []
  for (const lane of graph.lanes) {
    if (lane.status !== "running") continue
    const proof = await readLaneCompletionProof(root, lane)
    if (!proof) continue
    if (!(await proofIsValid(root, lane, proof))) continue
    lane.status = "complete"
    lane.terminalState = "complete"
    completed.push(lane.id)
  }
  let changed = true
  while (changed) {
    changed = false
    markDependentsReady(graph)
    for (const lane of graph.lanes) {
      if (await autoCompleteReportLane(root, graph, lane)) {
        completed.push(lane.id)
        changed = true
      }
    }
  }
  if (completed.length) markDependentsReady(graph)
  return completed
}

async function syncBackgroundJobs(
  worktree: string,
  root: string,
  graph: OperationGraphRecord,
  operationID: string,
  jobs: BackgroundJob.Info[] | undefined,
) {
  const completed: string[] = []
  const failed: string[] = []
  const synced: string[] = []
  if (!jobs?.length) return { completed, failed, synced }

  for (const job of jobs) {
    const metadataOperation = job.metadata?.operationID
    const laneID = job.metadata?.laneID
    if (metadataOperation !== operationID || typeof laneID !== "string" || !laneID) continue
    if (!jobMatchesWorktree(job, worktree)) continue
    const lane = graph.lanes.find((item) => item.id === laneID)
    if (!lane) continue
    if (lane.status === "complete" || lane.status === "skipped" || lane.status === "blocked") continue
    lane.activeJobs = [
      ...(lane.activeJobs ?? []).filter((item) => item.id !== job.id),
      {
        id: job.id,
        type: job.type,
        status: job.status,
        updatedAt: new Date(job.completedAt ?? job.startedAt).toISOString(),
      },
    ]
    synced.push(job.id)
    if (job.status === "running") lane.status = "running"
    if (job.status === "completed") {
      const proof = await readLaneCompletionProof(root, lane)
      if (!proof || !(await proofIsValid(root, lane, proof))) continue
      lane.status = "complete"
      lane.terminalState = "complete"
      completed.push(lane.id)
    }
    if (
      job.type !== "command_supervise" &&
      (job.status === "error" || job.status === "cancelled" || job.status === "stale") &&
      lane.status !== "failed"
    ) {
      lane.status = "failed"
      lane.terminalState = "failed"
      failed.push(lane.id)
    }
  }
  if (completed.length) markDependentsReady(graph)
  return { completed, failed, synced }
}

function commandProfilesForLane(lane: OperationLane) {
  if (lane.id === "recon") return ["service-inventory"]
  if (lane.id === "web_inventory") return ["http-discovery", "content-discovery", "passive-web-baseline"]
  return []
}

async function readOperationScopeRules(root: string) {
  const plan = await readJson<{ scopeRules?: unknown[] }>(path.join(root, "plans", "operation-plan.json"))
  return Array.isArray(plan?.scopeRules)
    ? plan.scopeRules.filter((rule): rule is string => typeof rule === "string" && rule.trim().length > 0)
    : []
}

function scopeRulePromptLines(scopeRules: string[]) {
  return scopeRules.length ? ["Operation scope rules:", ...scopeRules.map((rule) => `- ${rule}`), ""] : []
}

function laneSpecificInstruction(lane: OperationLane) {
  if (lane.id.startsWith("planned_work_"))
    return `This is a duration-plan execution block. The harness will reject completion before the wall-clock floor${
      lane.minRuntimeMinutes ? ` of ${lane.minRuntimeMinutes} minutes` : ""
    }. Complete the scoped block, write a durable block note under work-blocks/, cite evidence or blockers, and only then call operation_run mode=complete_lane for this exact lane. Do not skip ahead to reporting while planned_work lanes remain.`
  if (lane.id === "finding_validation")
    return "Before running the validation gate, inspect operation_status plus normalized leads/findings, then use finding_record to promote evidence-backed issues to validated/report_ready or reject non-issues."
  if (lane.id === "report_writing")
    return "Draft or expand the substantive authored report to reports/report.md with the write tool before linting or rendering. Write a scaffold or first section immediately, then expand in bounded chunks with tool calls/checkpoints instead of spending minutes silently composing the whole report. For long-run/20h reports, satisfy the outline budget with roughly 12,000+ words, substantial coverage in every outline section, finding-specific writeups, and a rendered PDF close to the 50-page final gate. Run strict report_lint options before completing: requireReport, requireOutlineBudget, requireOutlineSections, requireFindingSections, minWords 12000, minPdfPages 50, minOutlineTargetPages 50."
  return undefined
}

function taskParamsForLane(lane: OperationLane, scopeRules: string[]) {
  const specific = laneSpecificInstruction(lane)
  return {
    description: lane.title.slice(0, 60),
    prompt: [
      `Run ULM operation lane "${lane.id}" for operation "${lane.operationID}".`,
      "",
      `Use model route: ${lane.modelRoute}`,
      `Allowed tools: ${lane.allowedTools.join(", ")}`,
      `Expected artifacts: ${lane.expectedArtifacts.join(", ")}`,
      "",
      ...scopeRulePromptLines(scopeRules),
      "Use only the allowed tools listed above. Bash, browser, and Playwright tools are unavailable for this lane unless they are explicitly listed.",
      "Checkpoint material progress, preserve evidence references, and finish with a lane summary, blockers, and validation limits.",
      "When supervised commands are running, poll their heartbeat/stdout/stderr artifacts with read/grep. Do not use bash, sleep, cat, tail, or foreground shell commands for command polling.",
      ...(specific ? [specific] : []),
      "Before exiting, call operation_run for this operation and lane with mode=complete_lane once expected artifacts exist; use block_lane or skip_lane with a clear reason if the lane cannot be completed safely.",
      "Do not call operation_run with mode=advance, runtime_scheduler, runtime_daemon, task, or command_supervise to launch downstream lanes; the parent scheduler owns the next-lane handoff.",
    ].join("\n"),
    subagent_type: lane.agent,
    operationID: lane.operationID,
    laneID: lane.id,
    modelRoute: lane.modelRoute,
    allowedTools: lane.allowedTools,
    background: true,
  }
}

function taskParamsForDiscoveryResearch(action: Extract<OperationNextAction, { action: "research_charter" }>) {
  return {
    description: "Discovery Charter research pass",
    prompt: action.prompt,
    subagent_type: "recon",
    operationID: action.operationID,
    laneID: action.laneID,
    modelRoute: "openai/gpt-5.5",
    allowedTools: action.recommendedTools,
    background: true,
  }
}

async function persistRun(worktree: string, graph: OperationGraphRecord, record: RunLogRecord) {
  const { graphPath, runLogPath } = graphPaths(worktree, graph.operationID)
  graph.updatedAt = record.time
  await writeJson(graphPath, graph)
  await appendJsonl(runLogPath, record)
  return { graphPath, runLogPath }
}

export async function runOperationStep(worktree: string, input: OperationRunInput): Promise<OperationRunResult> {
  const { backgroundJobs: _backgroundJobs, controller: _controller, ...operatorInput } = input
  if (containsRawCredentialSecret(operatorInput)) throw new Error("operation run inputs must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const mode = input.mode ?? "advance"
  const now = toDate(input.now)
  const { root, graphPath, runLogPath } = graphPaths(worktree, operationID)
  const graphExists = await Bun.file(graphPath).exists()
  if (!graphExists) {
    if (mode !== "advance") throw new Error("operation graph is missing; run operation_schedule first")
    const next = await decideOperationNext(worktree, { operationID, now })
    const taskParams =
      next.action.action === "research_charter" ? taskParamsForDiscoveryResearch(next.action) : undefined
    await appendJsonl(runLogPath, {
      time: now.toISOString(),
      mode,
      laneID: "laneID" in next.action ? next.action.laneID : undefined,
      jobID: input.jobID,
      summary: input.summary,
      action: next.action.action,
      reason: next.action.reason,
    })
    return {
      operationID,
      mode,
      action: next.action.action,
      reason: next.action.reason,
      laneID: "laneID" in next.action ? next.action.laneID : undefined,
      graphPath,
      runLogPath,
      taskParams,
      commandProfiles: [],
      completedLanes: [],
      skippedLanes: [],
      blockedLanes: [],
      failedLanes: [],
      syncedJobs: [],
      syncedWorkUnits: [],
      completedWorkUnits: [],
      failedWorkUnits: [],
      blockers: next.action.blockers,
      repairHints: operationRunRepairHints(next.action.blockers, next.action),
    }
  }
  const synced = await syncOperationRuntimeState(worktree, {
    operationID,
    backgroundJobs: input.backgroundJobs,
    autoComplete: input.autoComplete,
  })
  const graph = synced.graph
  const completedLanes = [...synced.completedLanes]
  const skippedLanes = [...synced.skippedLanes]
  const blockedLanes = [...synced.blockedLanes]
  const failedLanes = [...synced.failedLanes]
  const syncedJobs = [...synced.syncedJobs]
  const syncedWorkUnits = [...synced.syncedWorkUnits]
  const completedWorkUnits = [...synced.completedWorkUnits]
  const failedWorkUnits = [...synced.failedWorkUnits]
  const blockers: string[] = []

  if (mode === "complete_lane" || mode === "skip_lane" || mode === "block_lane" || mode === "fail_lane") {
    if (!input.laneID) throw new Error(`${mode} requires laneID`)
    const lane = findLane(graph, input.laneID)
    if (mode === "complete_lane") {
      const proof = await validateInputProof(root, lane, input, now)
      if (lane.terminalState && lane.terminalState !== "complete" && proof.blockers.length) {
        blockers.push(`${lane.id}: terminal ${lane.terminalState} lane cannot be completed`)
      }
      if (proof.blockers.length) {
        blockers.push(...proof.blockers)
      }
      if (!blockers.length) {
        await persistLaneCompletionProof(root, proof.proof)
        lane.status = "complete"
        lane.terminalState = "complete"
        lane.startedAt = undefined
        completedLanes.push(lane.id)
        markDependentsReady(graph)
      }
    } else if (mode === "skip_lane" || mode === "block_lane") {
      const status = mode === "skip_lane" ? "skipped" : "blocked"
      const proof = await persistLaneTerminalProof(root, lane, input, status, now)
      if (proof.blockers.length) blockers.push(...proof.blockers)
      if (!blockers.length) {
        lane.status = status
        lane.terminalState = status
        lane.startedAt = undefined
        lane.skipReason = proof.proof.summary
        lane.coverageImpact = proof.proof.coverageImpact
        lane.releaseRequired = proof.proof.releaseRequired
        if (status === "skipped") skippedLanes.push(lane.id)
        else blockedLanes.push(lane.id)
        markDependentsReady(graph)
      }
    } else {
      lane.status = "failed"
      lane.terminalState = "failed"
      failedLanes.push(lane.id)
    }
  }

  if (completedLanes.length || skippedLanes.length || blockedLanes.length || failedLanes.length) {
    graph.updatedAt = now.toISOString()
    await writeJson(synced.graphPath, graph)
  }

  if (mode === "complete_lane" || mode === "skip_lane" || mode === "block_lane" || mode === "fail_lane") {
    const laneID = input.laneID
    const next = blockers.length ? undefined : await decideOperationNext(worktree, { operationID, now })
    const nextHint =
      next?.action.action === "launch_lane"
        ? ` Next lane ready: ${next.action.lane.id}; continue via runtime_scheduler/runtime_daemon or complete that lane with operation_run.`
        : next?.action.action === "stop"
          ? " All scheduler lanes are complete; call operation_checkpoint stage=handoff status=complete, then run operation_audit finalHandoff=true instead of rescheduling."
          : next?.action.action === "wait"
            ? ` Next scheduler state is wait: ${next.action.reason}.`
            : next?.action.action === "compact"
              ? ` Next scheduler state is compact: ${next.action.reason}.`
              : ""
    const reason = blockers.length
      ? `${mode} did not update lane ${laneID}: ${blockers.join("; ")}`
      : `recorded ${mode} for lane ${laneID}; scheduler will choose the next lane.${nextHint}`
    const { graphPath: persistedGraphPath, runLogPath: persistedRunLogPath } = await persistRun(worktree, graph, {
      time: now.toISOString(),
      mode,
      laneID,
      jobID: input.jobID,
      summary: input.summary,
      action: "wait",
      reason,
    })

    return {
      operationID,
      mode,
      action: "wait",
      reason,
      laneID,
      graphPath: persistedGraphPath,
      runLogPath: persistedRunLogPath,
      completedLanes,
      skippedLanes,
      blockedLanes,
      failedLanes,
      syncedJobs,
      syncedWorkUnits,
      completedWorkUnits,
      failedWorkUnits,
      blockers,
      repairHints: operationRunRepairHints(blockers, next?.action),
    }
  }

  if (mode === "advance" && input.controller === "tool") {
    const reason = "operation_run advance is scheduler-owned; use runtime_scheduler or runtime_daemon to launch lanes"
    const { graphPath: persistedGraphPath, runLogPath: persistedRunLogPath } = await persistRun(worktree, graph, {
      time: now.toISOString(),
      mode,
      jobID: input.jobID,
      summary: input.summary,
      action: "wait",
      reason,
    })

    return {
      operationID,
      mode,
      action: "wait",
      reason,
      graphPath: persistedGraphPath,
      runLogPath: persistedRunLogPath,
      completedLanes,
      skippedLanes,
      blockedLanes,
      failedLanes,
      syncedJobs,
      syncedWorkUnits,
      completedWorkUnits,
      failedWorkUnits,
      blockers,
      repairHints: operationRunRepairHints(blockers),
    }
  }

  const next = await decideOperationNext(worktree, { operationID, now })
  let taskParams: OperationRunResult["taskParams"]
  let commandProfiles: string[] = []
  let laneID = "lane" in next.action ? next.action.lane.id : "laneID" in next.action ? next.action.laneID : undefined

  if (mode === "advance" && next.action.action === "launch_lane") {
    const lane = findLane(graph, next.action.lane.id)
    lane.status = "running"
    lane.startedAt = now.toISOString()
    laneID = lane.id
    taskParams = taskParamsForLane(lane, await readOperationScopeRules(root))
    commandProfiles = commandProfilesForLane(lane)
  }

  const reason =
    mode === "advance" && next.action.action === "launch_lane"
      ? `marked lane ${laneID} running and prepared launch parameters`
      : next.action.reason
  const { graphPath: persistedGraphPath, runLogPath: persistedRunLogPath } = await persistRun(worktree, graph, {
    time: now.toISOString(),
    mode,
    laneID,
    jobID: input.jobID,
    summary: input.summary,
    action: next.action.action,
    reason,
  })

  const finalBlockers = [...blockers, ...next.action.blockers]
  return {
    operationID,
    mode,
    action: next.action.action,
    reason,
    laneID,
    graphPath: persistedGraphPath,
    runLogPath: persistedRunLogPath,
    taskParams,
    commandProfiles,
    completedLanes,
    skippedLanes,
    blockedLanes,
    failedLanes,
    syncedJobs,
    syncedWorkUnits,
    completedWorkUnits,
    failedWorkUnits,
    blockers: finalBlockers,
    repairHints: operationRunRepairHints(finalBlockers, next.action),
  }
}

export async function syncOperationRuntimeState(
  worktree: string,
  input: OperationRuntimeSyncInput,
): Promise<OperationRuntimeSyncResult> {
  const operationID = slug(input.operationID, "operation")
  const { root, graphPath } = graphPaths(worktree, operationID)
  const graph = await readJson<OperationGraphRecord>(graphPath)
  if (!graph) throw new Error("operation graph is missing; run operation_schedule first")
  const completedLanes: string[] = []
  const failedLanes: string[] = []

  if (input.autoComplete ?? true) completedLanes.push(...(await autoCompleteLanes(root, graph)))
  const jobSync = await syncBackgroundJobs(worktree, root, graph, operationID, input.backgroundJobs)
  completedLanes.push(...jobSync.completed.filter((lane) => !completedLanes.includes(lane)))
  failedLanes.push(...jobSync.failed.filter((lane) => !failedLanes.includes(lane)))
  const queueSync = await syncWorkQueueJobs(worktree, { operationID, backgroundJobs: input.backgroundJobs })

  if (completedLanes.length || failedLanes.length || jobSync.synced.length) {
    graph.updatedAt = new Date().toISOString()
    await writeJson(graphPath, graph)
  }

  return {
    operationID,
    graph,
    graphPath,
    completedLanes,
    skippedLanes: [],
    blockedLanes: [],
    failedLanes,
    syncedJobs: jobSync.synced,
    syncedWorkUnits: queueSync.syncedUnits,
    completedWorkUnits: queueSync.completedUnits,
    failedWorkUnits: queueSync.failedUnits,
  }
}

export function formatOperationRun(result: OperationRunResult) {
  return [
    `# Operation Run Step: ${result.operationID}`,
    "",
    `- mode: ${result.mode}`,
    `- action: ${result.action}`,
    `- reason: ${result.reason}`,
    `- lane: ${result.laneID ?? "none"}`,
    `- graph: ${result.graphPath}`,
    `- run_log: ${result.runLogPath}`,
    "",
    "## Completed Lanes",
    "",
    ...(result.completedLanes.length ? result.completedLanes.map((lane) => `- ${lane}`) : ["- none"]),
    "",
    "## Skipped Lanes",
    "",
    ...(result.skippedLanes.length ? result.skippedLanes.map((lane) => `- ${lane}`) : ["- none"]),
    "",
    "## Blocked Lanes",
    "",
    ...(result.blockedLanes.length ? result.blockedLanes.map((lane) => `- ${lane}`) : ["- none"]),
    "",
    "## Failed Lanes",
    "",
    ...(result.failedLanes.length ? result.failedLanes.map((lane) => `- ${lane}`) : ["- none"]),
    "",
    "## Synced Jobs",
    "",
    ...(result.syncedJobs.length ? result.syncedJobs.map((job) => `- ${job}`) : ["- none"]),
    "",
    "## Synced Work Units",
    "",
    ...(result.syncedWorkUnits.length ? result.syncedWorkUnits.map((unit) => `- ${unit}`) : ["- none"]),
    "",
    "## Launch Parameters",
    "",
    result.taskParams ? JSON.stringify(result.taskParams, null, 2) : "No model lane launch needed.",
    "",
    "## Command Profiles",
    "",
    ...(result.commandProfiles?.length ? result.commandProfiles.map((profile) => `- ${profile}`) : ["- none"]),
    "",
    "## Repair Hints",
    "",
    ...(result.repairHints.length ? result.repairHints.map((hint) => `- ${hint}`) : ["- none"]),
    "",
    "<operation_run_json>",
    JSON.stringify(result, null, 2),
    "</operation_run_json>",
  ].join("\n")
}
