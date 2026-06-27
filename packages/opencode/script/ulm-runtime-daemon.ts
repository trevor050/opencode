#!/usr/bin/env bun
import { formatRuntimeDaemon, runRuntimeDaemon } from "../src/ulm/runtime-daemon"
import { writeRuntimeSupervisor, type RuntimeSupervisorKind } from "../src/ulm/runtime-supervisor"
import { operationPath, slug } from "../src/ulm/artifact"
import { spawn } from "child_process"
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type { OperationRunResult } from "../src/ulm/operation-run"
import type { RuntimeDaemonInput } from "../src/ulm/runtime-daemon"
import type { BackgroundJob } from "../src/background/job"
import { buildCommandPlan, writeCommandPlan } from "../src/ulm/tool-manifest"
import { resolveScriptWorktree } from "./ulm-script-worktree"

type Args = {
  operationID: string
  durationSeconds: number
  intervalSeconds: number
  maxCycles?: number
  schedulerCyclesPerTick: number
  leaseSeconds?: number
  errorBackoffSeconds?: number
  maxConsecutiveErrors?: number
  staleLockSeconds?: number
  supervisorEnabled?: boolean
  supervisorIntervalMinutes?: number
  supervisorReviewKind?: "startup" | "heartbeat" | "pre_compaction" | "post_compaction" | "pre_handoff" | "manual"
  skipLaptopPreflight: boolean
  detach: boolean
  detachLog?: string
  supervisor?: RuntimeSupervisorKind
  json: boolean
  full: boolean
}

function usage() {
  return [
    "Usage: bun run script/ulm-runtime-daemon.ts <operationID> [options]",
    "",
    "Options:",
    "  --duration-hours <n>        Wall-clock runtime window. Defaults to 20.",
    "  --duration-seconds <n>      Wall-clock runtime window in seconds.",
    "  --interval-seconds <n>      Sleep between scheduler ticks. Defaults to 60.",
    "  --max-cycles <n>            Stop after this many daemon ticks.",
    "  --scheduler-cycles <n>      Scheduler cycles per daemon tick. Defaults to 1.",
    "  --lease-seconds <n>         Requeue unbound claimed work units after this lease.",
    "  --error-backoff-seconds <n> Sleep after a failed scheduler tick. Defaults to 30.",
    "  --max-consecutive-errors <n> Stop after this many scheduler failures. Defaults to 3.",
    "  --stale-lock-seconds <n>    Replace daemon locks older than this. Defaults to 900.",
    "  --supervisor-interval-minutes <n>  Supervisor review cadence for long operations. Defaults to 30.",
    "  --supervisor-review-kind <kind>    startup, heartbeat, pre_compaction, post_compaction, pre_handoff, or manual.",
    "  --disable-operation-supervisor     Disable scheduler supervisor reviews even for long operations.",
    "  --skip-laptop-preflight       Bypass the long-run laptop-preflight launch guard for controlled tests.",
    "  --detach                    Launch the 20-hour daemon in the background and return pid/log paths.",
    "  --detach-log <path>          Log file for detached stdout/stderr. Defaults under the operation scheduler dir.",
    "  --supervisor <kind>          Write OS supervisor artifacts: launchd, systemd, or all. Does not start the daemon.",
    "  --json                      Print machine-readable result JSON.",
    "  --full                      With --json, print full daemon internals including scheduler cycles.",
  ].join("\n")
}

