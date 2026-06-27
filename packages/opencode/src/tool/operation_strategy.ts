import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_strategy.txt"
import { InstanceRef } from "@/effect/instance-ref"
import { formatOperationStrategy, writeOperationStrategy } from "@/ulm/operation-strategy-prompt"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  horizonItems: Schema.optional(Schema.Number),
  operatorFocus: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  prompt: string
  items: number
}

export const OperationStrategyTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_strategy",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const instance = yield* InstanceRef
        if (!instance) return yield* Effect.die(new Error("InstanceRef not provided"))
        const result = yield* Effect.tryPromise(() => writeOperationStrategy(instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Operation strategy: ${result.memo.items.length} items`,
          output: formatOperationStrategy(result),
          metadata: {
            operationID: result.operationID,
            json: result.json,
            markdown: result.markdown,
            prompt: result.prompt,
            items: result.memo.items.length,
          },
        }
      }),
  }),
)
