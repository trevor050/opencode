import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/layer-node-platform"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { PlanExitTool } from "./plan"
import { Session } from "@/session/session"
import { QuestionTool } from "./question"
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TaskRestartTool } from "./task_restart"
import { TodoWriteTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider"
import { Schema } from "effect"
import z from "zod"
import { Plugin } from "../plugin"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { WebSearchTool } from "./websearch"
import { LspTool } from "./lsp"
import * as Truncate from "./truncate"
import { ApplyPatchTool } from "./apply_patch"
import { Glob } from "@opencode-ai/core/util/glob"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Question } from "../question"
import { Todo } from "../session/todo"
import { LSP } from "@/lsp/lsp"
import { Instruction } from "../session/instruction"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Bus } from "@/bus"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Permission } from "@/permission"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { BackgroundJob } from "@/background/job"
import { SessionStatus } from "@/session/status"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { OperationCheckpointTool } from "./operation_checkpoint"
import { OperationBoardTool } from "./operation_board"
import { OperationAuditTool } from "./operation_audit"
import { OperationCredentialsTool } from "./operation_credentials"
import { OperationGovernorTool } from "./operation_governor"
import { OperationNextTool } from "./operation_next"
import { OperationPlanTool } from "./operation_plan"
import { OperationQueueTool } from "./operation_queue"
import { OperationQueueNextTool } from "./operation_queue_next"
import { OperationRecoverTool } from "./operation_recover"
import { OperationResumeTool } from "./operation_resume"
import { OperationRunTool } from "./operation_run"
import { OperationScheduleTool } from "./operation_schedule"
import { OperationStageGateTool } from "./operation_stage_gate"
import { OperationStrategyTool } from "./operation_strategy"
import { OperationStatusTool } from "./operation_status"
import { ReportLintTool } from "./report_lint"
import { ReportOutlineTool } from "./report_outline"
import { ReportRenderTool } from "./report_render"
import { RuntimeDaemonTool } from "./runtime_daemon"
import { RuntimeSchedulerTool } from "./runtime_scheduler"
import { RuntimeSummaryTool } from "./runtime_summary"
import { CommandSuperviseTool } from "./command_supervise"
import { EvidenceNormalizeTool } from "./evidence_normalize"
import { ToolAcquireTool } from "./tool_acquire"
import { LaptopPreflightTool } from "./laptop_preflight"
import { DistrictProfileTool } from "./district_profile"
import { EvidenceRecordTool } from "./evidence_record"
import { FindingRecordTool } from "./finding_record"
import { IdentityGraphTool } from "./identity_graph"
import { PersonProfileTool } from "./person_profile"
import { TaskStatusTool } from "./task_status"

export function webSearchEnabled(providerID: ProviderV2.ID, flags = { exa: false, parallel: false }) {
  return providerID === ProviderV2.ID.opencode || flags.exa || flags.parallel
}

type TaskDef = Tool.InferDef<typeof TaskTool>
type ReadDef = Tool.InferDef<typeof ReadTool>

type State = {
  custom: Tool.Def[]
  builtin: Tool.Def[]
  task: TaskDef
  read: ReadDef
}