function numberOption(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} requires a value`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

function parseArgs(argv: string[]): Args {
  const args = [...argv]
  const operationID = args.shift()
  if (!operationID || operationID === "--help" || operationID === "-h") {
    console.log(usage())
    process.exit(operationID ? 0 : 1)
  }

  let durationSeconds = 20 * 60 * 60
  let intervalSeconds = 60
  let maxCycles: number | undefined
  let schedulerCyclesPerTick = 1
  let leaseSeconds: number | undefined
  let errorBackoffSeconds: number | undefined
  let maxConsecutiveErrors: number | undefined
  let staleLockSeconds: number | undefined
  let supervisorEnabled: boolean | undefined
  let supervisorIntervalMinutes: number | undefined
  let supervisorReviewKind: Args["supervisorReviewKind"]
  let skipLaptopPreflight = false
  let detach = false
  let detachLog: string | undefined
  let supervisor: RuntimeSupervisorKind | undefined
  let json = false
  let full = false

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === "--json") {
      json = true
    } else if (arg === "--full") {
      full = true
    } else if (arg === "--detach") {
      detach = true
    } else if (arg === "--detach-log") {
      detachLog = args[++index]
      if (!detachLog) throw new Error(`${arg} requires a value`)
    } else if (arg === "--supervisor") {
      const value = args[++index]
      if (value !== "launchd" && value !== "systemd" && value !== "all") {
        throw new Error(`${arg} must be launchd, systemd, or all`)
      }
      supervisor = value
    } else if (arg === "--disable-operation-supervisor") {
      supervisorEnabled = false
    } else if (arg === "--skip-laptop-preflight") {
      skipLaptopPreflight = true
    } else if (arg === "--supervisor-interval-minutes") {
      supervisorIntervalMinutes = numberOption(arg, args[++index])
    } else if (arg === "--supervisor-review-kind") {
      const value = args[++index]
      if (
        value !== "startup" &&
        value !== "heartbeat" &&
        value !== "pre_compaction" &&
        value !== "post_compaction" &&
        value !== "pre_handoff" &&
        value !== "manual"
      ) {
        throw new Error(`${arg} must be startup, heartbeat, pre_compaction, post_compaction, pre_handoff, or manual`)
      }
      supervisorReviewKind = value
    } else if (arg === "--duration-hours") {
      durationSeconds = numberOption(arg, args[++index]) * 60 * 60
    } else if (arg === "--duration-seconds") {
      durationSeconds = numberOption(arg, args[++index])
    } else if (arg === "--interval-seconds") {
      intervalSeconds = numberOption(arg, args[++index])
    } else if (arg === "--max-cycles") {
      maxCycles = numberOption(arg, args[++index])
    } else if (arg === "--scheduler-cycles") {
      schedulerCyclesPerTick = numberOption(arg, args[++index])
    } else if (arg === "--lease-seconds") {
      leaseSeconds = numberOption(arg, args[++index])
    } else if (arg === "--error-backoff-seconds") {
      errorBackoffSeconds = numberOption(arg, args[++index])
    } else if (arg === "--max-consecutive-errors") {
      maxConsecutiveErrors = numberOption(arg, args[++index])
    } else if (arg === "--stale-lock-seconds") {
      staleLockSeconds = numberOption(arg, args[++index])
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }

  return {
    operationID,
    durationSeconds,
    intervalSeconds,
    maxCycles,
    schedulerCyclesPerTick,
    leaseSeconds,
    errorBackoffSeconds,
    maxConsecutiveErrors,
    staleLockSeconds,
    supervisorEnabled,
    supervisorIntervalMinutes,
    supervisorReviewKind,
    skipLaptopPreflight,
    detach,
    detachLog,
    supervisor,
    json,
    full,
  }
}

const args = parseArgs(process.argv.slice(2))
const operationID = slug(args.operationID, "operation")
const packageRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..")
const worktree = resolveScriptWorktree()
const longRunPreflightBypass = args.skipLaptopPreflight && args.durationSeconds >= 20 * 60 * 60

if (longRunPreflightBypass && process.env.ULMCODE_ALLOW_LONG_RUN_PREFLIGHT_BYPASS !== "1") {
  console.error(
    "--skip-laptop-preflight is blocked for 20h+ daemon launches. Run ulm:laptop-preflight or set ULMCODE_ALLOW_LONG_RUN_PREFLIGHT_BYPASS=1 for a controlled test bypass.",
  )
  process.exit(1)
}

if (longRunPreflightBypass) {
  const bypassPath = path.join(operationPath(worktree, operationID), "scheduler", "laptop-preflight-bypass.json")
  mkdirSync(path.dirname(bypassPath), { recursive: true })
  writeFileSync(
    bypassPath,
    JSON.stringify(
      {
        operationID,
        durationSeconds: args.durationSeconds,
        createdAt: new Date().toISOString(),
        reason: "ULMCODE_ALLOW_LONG_RUN_PREFLIGHT_BYPASS=1 controlled test bypass",
        command: process.argv.slice(2),
      },
      null,
      2,
    ) + "\n",
  )
}

if (args.supervisor) {
  const result = await writeRuntimeSupervisor({
    operationID,
    worktree,
    bunPath: process.execPath,
    scriptPath: fileURLToPath(import.meta.url),
    durationSeconds: args.durationSeconds,
    intervalSeconds: args.intervalSeconds,
    schedulerCyclesPerTick: args.schedulerCyclesPerTick,
    maxCycles: args.maxCycles,
    leaseSeconds: args.leaseSeconds,
    errorBackoffSeconds: args.errorBackoffSeconds,
    maxConsecutiveErrors: args.maxConsecutiveErrors,
    staleLockSeconds: args.staleLockSeconds,
    supervisor: args.supervisor,
  })
  console.log(args.json ? JSON.stringify(result, null, 2) : formatSupervisor(result))
  process.exit(0)
}

function formatSupervisor(result: Awaited<ReturnType<typeof writeRuntimeSupervisor>>) {
  return [
    `# Runtime Daemon Supervisor: ${result.operationID}`,
    "",
    `- supervisor: ${result.supervisor}`,
    `- manifest: ${result.files.manifest}`,
    `- runbook: ${result.files.runbook}`,
    result.files.launchdPlist ? `- launchd: ${result.files.launchdPlist}` : undefined,
    result.files.systemdService ? `- systemd: ${result.files.systemdService}` : undefined,
  ]
    .filter(Boolean)
    .join("\n")
}

