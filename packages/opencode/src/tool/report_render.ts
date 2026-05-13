import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./report_render.txt"
import { Instance } from "@/project/instance"
import { renderReport } from "@/ulm/artifact"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  title: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  html: string
  pdf: string
  readme: string
  manifest: string
  internalReviewMarkdown: string
  internalReviewJson: string
  findings: number
  nextTools: string[]
}

export const ReportRenderTool = Tool.define<typeof Parameters, Metadata, never>(
  "report_render",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => renderReport(Instance.worktree, params),
          catch: (error) => new Error(error instanceof Error ? error.message : String(error)),
        }).pipe(Effect.orDie)
        return {
          title: "Rendered ULMCode report",
          output: [
            `operation_id: ${result.operationID}`,
            `html: ${result.html}`,
            `pdf: ${result.pdf}`,
            `readme: ${result.readme}`,
            `manifest: ${result.manifest}`,
            `internal_review_markdown: ${result.internalReviewMarkdown}`,
            `internal_review_json: ${result.internalReviewJson}`,
            `findings: ${result.findings}`,
            "next_tools: runtime_summary, operation_audit",
            "next_step: Call runtime_summary immediately, then call operation_audit with finalHandoff=true before any optional lane cleanup or handoff claim.",
          ].join("\n"),
          metadata: {
            operationID: result.operationID,
            html: result.html,
            pdf: result.pdf,
            readme: result.readme,
            manifest: result.manifest,
            internalReviewMarkdown: result.internalReviewMarkdown,
            internalReviewJson: result.internalReviewJson,
            findings: result.findings,
            nextTools: ["runtime_summary", "operation_audit"],
          },
        }
      }),
  }),
)
