import fs from "fs/promises"
import path from "path"
import type { BackgroundJob } from "@/background/job"
import { operationPath, slug } from "./artifact"
import { readOperationGoal } from "./operation-goal"
import {
  superviseOperation,
  type OperationSupervisorAction,
  type OperationSupervisorReviewKind,
} from "./operation-supervisor"
import { evaluateRuntimeGovernor, type GovernorDecision } from "./runtime-governor"
import {
  runOperationStep,
  syncOperationRuntimeState,
  type OperationRunResult,
  type OperationRuntimeSyncResult,
} from "./operation-run"
import { writeRuntimeGovernorRouteAudit } from "./runtime-governor"
import { acquireManifestTools } from "./tool-acquisition"
import { bindWorkUnitJob, nextWorkUnits, requeueStaleWorkUnits, type WorkQueueNextResult } from "./work-queue"

type SchedulerLaunchParams = NonNullable<OperationRunResult["taskParams"]>
type SchedulerCommandParams = WorkQueueNextResult["units"][number]["commandSupervise"]
const REPORT_REPAIR_LANE_ID = "report_repair"

export type RuntimeSchedulerInput = {
  operationID: string
  maxCycles?: number
  leaseSeconds?: number
  backgroundJobs?: BackgroundJob.Info[]
  launchModelLane?: (params: SchedulerLaunchParams) => Promise<{ jobID?: string | undefined } | undefined>
  launchCommandWorkUnit?: (params: SchedulerCommandParams) => Promise<{ jobID?: string | undefined } | undefined>
  commandWorkUnitLimit?: number
  supervisorEnabled?: boolean
  supervisorIntervalMinutes?: number
  lastSupervisorReviewAt?: Date | string
  supervisorReviewKind?: OperationSupervisorReviewKind
  ensureReadinessProof?: boolean
  toolManifestPath?: string
  now?: Date
}

export type RuntimeSchedulerSupervisorSummary = {
  enabled: boolean
  ran: boolean
  action?: OperationSupervisorAction
  reason?: string
  requiredNextTool?: string
  operatorMessage?: string
  modelPrompt?: string
  nextTools: string[]
  blocking: boolean
  generatedAt?: string
  files?: {
    json: string
    markdown: string
  }
}

export type RuntimeSchedulerCycle = {
  cycle: number
  time: string
  sync: OperationRuntimeSyncResult
  supervisor?: RuntimeSchedulerSupervisorSummary
  run?: OperationRunResult
  governor: GovernorDecision
  requeuedWorkUnits: string[]
  launchedJobs: string[]
  launchedCommandJobs: string[]
}

export type RuntimeSchedulerResult = {
  operationID: string
  heartbeatPath: string
  logPath: string
  cycles: RuntimeSchedulerCycle[]
  stopped: boolean
  reason: string
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function appendJsonl(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(value) + "\n")
}