function childArgv(argv: string[]) {
  const result: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === "--detach") continue
    if (arg === "--detach-log") {
      index++
      continue
    }
    result.push(arg)
  }
  return result
}

if (args.detach) {
  const daemonDir = path.join(operationPath(worktree, operationID), "scheduler")
  const logPath = path.resolve(args.detachLog ?? path.join(daemonDir, "daemon-process.log"))
  const launchPath = path.join(daemonDir, "daemon-launch.json")
  mkdirSync(path.dirname(logPath), { recursive: true })
  mkdirSync(daemonDir, { recursive: true })
  const logFD = openSync(logPath, "a")
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...childArgv(process.argv.slice(2))], {
    cwd: worktree,
    detached: true,
    stdio: ["ignore", logFD, logFD],
    env: process.env,
  })
  child.unref()
  closeSync(logFD)
  const launch = {
    operationID,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    logPath,
    heartbeatPath: path.join(daemonDir, "daemon-heartbeat.json"),
    schedulerLogPath: path.join(daemonDir, "daemon.jsonl"),
  }
  writeFileSync(launchPath, JSON.stringify(launch, null, 2) + "\n")
  console.log(args.json ? JSON.stringify({ ...launch, launchPath }, null, 2) : formatDetachedLaunch({ ...launch, launchPath }))
  process.exit(0)
}

function formatDetachedLaunch(launch: {
  operationID: string
  pid?: number
  startedAt: string
  logPath: string
  heartbeatPath: string
  schedulerLogPath: string
  launchPath: string
}) {
  return [
    `# Runtime Daemon Launched: ${launch.operationID}`,
    "",
    `- pid: ${launch.pid ?? "unknown"}`,
    `- started_at: ${launch.startedAt}`,
    `- launch: ${launch.launchPath}`,
    `- process_log: ${launch.logPath}`,
    `- heartbeat: ${launch.heartbeatPath}`,
    `- scheduler_log: ${launch.schedulerLogPath}`,
  ].join("\n")
}

function compactRuntimeDaemon(result: Awaited<ReturnType<typeof runRuntimeDaemon>>) {
  return {
    operationID: result.operationID,
    stopped: result.stopped,
    reason: result.reason,
    elapsedSeconds: result.elapsedSeconds,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    lockPath: result.lockPath,
    heartbeatPath: result.heartbeatPath,
    logPath: result.logPath,
    cycleCount: result.cycles.length,
    launchedJobs: result.cycles.flatMap((cycle) => cycle.launchedJobs),
    launchedCommandJobs: result.cycles.flatMap((cycle) => cycle.launchedCommandJobs),
    recoveredJobs: result.recoveredJobs,
  }
}

