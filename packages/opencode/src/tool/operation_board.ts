import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_board.txt"
import { InstanceRef } from "@/effect/instance-ref"
import { buildOperationBoard } from "@/ulm/operation-board"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
}

export const OperationBoardTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_board",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const instance = yield* InstanceRef
        if (!instance) return yield* Effect.die(new Error("InstanceRef not provided"))
        const result = yield* Effect.tryPromise(() => buildOperationBoard(instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Operation board: ${result.operationID}`,
          output: result.markdown,
          metadata: {
            operationID: result.operationID,
            json: result.json,
            markdown: result.markdownPath,
          },
        }
      }),
  }),
)