function parseDate(value: Date | string | undefined) {
  if (!value) return undefined
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

function supervisorIntervalElapsed(input: { now: Date; last?: Date; intervalMinutes: number }) {
  if (!input.last) return true
  if (input.intervalMinutes <= 0) return true
  return input.now.getTime() - input.last.getTime() >= input.intervalMinutes * 60 * 1000
}

function supervisorBlocks(action: OperationSupervisorAction | undefined) {
  return (
    action !== undefined &&
    action !== "continue" &&
    action !== "continue_execution" &&
    action !== "continue_coverage" &&
    action !== "continue_reporting" &&
    action !== "handoff_ready" &&
    action !== "release_handoff"
  )
}

function hasActiveReportRepairJob(input: { operationID: string; backgroundJobs?: BackgroundJob.Info[] }) {
  return (input.backgroundJobs ?? []).some(
    (job) =>
      job.status === "running" &&
      job.metadata?.operationID === input.operationID &&
      job.metadata?.laneID === REPORT_REPAIR_LANE_ID,
  )
}

function reportRepairTaskParams(
  operationID: string,
  supervisor: RuntimeSchedulerSupervisorSummary,
): SchedulerLaunchParams {
  const nextTool = supervisor.requiredNextTool ?? "report_lint"
  const prompt = [
    `Operation ${operationID} has a failed final operation audit. Repair the reporting closeout instead of idling.`,
    supervisor.modelPrompt,
    `Required next tool: ${nextTool}.`,
    "Read deliverables/operation-audit.json first, then fix every listed blocker.",
    "Use the report pipeline tools as needed: report_outline for page/section budget issues, report_lint for content gaps, report_render for final HTML/PDF packaging, runtime_summary for accounting, and operation_audit to prove the final gates.",
    "Do not mark the operation ready until operation_audit passes with the same strict handoff gates.",
  ]
    .filter((line): line is string => !!line)
    .join("\n\n")
  return {
    description: "Repair final report audit",
    prompt,
    subagent_type: "report-writer",
    operationID,
    laneID: REPORT_REPAIR_LANE_ID,
    modelRoute: "openai/gpt-5.5-fast",
    background: true,
  }
}

async function defaultSupervisorEnabled(worktree: string, operationID: string, configured: boolean | undefined) {
  if (configured !== undefined) return configured
  const goal = (await readOperationGoal(worktree, operationID)).goal
  return (goal?.targetDurationHours ?? 0) >= 1
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
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

async function shouldEnsureReadinessProof(worktree: string, operationID: string, configured: boolean | undefined) {
  if (configured !== undefined) return configured
  const goal = (await readOperationGoal(worktree, operationID)).goal
  if ((goal?.targetDurationHours ?? 0) >= 20) return true
  const plan = await readJson<{ timeBudget?: { targetHours?: number } }>(
    path.join(operationPath(worktree, operationID), "plans", "operation-plan.json"),
  )
  return (plan?.timeBudget?.targetHours ?? 0) >= 20
}

async function ensureReadinessProofArtifacts(
  worktree: string,
  input: { operationID: string; toolManifestPath?: string; enabled?: boolean },
) {
  if (!(await shouldEnsureReadinessProof(worktree, input.operationID, input.enabled))) return
  const root = operationPath(worktree, input.operationID)
  if (!(await exists(path.join(root, "tools", "tool-preflight.json")))) {
    await acquireManifestTools({
      worktree,
      operationID: input.operationID,
      manifestPath: input.toolManifestPath,
    }).catch((error) =>
      writeJson(path.join(root, "tools", "tool-preflight.json"), {
        operationID: input.operationID,
        total: 1,
        available: 0,
        blocked: 1,
        installed: 0,
        installAttempted: false,
        tools: [
          {
            operationID: input.operationID,
            toolID: "tool-manifest",
            available: false,
            installed: false,
            blocker: error instanceof Error ? error.message : String(error),
            validationCommand: "read tool manifest",
            fallbacks: [],
          },
        ],
        checkedAt: new Date().toISOString(),
      }),
    )
  }
  if (!(await exists(path.join(root, "deliverables", "model-route-audit.json")))) {
    await writeRuntimeGovernorRouteAudit(worktree, { operationID: input.operationID })
  }
}

async function maybeRunSupervisor(
  worktree: string,
  input: RuntimeSchedulerInput & { operationID: string; now: Date; lastSupervisorReviewAt?: Date },
): Promise<RuntimeSchedulerSupervisorSummary | undefined> {
  const enabled = await defaultSupervisorEnabled(worktree, input.operationID, input.supervisorEnabled)
  const intervalMinutes = Math.max(0, input.supervisorIntervalMinutes ?? 30)
  if (!enabled) return { enabled, ran: false, nextTools: [], blocking: false }
  if (!supervisorIntervalElapsed({ now: input.now, last: input.lastSupervisorReviewAt, intervalMinutes })) {
    return { enabled, ran: false, nextTools: [], blocking: false }
  }
  const review = await superviseOperation(
    worktree,
    {
      operationID: input.operationID,
      reviewKind: input.supervisorReviewKind ?? "heartbeat",
      maxActions: 5,
      writeArtifacts: true,
    },
    { now: input.now.toISOString() },
  )
  const primary = review.decisions[0]
  const nextTools = [
    ...new Set(review.decisions.map((item) => item.requiredNextTool).filter((tool): tool is string => !!tool)),
  ]
  const action = primary?.action
  return {
    enabled,
    ran: true,
    action,
    reason: primary?.reason,
    requiredNextTool: primary?.requiredNextTool,
    operatorMessage: primary?.operatorMessage,
    modelPrompt: primary?.modelPrompt,
    nextTools,
    blocking: supervisorBlocks(action),
    generatedAt: review.generatedAt,
    files: review.files,
  }
}

export async function runRuntimeScheduler(
  worktree: string,
  input: RuntimeSchedulerInput,
): Promise<RuntimeSchedulerResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const schedulerDir = path.join(root, "scheduler")
  const heartbeatPath = path.join(schedulerDir, "heartbeat.json")
  const logPath = path.join(schedulerDir, "scheduler.jsonl")
  const maxCycles = Math.max(1, input.maxCycles ?? 1)
  const cycles: RuntimeSchedulerCycle[] = []
  let lastSupervisorReviewAt = parseDate(input.lastSupervisorReviewAt)
  let stopped = false
  let reason = "max scheduler cycles reached"

  await ensureReadinessProofArtifacts(worktree, {
    operationID,
    toolManifestPath: input.toolManifestPath,
    enabled: input.ensureReadinessProof,
  })

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const now = input.now ?? new Date()
    const lease = await requeueStaleWorkUnits(worktree, {
      operationID,
      leaseSeconds: input.leaseSeconds,
      now,
    })
    const sync = await syncOperationRuntimeState(worktree, {
      operationID,
      backgroundJobs: input.backgroundJobs,
    })
    const supervisor = await maybeRunSupervisor(worktree, {
      ...input,
      operationID,
      now,
      lastSupervisorReviewAt,
    })
    if (supervisor?.generatedAt) lastSupervisorReviewAt = new Date(supervisor.generatedAt)

    let run: OperationRunResult | undefined
    let launchedJobs: string[] = []
    let launchedCommandJobs: string[] = []
    if (supervisor?.action === "continue_reporting" && input.launchModelLane) {
      const launched = hasActiveReportRepairJob({ operationID, backgroundJobs: input.backgroundJobs })
        ? undefined
        : await input.launchModelLane(reportRepairTaskParams(operationID, supervisor))
      launchedJobs = launched?.jobID ? [launched.jobID] : []
    } else if (!supervisor?.blocking) {
      run = await runOperationStep(worktree, {
        operationID,
        backgroundJobs: input.backgroundJobs,
      })
      const launched = run.taskParams && input.launchModelLane ? await input.launchModelLane(run.taskParams) : undefined
      launchedJobs = launched?.jobID ? [launched.jobID] : []
    }
    const commandUnits =
      !supervisor?.blocking && supervisor?.action !== "continue_reporting" && input.launchCommandWorkUnit
        ? await nextWorkUnits(worktree, {
            operationID,
            limit: input.commandWorkUnitLimit ?? 2,
            claim: true,
          }).catch((error) => {
            if ((error as Error).message.includes("work queue is missing")) {
              return { units: [] } as Pick<WorkQueueNextResult, "units">
            }
            throw error
          })
        : { units: [] }
    for (const unit of commandUnits.units) {
      const launchedCommand = await input.launchCommandWorkUnit?.({ ...unit.commandSupervise, dryRun: false })
      if (launchedCommand?.jobID) {
        launchedCommandJobs.push(launchedCommand.jobID)
        await bindWorkUnitJob(worktree, { operationID, workUnitID: unit.id, jobID: launchedCommand.jobID })
      }
    }
    const governor = await evaluateRuntimeGovernor(worktree, { operationID, laneID: run?.laneID })
    const record: RuntimeSchedulerCycle = {
      cycle,
      time: now.toISOString(),
      sync,
      supervisor,
      run,
      governor,
      requeuedWorkUnits: lease.requeuedUnits,
      launchedJobs,
      launchedCommandJobs,
    }
    cycles.push(record)
    await appendJsonl(logPath, record)
    await writeJson(heartbeatPath, {
      operationID,
      cycle,
      time: record.time,
      supervisorAction: supervisor?.action,
      supervisorReason: supervisor?.reason,
      supervisorRan: supervisor?.ran ?? false,
      lastAction: run?.action ?? (supervisor?.blocking ? "supervisor_blocked" : undefined),
      lastReason: run?.reason ?? supervisor?.reason,
      governorAction: governor.action,
      governorReason: governor.reason,
      requeuedWorkUnits: lease.requeuedUnits,
      syncedJobs: sync.syncedJobs,
      syncedWorkUnits: sync.syncedWorkUnits,
      launchedJobs,
      launchedCommandJobs,
      stopped: false,
    })

    if (supervisor?.blocking) {
      stopped = supervisor.action === "blocked" || supervisor.action === "pause"
      reason = supervisor.reason ?? `supervisor requested ${supervisor.action}`
      break
    }
    if (supervisor?.action === "continue_reporting") {
      reason = supervisor.reason ?? "supervisor requested reporting continuation"
      break
    }
    if (!run) {
      stopped = true
      reason = "scheduler did not produce an operation run"
      break
    }
    if (run.action === "stop" || governor.action === "stop") {
      stopped = true
      reason = governor.action === "stop" ? governor.reason : run.reason
      break
    }
    if (run.action === "wait" || run.action === "schedule") {
      reason = run.reason
      break
    }
  }

  await writeJson(heartbeatPath, {
    operationID,
    cycles: cycles.length,
    time: new Date().toISOString(),
    supervisorAction: cycles.at(-1)?.supervisor?.action,
    supervisorReason: cycles.at(-1)?.supervisor?.reason,
    supervisorRan: cycles.at(-1)?.supervisor?.ran ?? false,
    lastAction: cycles.at(-1)?.run?.action ?? (cycles.at(-1)?.supervisor?.blocking ? "supervisor_blocked" : undefined),
    lastReason: cycles.at(-1)?.run?.reason ?? cycles.at(-1)?.supervisor?.reason,
    governorAction: cycles.at(-1)?.governor.action,
    governorReason: cycles.at(-1)?.governor.reason,
    launchedJobs: cycles.at(-1)?.launchedJobs ?? [],
    launchedCommandJobs: cycles.at(-1)?.launchedCommandJobs ?? [],
    stopped,
    reason,
  })
  return { operationID, heartbeatPath, logPath, cycles, stopped, reason }
}

export function formatRuntimeScheduler(result: RuntimeSchedulerResult) {
  return [
    `# Runtime Scheduler: ${result.operationID}`,
    "",
    `- cycles: ${result.cycles.length}`,
    `- stopped: ${result.stopped}`,
    `- reason: ${result.reason}`,
    `- heartbeat: ${result.heartbeatPath}`,
    `- log: ${result.logPath}`,
    "",
    "## Cycles",
    "",
    ...result.cycles.map(
      (cycle) =>
        `- ${cycle.cycle}: supervisor=${cycle.supervisor?.action ?? "skipped"} run=${cycle.run?.action ?? "none"} governor=${cycle.governor.action} requeued=${cycle.requeuedWorkUnits.length} launched=${cycle.launchedJobs.length} command_jobs=${cycle.launchedCommandJobs.length}`,
    ),
    "",
    "<runtime_scheduler_json>",
    JSON.stringify(result, null, 2),
    "</runtime_scheduler_json>",
  ].join("\n")
}