function launchRecordPath(kind: string, id: string) {
  const dir = path.join(operationPath(worktree, operationID), "scheduler", "cli-launches")
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "")
  return path.join(dir, `${stamp}-${kind}-${id}.json`)
}

function writeLaunchRecord(kind: string, id: string, value: Record<string, unknown>) {
  const file = launchRecordPath(kind, id)
  writeFileSync(file, JSON.stringify({ operationID, kind, id, createdAt: new Date().toISOString(), ...value }, null, 2) + "\n")
  return file
}

function processIsAlive(pid: unknown) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

type CliModelPidRecord = {
  jobID?: string
  pid?: number
  createdAt?: string
}

function activeCliModelLaunch(laneID: string) {
  const dir = path.join(operationPath(worktree, operationID), "scheduler", "cli-launches")
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith(`-model-pid-${laneID}.json`))
      .map((file): CliModelPidRecord | undefined => {
        try {
          return JSON.parse(readFileSync(path.join(dir, file), "utf8")) as CliModelPidRecord
        } catch {
          return undefined
        }
      })
      .filter((record): record is CliModelPidRecord => record !== undefined)
      .toSorted((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
      .find((record) => processIsAlive(record.pid))
  } catch {
    return undefined
  }
}

function cliModelBackgroundJobs(): BackgroundJob.Info[] {
  const root = operationPath(worktree, operationID)
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const launchDir = path.join(root, "scheduler", "cli-launches")
  try {
    const graph = JSON.parse(readFileSync(graphPath, "utf8")) as {
      lanes?: Array<{ id?: string; status?: string }>
    }
    const runningLanes = new Set((graph.lanes ?? []).filter((lane) => lane.status === "running" && lane.id).map((lane) => lane.id as string))
    if (!runningLanes.size) return []
    const pidRecords = readdirSync(launchDir)
      .filter((file) => file.includes("-model-pid-") && file.endsWith(".json"))
      .map((file) => {
        try {
          const record = JSON.parse(readFileSync(path.join(launchDir, file), "utf8")) as {
            laneID?: string
            agent?: string
            modelRoute?: string
            prompt?: string
            allowedTools?: string
            pid?: number
            createdAt?: string
            jobID?: string
          }
          return { ...record, file }
        } catch {
          return undefined
        }
      })
      .filter((record): record is NonNullable<typeof record> => !!record && !!record.laneID && runningLanes.has(record.laneID))
      .toSorted((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
    const latestByLane = new Map<string, (typeof pidRecords)[number]>()
    for (const record of pidRecords) {
      if (record.laneID && !latestByLane.has(record.laneID)) latestByLane.set(record.laneID, record)
    }
    return [...latestByLane.values()]
      .filter((record) => !processIsAlive(record.pid))
      .filter((record) => typeof record.prompt === "string" && typeof record.agent === "string")
      .map((record) => ({
        id: record.jobID ?? `cli-model-lane-${record.laneID}`,
        type: "task",
        title: `CLI model lane ${record.laneID}`,
        status: "stale",
        startedAt: record.createdAt ? Date.parse(record.createdAt) : Date.now(),
        error: `CLI model lane pid ${record.pid ?? "unknown"} is no longer running`,
        metadata: {
          operationID,
          laneID: record.laneID,
          prompt: record.prompt,
          subagent_type: record.agent,
          modelRoute: record.modelRoute,
          allowedTools: record.allowedTools,
          worktree,
        },
      }))
  } catch {
    return []
  }
}

function cliCommandBackgroundJobs(): BackgroundJob.Info[] {
  const root = operationPath(worktree, operationID)
  const launchDir = path.join(root, "scheduler", "cli-launches")
  try {
    return readdirSync(launchDir)
      .filter((file) => file.includes("-command-pid-") && file.endsWith(".json"))
      .map((file): BackgroundJob.Info | undefined => {
        try {
          const record = JSON.parse(readFileSync(path.join(launchDir, file), "utf8")) as {
            profileID?: string
            laneID?: string
            workUnitID?: string
            planPath?: string
            pid?: number
            jobID?: string
            createdAt?: string
          }
          if (!record.jobID || !record.workUnitID) return undefined
          let status: BackgroundJob.Status = "running"
          let completedAt: number | undefined
          let error: string | undefined
          if (!processIsAlive(record.pid)) {
            const heartbeatPath =
              record.planPath
                ? (() => {
                    try {
                      const plan = JSON.parse(readFileSync(record.planPath, "utf8")) as { heartbeatPath?: string }
                      return plan.heartbeatPath
                    } catch {
                      return undefined
                    }
                  })()
                : undefined
            const heartbeat = heartbeatPath
              ? (() => {
                  try {
                    return JSON.parse(readFileSync(heartbeatPath, "utf8")) as {
                      status?: string
                      checkedAt?: string
                      error?: string
                      timedOut?: string
                    }
                  } catch {
                    return undefined
                  }
                })()
              : undefined
            status = heartbeat?.status === "completed" ? "completed" : "error"
            completedAt = heartbeat?.checkedAt ? Date.parse(heartbeat.checkedAt) : Date.now()
            error = heartbeat?.error ?? (heartbeat?.timedOut ? `command ${heartbeat.timedOut} timeout` : `CLI command worker pid ${record.pid ?? "unknown"} is no longer running`)
          }
          return {
            id: record.jobID,
            type: "command_supervise",
            title: `CLI command ${record.profileID ?? record.workUnitID}`,
            status,
            startedAt: record.createdAt ? Date.parse(record.createdAt) : Date.now(),
            completedAt,
            error,
            metadata: {
              operationID,
              laneID: record.laneID,
              workUnitID: record.workUnitID,
              profileID: record.profileID,
              worktree,
            },
          } satisfies BackgroundJob.Info
        } catch {
          return undefined
        }
      })
      .filter((job): job is BackgroundJob.Info => job !== undefined)
  } catch {
    return []
  }
}

function launchModelLane(params: NonNullable<OperationRunResult["taskParams"]>) {
  const jobID = `cli-model-lane-${params.laneID}`
  const active = activeCliModelLaunch(params.laneID)
  if (active?.jobID) {
    writeLaunchRecord("model-reuse", params.laneID, { jobID: active.jobID, pid: active.pid })
    return Promise.resolve({ jobID: active.jobID })
  }
  const allowedTools = params.allowedTools.join(", ")
  const record = {
    laneID: params.laneID,
    agent: params.subagent_type,
    modelRoute: params.modelRoute,
    prompt: params.prompt,
    allowedTools,
  }
  if (process.env.ULMCODE_DAEMON_DRY_RUN_LAUNCHES === "1") {
    writeLaunchRecord("model", params.laneID, { ...record, dryRun: true, jobID })
    return Promise.resolve({ jobID })
  }

  const [provider, ...modelParts] = params.modelRoute.split("/")
  const model = provider && modelParts.length ? params.modelRoute : undefined
  const logPath = writeLaunchRecord("model", params.laneID, { ...record, dryRun: false, jobID })
  const outputPath = launchRecordPath("model-output", params.laneID).replace(/\.json$/, ".log")
  const outputFD = openSync(outputPath, "a")
  const child = spawn(
    process.execPath,
    [
      "run",
      path.join(packageRoot, "src", "index.ts"),
      "run",
      "--dir",
      worktree,
      "--agent",
      params.subagent_type,
      "--title",
      `ULM ${operationID}:${params.laneID}`,
      ...(model ? ["--model", model] : []),
      params.prompt,
    ],
    {
      cwd: packageRoot,
      detached: true,
      stdio: ["ignore", outputFD, outputFD],
      env: {
        ...process.env,
        ULMCODE_DAEMON_CHILD: "1",
        ULMCODE_LANE_ID: params.laneID,
        ULMCODE_LANE_ALLOWED_TOOLS: allowedTools,
      },
    },
  )
  child.unref()
  closeSync(outputFD)
  writeLaunchRecord("model-pid", params.laneID, { ...record, pid: child.pid, logPath, outputPath, jobID })
  return Promise.resolve({ jobID })
}

async function recoverCliModelJob(job: BackgroundJob.Info) {
  const laneID = typeof job.metadata?.laneID === "string" ? job.metadata.laneID : undefined
  const prompt = typeof job.metadata?.prompt === "string" ? job.metadata.prompt : undefined
  const subagentType = typeof job.metadata?.subagent_type === "string" ? job.metadata.subagent_type : undefined
  if (!laneID || !prompt || !subagentType) return undefined
  const allowedTools =
    typeof job.metadata?.allowedTools === "string"
      ? job.metadata.allowedTools
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  return launchModelLane({
    description: `Recover ${laneID}`,
    prompt,
    subagent_type: subagentType,
    operationID,
    laneID,
    modelRoute: typeof job.metadata?.modelRoute === "string" ? job.metadata.modelRoute : "openai/gpt-5.5",
    allowedTools,
    background: true,
  })
}

async function launchCommandWorkUnit(params: Parameters<NonNullable<RuntimeDaemonInput["launchCommandWorkUnit"]>>[0]) {
  const jobID = `cli-command-${params.workUnitID ?? params.profileID}`
  const plan = await buildCommandPlan({
    worktree,
    operationID,
    profileID: params.profileID,
    variables: params.variables,
    outputPrefix: params.outputPrefix,
  })
  await writeCommandPlan(plan)
  writeLaunchRecord("command", params.workUnitID ?? params.profileID, {
    profileID: params.profileID,
    laneID: params.laneID,
    workUnitID: params.workUnitID,
    variables: params.variables,
    outputPrefix: params.outputPrefix,
    planPath: plan.planPath,
    command: plan.command,
    stdoutPath: plan.stdoutPath,
    stderrPath: plan.stderrPath,
    heartbeatPath: plan.heartbeatPath,
    jobID,
    dryRun: process.env.ULMCODE_DAEMON_DRY_RUN_LAUNCHES === "1",
  })
  if (process.env.ULMCODE_DAEMON_DRY_RUN_LAUNCHES === "1") return { jobID }

  const child = spawn(process.execPath, ["run", path.join(packageRoot, "script", "ulm-command-worker.ts"), plan.planPath], {
    cwd: packageRoot,
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, ULMCODE_DAEMON_CHILD: "1" },
  })
  child.unref()
  writeLaunchRecord("command-pid", params.workUnitID ?? params.profileID, {
    profileID: params.profileID,
    laneID: params.laneID,
    workUnitID: params.workUnitID,
    planPath: plan.planPath,
    pid: child.pid,
    jobID,
  })
  return { jobID }
}

const controller = new AbortController()
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort(signal))
}

