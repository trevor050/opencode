import { Effect, Schema } from "effect"
import { Instance } from "@/project/instance"
import { auditLaptopPreflight, formatLaptopPreflight } from "@/ulm/laptop-preflight"
import { bindOperationSession } from "@/ulm/operation-context"
import * as Tool from "./tool"
import DESCRIPTION from "./laptop_preflight.txt"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  targetHours: Schema.optional(Schema.Number).annotate({
    description: "Target unattended runtime hours to prove launch readiness for. Defaults to 48.",
  }),
  operatorConfirmed: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Operator confirmations already provided. For a real laptop handoff include power, sleep, wifi, scope, and clock.",
  }),
  preparePrerequisites: Schema.optional(Schema.Boolean).annotate({
    description: "When true, write missing tool-preflight and model-route-audit artifacts before auditing.",
  }),
  toolManifestPath: Schema.optional(Schema.String).annotate({
    description: "Optional tool manifest path used while preparing tool-preflight artifacts.",
  }),
})

type Metadata = {
  operationID: string
  status: "ready" | "blocked"
  targetHours: number
  gaps: string[]
  warnings: string[]
  files: {
    json: string
    markdown: string
  }
}

export const LaptopPreflightTool = Tool.define<typeof Parameters, Metadata, never>(
  "laptop_preflight",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() =>
          auditLaptopPreflight(Instance.worktree, {
            operationID: params.operationID,
            targetHours: params.targetHours,
            operatorConfirmed: params.operatorConfirmed ? [...params.operatorConfirmed] : undefined,
            preparePrerequisites: params.preparePrerequisites,
            toolManifestPath: params.toolManifestPath,
          }),
        ).pipe(Effect.orDie)
        yield* Effect.promise(() =>
          bindOperationSession(Instance.worktree, {
            sessionID: ctx.sessionID,
            operationID: result.operationID,
            source: "laptop_preflight",
          }),
        )
        return {
          title: result.status === "ready" ? "laptop preflight ready" : `${result.gaps.length} laptop preflight blockers`,
          output: [
            formatLaptopPreflight(result),
            "<laptop_preflight_json>",
            JSON.stringify(result, null, 2),
            "</laptop_preflight_json>",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            status: result.status,
            targetHours: result.targetHours,
            gaps: result.gaps,
            warnings: result.warnings,
            files: result.files,
          },
        }
      }),
  }),
)
