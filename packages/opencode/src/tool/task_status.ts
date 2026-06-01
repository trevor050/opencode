import * as Tool from "./tool"
import DESCRIPTION from "./task_status.txt"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { SessionLegacy } from "@opencode-ai/core/session/legacy"
import { SessionStatus } from "@/session/status"
import { PositiveInt } from "@/util/schema"
import { BackgroundJob } from "@/background/job"
import { taskRestartArgs } from "./task_restart_args"
import { Effect, Exit, Option, Schema } from "effect"

const DEFAULT_TIMEOUT = 60_000
const ULM_OPERATION_WAIT_TIMEOUT = 30_000
const POLL_MS = 300

export const Parameters = Schema.Struct({
  task_id: SessionID.annotate({ description: "The task_id returned by the task tool" }),
  wait: Schema.optional(Schema.Boolean).annotate({
    description: "When true, wait until the task reaches a terminal state or timeout.",
  }),
  timeout_ms: Schema.optional(PositiveInt).annotate({
    description: "Maximum milliseconds to wait when wait=true. Defaults to 60000.",
  }),
})

type State = "running" | "completed" | "error" | "stale" | "unknown"
type InspectResult = { state: State; text: string }
type Metadata = { task_id: SessionID; state: State; timed_out: boolean }

export function taskStatusWaitTimeout(input: { job?: BackgroundJob.Info; requestedTimeout?: number; wait?: boolean }) {
  if (input.job?.metadata?.operationID && input.wait === true) {
    return Math.min(input.requestedTimeout ?? DEFAULT_TIMEOUT, ULM_OPERATION_WAIT_TIMEOUT)
  }
  return input.requestedTimeout ?? DEFAULT_TIMEOUT
}

function format(input: { taskID: SessionID; state: State; text: string }) {
  const tag = input.state === "completed" || input.state === "running" ? "task_result" : "task_error"
  return [`task_id: ${input.taskID}`, `state: ${input.state}`, "", `<${tag}>`, input.text, `</${tag}>`].join("\n")
}

function errorText(error: NonNullable<SessionLegacy.Assistant["error"]>) {
  const data = Reflect.get(error, "data")
  const message = data && typeof data === "object" ? Reflect.get(data, "message") : undefined
  if (typeof message === "string" && message) return message
  return error.name
}

function jobResult(job: BackgroundJob.Info): InspectResult {
  if (job.status === "running") return { state: "running", text: "Task is still running." }
  if (job.status === "completed") return { state: "completed", text: job.output ?? "" }
  if (job.status === "stale") {
    const restartArgs = taskRestartArgs(job)
    return {
      state: "stale",
      text: [
        job.error ?? "Task was persisted as running, but the process no longer has its running fiber.",
        restartArgs ? `restart_args: ${JSON.stringify(restartArgs)}` : undefined,
      ]
        .filter((line): line is string => line !== undefined)
        .join("\n"),
    }
  }
  return { state: "error", text: job.error ?? `Task ${job.status}.` }
}

function timeoutText(input: { timeout: number; job?: BackgroundJob.Info }) {
  const base = `Timed out after ${input.timeout}ms while waiting for task completion.`
  if (!input.job?.metadata?.operationID) return base
  return [
    base,
    "ULM recovery policy: if no fresh lane-owned artifacts appeared after this bounded poll, the next tool should be operation_run with block_lane or skip_lane and a precise recovery reason. Do not keep rereading old operation artifacts.",
  ].join("\n")
}

function similarTaskIDs(input: { requested: string; jobs: BackgroundJob.Info[] }) {
  const requested = input.requested
  return input.jobs
    .map((job) => {
      let prefix = 0
      while (prefix < requested.length && prefix < job.id.length && requested[prefix] === job.id[prefix]) prefix++
      const lengthDelta = Math.abs(requested.length - job.id.length)
      return { job, score: prefix - lengthDelta * 3 }
    })
    .toSorted((a, b) => b.score - a.score || b.job.startedAt - a.job.startedAt)
    .slice(0, 5)
    .map((item) => item.job)
}

export function unknownTaskText(input: { taskID: string; jobs: BackgroundJob.Info[] }) {
  const candidates = similarTaskIDs({ requested: input.taskID, jobs: input.jobs })
  return [
    `Unknown task_id: ${input.taskID}`,
    candidates.length
      ? [
          "Known background task_ids:",
          ...candidates.map((job) => {
            const operationID = typeof job.metadata?.operationID === "string" ? job.metadata.operationID : undefined
            const laneID = typeof job.metadata?.laneID === "string" ? job.metadata.laneID : undefined
            return [
              `- ${job.id}`,
              `status=${job.status}`,
              operationID ? `operationID=${operationID}` : undefined,
              laneID ? `laneID=${laneID}` : undefined,
              job.title ? `title=${job.title}` : undefined,
            ]
              .filter((part): part is string => !!part)
              .join(" ")
          }),
          "Retry task_status with the exact task_id from this list, or use task_list/operation_status if none match.",
        ].join("\n")
      : "No background task IDs are currently known. Use task_list or operation_status to rediscover active work.",
  ].join("\n")
}