export interface Interface {
  readonly ids: () => Effect.Effect<string[]>
  readonly all: () => Effect.Effect<Tool.Def[]>
  readonly named: () => Effect.Effect<{ task: TaskDef; read: ReadDef }>
  readonly tools: (model: {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    agent: Agent.Info
  }) => Effect.Effect<Tool.Def[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const plugin = yield* Plugin.Service
    const agents = yield* Agent.Service
    const truncate = yield* Truncate.Service
    const flags = yield* RuntimeFlags.Service

    const invalid = yield* InvalidTool
    const task = yield* TaskTool
    const read = yield* ReadTool
    const question = yield* QuestionTool
    const todo = yield* TodoWriteTool
    const lsptool = yield* LspTool
    const plan = yield* PlanExitTool
    const webfetch = yield* WebFetchTool
    const websearch = yield* WebSearchTool
    const shell = yield* ShellTool
    const globtool = yield* GlobTool
    const writetool = yield* WriteTool
    const edit = yield* EditTool
    const greptool = yield* GrepTool
    const patchtool = yield* ApplyPatchTool
    const skilltool = yield* SkillTool
    const districtProfile = yield* DistrictProfileTool
    const evidenceRecord = yield* EvidenceRecordTool
    const findingRecord = yield* FindingRecordTool
    const identityGraph = yield* IdentityGraphTool
    const operationBoard = yield* OperationBoardTool
    const operationAudit = yield* OperationAuditTool
    const taskRestart = yield* TaskRestartTool
    const operationCheckpoint = yield* OperationCheckpointTool
    const operationCredentials = yield* OperationCredentialsTool
    const operationGovernor = yield* OperationGovernorTool
    const operationNext = yield* OperationNextTool
    const operationPlan = yield* OperationPlanTool
    const operationQueue = yield* OperationQueueTool
    const operationQueueNext = yield* OperationQueueNextTool
    const operationRecover = yield* OperationRecoverTool
    const operationResume = yield* OperationResumeTool
    const operationRun = yield* OperationRunTool
    const operationSchedule = yield* OperationScheduleTool
    const operationStageGate = yield* OperationStageGateTool
    const operationStrategy = yield* OperationStrategyTool
    const operationStatus = yield* OperationStatusTool
    const personProfile = yield* PersonProfileTool
    const reportLint = yield* ReportLintTool
    const reportOutline = yield* ReportOutlineTool
    const reportRender = yield* ReportRenderTool
    const runtimeDaemon = yield* RuntimeDaemonTool
    const runtimeScheduler = yield* RuntimeSchedulerTool
    const runtimeSummary = yield* RuntimeSummaryTool
    const taskStatus = yield* TaskStatusTool
    const commandSupervise = yield* CommandSuperviseTool
    const evidenceNormalize = yield* EvidenceNormalizeTool
    const toolAcquire = yield* ToolAcquireTool
    const laptopPreflight = yield* LaptopPreflightTool
    const agent = yield* Agent.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("ToolRegistry.state")(function* (ctx) {
        const custom: Tool.Def[] = []

        function isToolDefinition(value: unknown): value is ToolDefinition {
          return (
            typeof value === "object" &&
            value !== null &&
            typeof Reflect.get(value, "description") === "string" &&
            typeof Reflect.get(value, "execute") === "function"
          )
        }

        function fromPlugin(id: string, def: ToolDefinition): Tool.Def {
          // Plugin tools still expose Zod args publicly; keep that compatibility
          // boxed at the registry boundary and give the LLM the original JSON Schema.
          // Normalize missing args to `{}` once — pre-1.14.49 the code was
          // `z.object(def.args)` and Zod silently tolerated undefined (#27451, #27630).
          const args = def.args ?? {}
          const entries = Object.entries(args)
          const allZod = entries.every((entry) => isZodType(entry[1]))
          const zodParams = allZod ? z.object(args) : undefined
          const jsonSchema = zodParams ? zodJsonSchema(zodParams, entries) : legacyJsonSchema(entries)
          const parameters = zodParams
            ? Schema.declare<unknown>((u): u is unknown => zodParams.safeParse(u).success)
            : Schema.Unknown
          return {
            id,
            parameters,
            jsonSchema,
            description: def.description,
            execute: (args, toolCtx) =>
              Effect.gen(function* () {
                // Bridge the host's Effect-based `ask` into a Promise-returning
                // function for the plugin to make sure context persists
                const bridge = yield* EffectBridge.make()
                const pluginCtx: PluginToolContext = {
                  ...toolCtx,
                  ask: (req) => bridge.promise(toolCtx.ask(req)),
                  directory: ctx.directory,
                  worktree: ctx.worktree,
                }
                const result = yield* Effect.promise(() => def.execute(args as any, pluginCtx))
                const output = typeof result === "string" ? result : result.output
                const metadata = typeof result === "string" ? {} : (result.metadata ?? {})
                const attachments = typeof result === "string" ? undefined : result.attachments
                const info = yield* agent.get(toolCtx.agent)
                const out = yield* truncate.output(output, {}, info)
                return {
                  title: typeof result === "string" ? "" : (result.title ?? ""),
                  output: out.truncated ? out.content : output,
                  attachments,
                  metadata: {
                    ...metadata,
                    truncated: out.truncated,
                    ...(out.truncated && { outputPath: out.outputPath }),
                  },
                }
              }).pipe(
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": id,
                    "session.id": toolCtx.sessionID,
                    "message.id": toolCtx.messageID,
                    ...(toolCtx.callID ? { "tool.call_id": toolCtx.callID } : {}),
                  },
                }),
              ),
          }
        }

