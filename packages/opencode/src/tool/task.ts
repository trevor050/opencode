import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { ToolJsonSchema } from "./json-schema"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { SessionStatus } from "@/session/status"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Effect, Exit, Option, Schema, Scope, Stream } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { summarizeRuntimeUsage, type RuntimeUsageMessage } from "@/ulm/artifact"
import { containsRawCredentialSecret, credentialGuessingPolicyGaps } from "@/ulm/credential-safety"
import { readULMConfig, type ULMRuntimeConfig } from "@/ulm/config"
import { assertLaneToolAllowed, LANE_GUARDED_TOOLS } from "@/ulm/lane-tool-guard"
import { Database } from "@opencode-ai/core/database/database"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { EventV2Bridge } from "@/event-v2-bridge"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<SessionV1.WithParts>
  loop(input: SessionPrompt.LoopInput): Effect.Effect<SessionV1.WithParts>
}

const id = "task"
const BACKGROUND_DESCRIPTION = [
  "Background mode: background=true launches the subagent asynchronously and returns immediately.",
  "Foreground is the default; use it when you need the result before continuing.",
  "Use background only for independent work that can run while you continue elsewhere.",
  "You will be notified automatically when it finishes.",
  "For ULMCode operation lanes, pass operationID and laneID so task metadata can be recovered after restart.",
].join(" ")
const BACKGROUND_STARTED = [
  "state: running",
  "The task is working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")
const BACKGROUND_UPDATED = [
  "state: running",
  "Additional context sent to the running background task.",
  "The task is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, ask the task for status, or duplicate this task's work — avoid working with the same files or topics it is using.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const BaseParameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  operationID: Schema.optional(Schema.String).annotate({
    description: "Optional ULMCode operation ID used to scope persisted background task metadata.",
  }),
  laneID: Schema.optional(Schema.String).annotate({
    description: "Optional ULMCode operation lane ID used to reconcile background task completion with the operation graph.",
  }),
  modelRoute: Schema.optional(Schema.String).annotate({
    description: "Optional provider/model route override for operation lanes, for example openai/gpt-5.5.",
  }),
  allowedTools: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Optional ULMCode lane tool allowlist enforced for the child task session.",
  }),
})

export const Parameters = Schema.Struct({
  ...BaseParameters.fields,
  background: Schema.optional(Schema.Boolean).annotate({
    description:
      "Run the agent in the background. You will be notified when it completes. DO NOT sleep, poll, or proactively check on its progress",
  }),
})

function renderOutput(input: {
  sessionID: SessionID
  state: "running" | "completed" | "error"
  summary?: string
  text: string
}) {
  const tag = input.state === "error" ? "task_error" : "task_result"
  return [
    `task_id: ${input.sessionID}`,
    `state: ${input.state}`,
    `<task id="${input.sessionID}" state="${input.state}">`,
    ...(input.summary ? [`<summary>${input.summary}</summary>`] : []),
    `<${tag}>`,
    input.text,
    `</${tag}>`,
    "</task>",
  ].join("\n")
}

function modelFromRoute(route: string | undefined) {
  if (!route) return undefined
  const [providerID, ...modelParts] = route.split("/")
  const modelID = modelParts.join("/")
  if (!providerID || !modelID) return undefined
  return { providerID: ProviderV2.ID.make(providerID), modelID: ModelV2.ID.make(modelID) }
}

function laneChildToolOverrides(allowedTools: readonly string[] | undefined) {
  if (!allowedTools) return {}
  const allowed = new Set(allowedTools)
  return Object.fromEntries(LANE_GUARDED_TOOLS.map((tool) => [tool, allowed.has(tool)]))
}

function operationScopedTaskPrompt(params: Schema.Schema.Type<typeof Parameters>) {
  if (!params.operationID) return params.prompt
  return [
    `You are working inside an existing ULMCode operation: ${params.operationID}.`,
    ...(params.laneID ? [`Operation lane: ${params.laneID}.`] : []),
    "Do not create, edit, or delete project-level AGENTS.md, agents.md, agent notes, or repo memory files unless the parent prompt explicitly asks for that exact file change.",
    "For operation continuity, use operation tools and artifacts under .ulmcode/operations/ for this operation.",
    "",
    params.prompt,
  ].join("\n")
}

