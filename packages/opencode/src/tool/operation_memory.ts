import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_memory.txt"
import { Instance } from "@/project/instance"
import { updateOperationMemory } from "@/ulm/operation-extras"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  action: Schema.Literals(["read", "append", "replace"]),
  note: Schema.optional(Schema.String),
  section: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  file: string
  updated: boolean
}

export const OperationMemoryTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_memory",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => updateOperationMemory(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: result.updated ? `Updated operation memory for ${result.operationID}` : `Read operation memory for ${result.operationID}`,
          output: result.updated
            ? [
                `operation_id: ${result.operationID}`,
                `memory: ${result.file}`,
                `updated: true`,
                "",
                "Memory updated. Full memory content is intentionally not echoed after writes to avoid resurfacing credential handles from older notes. Use action=read only when the full redacted memory is needed.",
              ].join("\n")
            : [`operation_id: ${result.operationID}`, `memory: ${result.file}`, `updated: false`, "", result.content].join("\n"),
          metadata: {
            operationID: result.operationID,
            file: result.file,
            updated: result.updated,
          },
        }
      }),
  }),
)