        const dirs = yield* config.directories()
        const matches = dirs.flatMap((dir) =>
          Glob.scanSync("{tool,tools}/*.{js,ts}", { cwd: dir, absolute: true, dot: true, symlink: true }),
        )
        if (matches.length) yield* config.waitForDependencies()
        for (const match of matches) {
          const namespace = path.basename(match, path.extname(match))
          // `match` is an absolute filesystem path from `Glob.scanSync(..., { absolute: true })`.
          // Import it as `file://` so Node on Windows accepts the dynamic import.
          const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
          for (const [id, def] of Object.entries<unknown>(mod)) {
            if (!isToolDefinition(def)) continue
            custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
          }
        }

        const plugins = yield* plugin.list()
        for (const p of plugins) {
          for (const [id, def] of Object.entries(p.tool ?? {})) {
            custom.push(fromPlugin(id, def))
          }
        }

        yield* config.get()
        const questionEnabled = ["app", "cli", "desktop"].includes(flags.client) || flags.enableQuestionTool

        const tool = yield* Effect.all({
          invalid: Tool.init(invalid),
          shell: Tool.init(shell),
          read: Tool.init(read),
          glob: Tool.init(globtool),
          grep: Tool.init(greptool),
          edit: Tool.init(edit),
          write: Tool.init(writetool),
          task: Tool.init(task),
          fetch: Tool.init(webfetch),
          todo: Tool.init(todo),
          search: Tool.init(websearch),
          skill: Tool.init(skilltool),
          patch: Tool.init(patchtool),
          question: Tool.init(question),
          lsp: Tool.init(lsptool),
          plan: Tool.init(plan),
        })
        const ulm = yield* Effect.all({
          district_profile: Tool.init(districtProfile),
          evidence_record: Tool.init(evidenceRecord),
          finding_record: Tool.init(findingRecord),
          identity_graph: Tool.init(identityGraph),
          operation_board: Tool.init(operationBoard),
          operation_audit: Tool.init(operationAudit),
          operation_checkpoint: Tool.init(operationCheckpoint),
          operation_credentials: Tool.init(operationCredentials),
          operation_governor: Tool.init(operationGovernor),
          operation_next: Tool.init(operationNext),
          operation_plan: Tool.init(operationPlan),
          operation_queue: Tool.init(operationQueue),
          operation_queue_next: Tool.init(operationQueueNext),
          operation_recover: Tool.init(operationRecover),
          operation_resume: Tool.init(operationResume),
          operation_run: Tool.init(operationRun),
          operation_schedule: Tool.init(operationSchedule),
          operation_stage_gate: Tool.init(operationStageGate),
          operation_strategy: Tool.init(operationStrategy),
          operation_status: Tool.init(operationStatus),
          person_profile: Tool.init(personProfile),
          report_lint: Tool.init(reportLint),
          report_outline: Tool.init(reportOutline),
          report_render: Tool.init(reportRender),
          runtime_daemon: Tool.init(runtimeDaemon),
          runtime_scheduler: Tool.init(runtimeScheduler),
          runtime_summary: Tool.init(runtimeSummary),
          task_restart: Tool.init(taskRestart),
          task_status: Tool.init(taskStatus),
          command_supervise: Tool.init(commandSupervise),
          evidence_normalize: Tool.init(evidenceNormalize),
          tool_acquire: Tool.init(toolAcquire),
          laptop_preflight: Tool.init(laptopPreflight),
        })

