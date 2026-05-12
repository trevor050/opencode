import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_gap_audit.txt"
import { Instance } from "@/project/instance"
import { auditOperationGaps, formatOperationGapAudit } from "@/ulm/operation-gap-audit"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  runtimeRemainingSeconds: Schema.optional(Schema.Number),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  gaps: number
  queueDepth: number
  releaseReady: boolean
}

export const OperationGapAuditTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_gap_audit",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise(() => auditOperationGaps(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Gap audit: ${result.gaps.length} gaps, queue depth ${result.progress.queueDepth}`,
          output: formatOperationGapAudit(result),
          metadata: {
            operationID: result.operationID,
            json: result.files.json,
            markdown: result.files.markdown,
            gaps: result.gaps.length,
            queueDepth: result.progress.queueDepth,
            releaseReady: result.releaseReady,
          },
        }
      }),
  }),
)