function runtimeUsageMessage(message: SessionV1.WithParts): RuntimeUsageMessage {
  return {
    role: message.info.role,
    agent: message.info.agent,
    modelID: message.info.role === "assistant" ? message.info.modelID : message.info.model?.modelID,
    providerID: message.info.role === "assistant" ? message.info.providerID : message.info.model?.providerID,
    cost: message.info.role === "assistant" ? message.info.cost : undefined,
    tokens: message.info.role === "assistant" ? message.info.tokens : undefined,
    summary: message.info.role === "assistant" ? message.info.summary : undefined,
    parts: message.parts.map((part) => ({
      type: part.type,
      auto: part.type === "compaction" ? part.auto : undefined,
      overflow: part.type === "compaction" ? part.overflow : undefined,
    })),
  }
}

function latestToolActivity(messages: SessionV1.WithParts[]) {
  const times = messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (part.type !== "tool") return []
      if (part.state.status === "pending") return []
      if (part.state.status === "running") return [part.state.time.start]
      return [part.state.time.end, part.state.time.start]
    }),
  )
  return Math.max(0, ...times)
}

function duplicateOperationTask(
  jobs: BackgroundJob.Info[],
  params: Schema.Schema.Type<typeof Parameters>,
  modelRoute: string | undefined,
) {
  if (!params.operationID) return undefined
  return jobs.find((job) => {
    const metadata = job.metadata ?? {}
    if (job.type !== id) return false
    if (job.status !== "running" && job.status !== "stale") return false
    if (metadata.operationID !== params.operationID) return false
    if ((metadata.laneID ?? undefined) !== (params.laneID ?? undefined)) return false
    if (metadata.subagent_type !== params.subagent_type) return false
    if ((metadata.modelRoute ?? undefined) !== (params.modelRoute ?? modelRoute ?? undefined)) return false
    return metadata.prompt === params.prompt
  })
}

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const events = yield* EventV2Bridge.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const jobs = yield* BackgroundJob.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      assertLaneToolAllowed("task")
      if (
        params.operationID &&
        containsRawCredentialSecret({
          description: params.description,
          prompt: params.prompt,
          command: params.command,
        })
      ) {
        return yield* Effect.fail(new Error("operation-scoped task inputs must not contain raw credential secrets"))
      }
      const guessingGaps = params.operationID
        ? credentialGuessingPolicyGaps({ prompt: params.prompt, command: params.command })
        : []
      if (guessingGaps.length) return yield* Effect.fail(new Error(guessingGaps.join("; ")))
      const cfg = yield* config.get()
      const runInBackground = params.background === true
      if (runInBackground && !flags.experimentalBackgroundSubagents) {
        return yield* Effect.fail(
          new Error("Background subagents require OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true"),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        parentAgent,
        subagent: next,
      })
      const childToolDenies = [
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
        ...(next.permission.some((rule) => rule.permission === id)
          ? []
          : [{ permission: id, pattern: "*" as const, action: "deny" as const }]),
        ...(cfg.experimental?.primary_tools?.map((permission) => ({
          permission,
          pattern: "*" as const,
          action: "deny" as const,
        })) ?? []),
      ]
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          agent: next.name,
          permission: [
            ...childPermission,
            ...childToolDenies.filter(
              (deny) =>
                !childPermission.some(
                  (rule) =>
                    rule.permission === deny.permission && rule.pattern === deny.pattern && rule.action === deny.action,
                ),
            ),
          ],
        }))

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const instanceCtx = yield* InstanceState.context.pipe(Effect.catch(() => Effect.succeed(undefined)))
      const variant = msg.info.variant

      const background = runInBackground
      const routeModel = modelFromRoute(params.modelRoute)
      const model = routeModel ?? next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const modelRouteForDedupe = `${model.providerID}/${model.modelID}`
      const duplicateBackgroundTask =
        background && ctx.extra?.recoverExistingOperationJob !== true
          ? duplicateOperationTask(yield* jobs.list(), params, modelRouteForDedupe)
          : undefined
      if (duplicateBackgroundTask) {
        return {
          title: params.description,
          metadata: {
            parentSessionId: ctx.sessionID,
            parentSessionID: ctx.sessionID,
            sessionId: SessionID.make(duplicateBackgroundTask.id),
            sessionID: SessionID.make(duplicateBackgroundTask.id),
            model,
            operationID: params.operationID,
            laneID: params.laneID,
            modelRoute: params.modelRoute ?? modelRouteForDedupe,
            background: true,
          },
          output: [
            `task_id: ${duplicateBackgroundTask.id} (existing matching operation task)`,
            "state: running",
            "deduped: true",
            "",
            "<task_result>",
            "A matching operation-scoped background task is already running or recoverable. Poll it with task_status instead of starting a duplicate lane.",
            "</task_result>",
          ].join("\n"),
        }
      }
      const parentModel = {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const operationDirectory = instanceCtx?.directory ?? process.cwd()
      const operationWorktree = instanceCtx?.worktree ?? operationDirectory
      const ulmConfig: ULMRuntimeConfig = params.operationID
        ? yield* Effect.promise(() =>
            readULMConfig({ directory: operationDirectory, worktree: operationWorktree }).catch(() => ({})),
          )
        : {}
      const noToolTimeoutMs = ulmConfig.agent_no_tool_timeout_seconds
        ? ulmConfig.agent_no_tool_timeout_seconds * 1000
        : undefined
      const metadata = {
        parentSessionId: ctx.sessionID,
        parentSessionID: ctx.sessionID,
        sessionId: nextSession.id,
        sessionID: nextSession.id,
        model,
        operationID: params.operationID,
        laneID: params.laneID,
        modelRoute: params.modelRoute ?? modelRouteForDedupe,
        background,
      }

      yield* ctx.metadata({
        title: params.description,
        metadata,
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runTask = Effect.fn("TaskTool.runTask")(function* () {
        const parts = yield* ops.resolvePromptParts(operationScopedTaskPrompt(params))
        const result = yield* ops.prompt({
          messageID: MessageID.ascending(),
          sessionID: nextSession.id,
          model: {
            modelID: model.modelID,
            providerID: model.providerID,
          },
          variant: next.model ? undefined : variant,
          agent: next.name,
          tools: {
            ...(canTodo ? {} : { todowrite: false }),
            ...(canTask ? {} : { task: false }),
            ...laneChildToolOverrides(params.allowedTools),
            ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
          },
          parts,
        })
        return result.parts.findLast((item) => item.type === "text")?.text ?? ""
      })

      const guardNoToolActivity = Effect.fn("TaskTool.guardNoToolActivity")(function* () {
        if (!noToolTimeoutMs || noToolTimeoutMs <= 0) return yield* Effect.never
        const startedAt = Date.now()
        for (;;) {
          yield* Effect.sleep("10 seconds")
          const messages = yield* sessions.messages({ sessionID: nextSession.id }).pipe(
            Effect.catch(() => Effect.succeed<SessionV1.WithParts[]>([])),
          )
          const lastToolAt = latestToolActivity(messages)
          const reference = lastToolAt || startedAt
          if (Date.now() - reference >= noToolTimeoutMs) {
            return yield* Effect.fail(
              new Error(
                `Subagent ${nextSession.id} had no tool activity for ${Math.round(noToolTimeoutMs / 1000)} seconds and was stopped by ULMCode watchdog.`,
              ),
            )
          }
        }
      })

      const guardedRunTask = Effect.fn("TaskTool.guardedRunTask")(function* () {
        if (!noToolTimeoutMs) return yield* runTask()
        return yield* Effect.scoped(Effect.race(runTask(), guardNoToolActivity()))
      })

      type ResumeParentInput = {
        userID: MessageID
        state: "completed" | "error"
        attempts?: number
      }
      const resumeParent = (input: ResumeParentInput): Effect.Effect<void> =>
        Effect.gen(function* () {
          if ((yield* status.get(ctx.sessionID)).type !== "idle") {
            if ((input.attempts ?? 0) >= 60) return
            yield* Effect.scoped(
              Effect.gen(function* () {
                const idle = events.subscribe(SessionStatus.Event.Idle)
                yield* idle.pipe(
                  Stream.filter((event) => event.data.sessionID === ctx.sessionID),
                  Stream.take(1),
                  Stream.runDrain,
                  Effect.timeoutOption("1 second"),
                )
              }),
            )
            return yield* resumeParent({ ...input, attempts: (input.attempts ?? 0) + 1 })
          }
          const latest = yield* sessions
            .findMessage(ctx.sessionID, (item) => item.info.role === "user")
            .pipe(Effect.catch(() => Effect.succeed(Option.none())))
          if (Option.isNone(latest)) return
          if (latest.value.info.id !== input.userID) return
          yield* events.publish(TuiEvent.ToastShow, {
            title: input.state === "completed" ? "Background task complete" : "Background task failed",
            message:
              input.state === "completed"
                ? `Background task "${params.description}" finished. Resuming the main thread.`
                : `Background task "${params.description}" failed. Resuming the main thread.`,
            variant: input.state === "completed" ? "success" : "error",
            duration: 5000,
          })
          yield* ops.loop({ sessionID: ctx.sessionID }).pipe(Effect.ignore)
        })

      const jobMetadata = {
        ...metadata,
        subagent: next.name,
        subagent_type: params.subagent_type,
        description: params.description,
        prompt: params.prompt,
        ...(params.command ? { command: params.command } : {}),
        ...(params.allowedTools ? { allowedTools: params.allowedTools } : {}),
        ...(noToolTimeoutMs ? { agentNoToolTimeoutSeconds: Math.round(noToolTimeoutMs / 1000) } : {}),
        ...(instanceCtx?.worktree ? { worktree: instanceCtx.worktree } : {}),
      }

      const inject = Effect.fn("TaskTool.injectBackgroundResult")(function* (state: "completed" | "error", text: string) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        const message = yield* ops.prompt({
          sessionID: ctx.sessionID,
          noReply: true,
          model: parentModel,
          agent: currentParent.agent ?? ctx.agent,
          variant,
          parts: [
            {
              type: "text",
              synthetic: true,
              text: renderOutput({
                sessionID: nextSession.id,
                state,
                summary:
                  state === "completed"
                    ? `Background task completed: ${params.description}`
                    : `Background task failed: ${params.description}`,
                text,
              }),
            },
          ],
        })
        yield* resumeParent({ userID: message.info.id, state }).pipe(Effect.ignore, Effect.forkIn(scope))
      })

      const notify = Effect.fn("TaskTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* jobs.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      const backgroundRun = guardedRunTask().pipe(
        Effect.flatMap((text) =>
          Effect.gen(function* () {
            const messages = yield* sessions.messages({ sessionID: nextSession.id }).pipe(
              Effect.catch(() => Effect.succeed<SessionV1.WithParts[]>([])),
            )
            const runtimeMessages = messages.map((message) => ({
              ...runtimeUsageMessage(message),
              ...(params.laneID ? { laneID: params.laneID } : {}),
            }))
            yield* jobs.updateMetadata(nextSession.id, {
              runtimeMessages,
              runtimeUsage: summarizeRuntimeUsage(runtimeMessages),
            })
            return text
          }),
        ),
        Effect.onInterrupt(() => ops.cancel(nextSession.id)),
      )

      const backgroundResult = (jobID = nextSession.id) => ({
        title: params.description,
        metadata: {
          ...metadata,
          background: true,
          jobId: jobID,
        },
        output: renderOutput({
          sessionID: nextSession.id,
          state: "running" as const,
          summary: "Background task started",
          text: BACKGROUND_STARTED,
        }),
      })

      if (yield* jobs.extend({ id: nextSession.id, run: backgroundRun })) {
        return {
          title: params.description,
          metadata: {
            ...metadata,
            background: true,
            jobId: nextSession.id,
          },
          output: renderOutput({
            sessionID: nextSession.id,
            state: "running",
            summary: "Background task updated",
            text: BACKGROUND_UPDATED,
          }),
        }
      }

      const info = yield* jobs.start({
        id: nextSession.id,
        type: id,
        title: params.description,
        metadata: jobMetadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: params.description,
            metadata: { ...metadata, background: true, jobId: nextSession.id },
          }),
          notify(nextSession.id),
        ]),
        run: backgroundRun,
      })

      if (background) {
        yield* notify(info.id)
        return backgroundResult(info.id)
      }

      if ((yield* jobs.get(nextSession.id))?.status === "running" && info.metadata?.background === true) {
        return backgroundResult(info.id)
      }

      const runCancel = yield* EffectBridge.make()

      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              jobs.wait({ id: nextSession.id }).pipe(Effect.map((waited) => waited.info)),
              jobs.waitForPromotion(nextSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult(result.id)
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Task failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Task cancelled"))
            return {
              title: params.description,
              metadata,
              output: renderOutput({ sessionID: nextSession.id, state: "completed", text: result?.output ?? "" }),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* Effect.all([cancel, jobs.cancel(nextSession.id)], { discard: true })
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: flags.experimentalBackgroundSubagents
        ? [DESCRIPTION, BACKGROUND_DESCRIPTION].join("\n\n")
        : DESCRIPTION,
      parameters: Parameters,
      jsonSchema: flags.experimentalBackgroundSubagents ? undefined : ToolJsonSchema.fromSchema(BaseParameters),
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