        return {
          custom,
          builtin: [
            tool.invalid,
            ...(questionEnabled ? [tool.question] : []),
            tool.shell,
            tool.read,
            tool.glob,
            tool.grep,
            tool.edit,
            tool.write,
            tool.task,
            tool.fetch,
            tool.todo,
            tool.search,
            tool.skill,
            tool.patch,
            ulm.district_profile,
            ulm.evidence_record,
            ulm.finding_record,
            ulm.identity_graph,
            ulm.operation_board,
            ulm.operation_audit,
            ulm.operation_checkpoint,
            ulm.operation_credentials,
            ulm.operation_governor,
            ulm.operation_next,
            ulm.operation_plan,
            ulm.operation_queue,
            ulm.operation_queue_next,
            ulm.operation_recover,
            ulm.operation_resume,
            ulm.operation_run,
            ulm.operation_schedule,
            ulm.operation_stage_gate,
            ulm.operation_strategy,
            ulm.operation_status,
            ulm.person_profile,
            ulm.report_lint,
            ulm.report_outline,
            ulm.report_render,
            ulm.runtime_daemon,
            ulm.runtime_scheduler,
            ulm.runtime_summary,
            ulm.task_restart,
            ulm.task_status,
            ulm.command_supervise,
            ulm.evidence_normalize,
            ulm.tool_acquire,
            ulm.laptop_preflight,
            ...(flags.experimentalLspTool ? [tool.lsp] : []),
            ...(flags.experimentalPlanMode && flags.client === "cli" ? [tool.plan] : []),
          ],
          task: tool.task,
          read: tool.read,
        }
      }),
    )

    const all: Interface["all"] = Effect.fn("ToolRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return [...s.builtin, ...s.custom] as Tool.Def[]
    })

    const ids: Interface["ids"] = Effect.fn("ToolRegistry.ids")(function* () {
      return (yield* all()).map((tool) => tool.id)
    })

    const describeTask = Effect.fn("ToolRegistry.describeTask")(function* (agent: Agent.Info) {
      const items = (yield* agents.list()).filter((item) => item.mode !== "primary")
      const filtered = items.filter(
        (item) => Permission.evaluate("task", item.name, agent.permission).action !== "deny",
      )
      const list = filtered.toSorted((a, b) => a.name.localeCompare(b.name))
      const description = list
        .map(
          (item) =>
            `- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`,
        )
        .join("\n")
      return ["Available agent types and the tools they have access to:", description].join("\n")
    })

    const tools: Interface["tools"] = Effect.fn("ToolRegistry.tools")(function* (input) {
      const filtered = (yield* all()).filter((tool) => {
        if (tool.id === WebSearchTool.id) {
          return webSearchEnabled(input.providerID, { exa: flags.enableExa, parallel: flags.enableParallel })
        }

        const usePatch =
          input.modelID.includes("gpt-") && !input.modelID.includes("oss") && !input.modelID.includes("gpt-4")
        if (tool.id === ApplyPatchTool.id) return usePatch
        if (tool.id === EditTool.id || tool.id === WriteTool.id) return !usePatch

        return true
      })

      return yield* Effect.forEach(
        filtered,
        Effect.fnUntraced(function* (tool: Tool.Def) {
          const output = {
            description: tool.description,
            parameters: tool.parameters,
            jsonSchema: tool.jsonSchema,
          }
          yield* plugin.trigger("tool.definition", { toolID: tool.id }, output)
          const jsonSchema =
            output.parameters === tool.parameters || output.jsonSchema !== tool.jsonSchema
              ? output.jsonSchema
              : undefined
          return {
            id: tool.id,
            description: [output.description, tool.id === TaskTool.id ? yield* describeTask(input.agent) : undefined]
              .filter(Boolean)
              .join("\n"),
            parameters: output.parameters,
            jsonSchema,
            execute: tool.execute,
            formatValidationError: tool.formatValidationError,
          }
        }),
        { concurrency: "unbounded" },
      )
    })

    const named: Interface["named"] = Effect.fn("ToolRegistry.named")(function* () {
      const s = yield* InstanceState.get(state)
      return { task: s.task, read: s.read }
    })

    return Service.of({ ids, all, named, tools })
  }),
)