export const TaskStatusTool = Tool.define<typeof Parameters, Metadata, Session.Service | SessionStatus.Service | BackgroundJob.Service>(
  "task_status",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const jobs = yield* BackgroundJob.Service

    const inspect: (taskID: SessionID) => Effect.Effect<InspectResult> = Effect.fn("TaskStatusTool.inspect")(function* (
      taskID,
    ) {
      const current = yield* status
        .get(taskID)
        .pipe(Effect.catch(() => Effect.succeed({ type: "idle" as const })))
      if (current.type === "busy" || current.type === "retry") {
        return {
          state: "running" as const,
          text: current.type === "retry" ? `Task is retrying: ${current.message}` : "Task is still running.",
        }
      }

      const latestAssistant = yield* sessions
        .findMessage(taskID, (item) => item.info.role === "assistant")
        .pipe(Effect.catch(() => Effect.succeed(Option.none())))
      if (Option.isNone(latestAssistant)) return { state: "running" as const, text: "Task has not produced output yet." }
      if (latestAssistant.value.info.role !== "assistant") {
        return { state: "running" as const, text: "Task has not produced output yet." }
      }

      const latestUser = yield* sessions
        .findMessage(taskID, (item) => item.info.role === "user")
        .pipe(Effect.catch(() => Effect.succeed(Option.none())))
      if (
        Option.isSome(latestUser) &&
        latestUser.value.info.role === "user" &&
        latestUser.value.info.id > latestAssistant.value.info.id
      ) {
        return { state: "running" as const, text: "Task is starting." }
      }

      const text = latestAssistant.value.parts.findLast((part) => part.type === "text")?.text ?? ""
      if (latestAssistant.value.info.error) return { state: "error" as const, text: text || errorText(latestAssistant.value.info.error) }

      const done =
        !!latestAssistant.value.info.finish && !["tool-calls", "unknown"].includes(latestAssistant.value.info.finish)
      if (done) return { state: "completed" as const, text }
      return { state: "running" as const, text: text || "Task is still running." }
    })

    const waitForTerminal: (
      taskID: SessionID,
      timeout: number,
    ) => Effect.Effect<{ result: InspectResult; timedOut: boolean }> = Effect.fn(
      "TaskStatusTool.waitForTerminal",
    )(function* (taskID, timeout) {
      const result = yield* inspect(taskID)
      if (result.state !== "running") return { result, timedOut: false }
      if (timeout <= 0) return { result, timedOut: true }
      const sleep = Math.min(POLL_MS, timeout)
      yield* Effect.sleep(sleep)
      return yield* waitForTerminal(taskID, timeout - sleep)
    })

    const run = Effect.fn("TaskStatusTool.execute")(function* (params: Schema.Schema.Type<typeof Parameters>) {
      const job = yield* jobs.get(params.task_id)
      const session = yield* sessions.get(params.task_id).pipe(Effect.exit)
      if (Exit.isFailure(session) && !job) {
        const knownJobs = yield* jobs.list()
        return {
          title: "Task status: unknown task_id",
          metadata: {
            task_id: params.task_id,
            state: "unknown" as const,
            timed_out: false,
          },
          output: format({
            taskID: params.task_id,
            state: "unknown",
            text: unknownTaskText({ taskID: params.task_id, jobs: knownJobs }),
          }),
        }
      }
      const effectiveTimeout = taskStatusWaitTimeout({
        job,
        requestedTimeout: params.timeout_ms,
        wait: params.wait,
      })
      const waitedJob =
        job && params.wait === true
          ? yield* jobs.wait({ id: params.task_id, timeout: effectiveTimeout })
          : { info: job, timedOut: false }
      if (waitedJob.info) {
        const result = jobResult(waitedJob.info)
        return {
          title: "Task status",
          metadata: {
            task_id: params.task_id,
            state: result.state,
            timed_out: waitedJob.timedOut,
          },
          output: format({
            taskID: params.task_id,
            state: result.state,
            text: waitedJob.timedOut ? timeoutText({ timeout: effectiveTimeout, job }) : result.text,
          }),
        }
      }

      const waited =
        params.wait === true
          ? yield* waitForTerminal(params.task_id, params.timeout_ms ?? DEFAULT_TIMEOUT)
          : { result: yield* inspect(params.task_id), timedOut: false }

      return {
        title: "Task status",
        metadata: {
          task_id: params.task_id,
          state: waited.result.state,
          timed_out: waited.timedOut,
        },
        output: format({
          taskID: params.task_id,
          state: waited.result.state,
          text: waited.timedOut
            ? `Timed out after ${params.timeout_ms ?? DEFAULT_TIMEOUT}ms while waiting for task completion.`
            : waited.result.text,
        }),
      }
    }, Effect.orDie)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: run,
    }
  }),
)