try {
  const result = await runRuntimeDaemon(worktree, {
    operationID: args.operationID,
    maxRuntimeSeconds: args.durationSeconds,
    cycleIntervalSeconds: args.intervalSeconds,
    maxCycles: args.maxCycles,
    schedulerCyclesPerTick: args.schedulerCyclesPerTick,
    leaseSeconds: args.leaseSeconds,
    errorBackoffSeconds: args.errorBackoffSeconds,
    maxConsecutiveErrors: args.maxConsecutiveErrors,
    staleLockSeconds: args.staleLockSeconds,
    supervisorEnabled: args.supervisorEnabled,
    supervisorIntervalMinutes: args.supervisorIntervalMinutes,
    supervisorReviewKind: args.supervisorReviewKind,
    requireLaptopPreflight: args.skipLaptopPreflight ? false : undefined,
    includeInstalledModelRouteAudit: true,
    backgroundJobProvider: async () => cliModelBackgroundJobs(),
    commandJobProvider: async () => cliCommandBackgroundJobs(),
    recoverBackgroundJob: recoverCliModelJob,
    launchModelLane,
    launchCommandWorkUnit,
    signal: controller.signal,
  })
  console.log(args.json ? JSON.stringify(args.full ? result : compactRuntimeDaemon(result), null, 2) : formatRuntimeDaemon(result))
  process.exit(result.stopped && result.reason !== "signal" ? 2 : 0)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