export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() =>
  layer
    .pipe(
      Layer.provide(Config.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Question.defaultLayer),
      Layer.provide(Todo.defaultLayer),
      Layer.provide(Skill.defaultLayer),
      Layer.provide(Agent.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(Layer.mergeAll(SessionStatus.defaultLayer, BackgroundJob.defaultLayer)),
      Layer.provide(Provider.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(FSUtil.defaultLayer),
      Layer.provide(Bus.layer),
      Layer.provide(Database.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Format.defaultLayer),
      Layer.provide(Ripgrep.defaultLayer),
    )
    .pipe(
      Layer.provide(CrossSpawnSpawner.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
    )
    .pipe(Layer.provide(RuntimeFlags.defaultLayer)),
)

function isZodType(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    (("_zod" in value && typeof Reflect.get(value, "safeParse") === "function") ||
      ("_def" in value && typeof Reflect.get(value, "safeParse") === "function"))
  )
}

function isJsonSchemaDefinition(value: unknown): value is JSONSchema7Definition {
  return typeof value === "boolean" || (typeof value === "object" && value !== null && !Array.isArray(value))
}

function legacyJsonSchema(entries: [string, unknown][]): JSONSchema7 {
  const properties = Object.fromEntries(
    entries.filter((entry): entry is [string, JSONSchema7Definition] => isJsonSchemaDefinition(entry[1])),
  )
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  }
}

function zodDescription(value: unknown) {
  const direct = typeof value === "object" && value !== null ? Reflect.get(value, "description") : undefined
  if (typeof direct === "string" && direct.length > 0) return direct
  const def = typeof value === "object" && value !== null ? Reflect.get(value, "_def") : undefined
  const legacy = typeof def === "object" && def !== null ? Reflect.get(def, "description") : undefined
  return typeof legacy === "string" && legacy.length > 0 ? legacy : undefined
}

function restoreZodDescriptions(schema: JSONSchema7, entries: [string, unknown][]): JSONSchema7 {
  const properties = schema.properties
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return schema
  for (const [name, arg] of entries) {
    const description = zodDescription(arg)
    const property = properties[name]
    if (!description || typeof property !== "object" || property === null || Array.isArray(property)) continue
    if (typeof Reflect.get(property, "description") !== "string") {
      Reflect.set(property, "description", description)
    }
  }
  return schema
}

function zodJsonSchema(schema: z.ZodType, entries: [string, unknown][]): JSONSchema7 {
  const result = normalizeZodJsonSchema(z.toJSONSchema(schema, { io: "input" }))
  if (!isJsonSchemaObject(result)) throw new Error("plugin tool Zod schema produced a non-object JSON Schema")
  const { $defs, ...rest } = result
  return restoreZodDescriptions((
    $defs && isJsonSchemaObject($defs) ? { ...rest, definitions: $defs as JSONSchema7["definitions"] } : rest
  ) as JSONSchema7, entries)
}

function normalizeZodJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeZodJsonSchema(item))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) =>
        (entry[0] === "exclusiveMaximum" || entry[0] === "exclusiveMinimum") && typeof entry[1] === "boolean"
          ? false
          : true,
      )
      .map(([key, item]) => [key, normalizeZodJsonSchema(item)]),
  )
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const node = LayerNode.make({
  service: Service,
  layer: layer.pipe(Layer.provide(Ripgrep.defaultLayer)),
  deps: [
    Config.node,
    Plugin.node,
    Question.node,
    Todo.node,
    Agent.node,
    Skill.node,
    Session.node,
    SessionStatus.node,
    BackgroundJob.node,
    Provider.node,
    LSP.node,
    Instruction.node,
    FSUtil.node,
    Bus.node,
    EventV2Bridge.node,
    httpClient,
    CrossSpawnSpawner.node,
    Format.node,
    Truncate.node,
    RuntimeFlags.node,
    Database.node,
  ],
})

export * as ToolRegistry from "./registry"
