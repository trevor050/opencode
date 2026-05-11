import { Effect, Schema } from "effect"
import fs from "fs/promises"
import path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_schedule.txt"
import { Instance } from "@/project/instance"
import { operationPath } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"

const ModelRoutes = Schema.Record(Schema.String, Schema.String)

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  template: Schema.optional(
    Schema.Literals([
      "single-url-web",
      "external-k12-district",
      "authenticated-webapp",
      "internal-network",
      "school-laptop-48h",
      "cloud-posture",
      "code-audit",
      "report-only",
      "benchmark-suite",
    ]),
  ),
  safetyMode: Schema.optional(Schema.Literals(["non_destructive", "interactive_destructive"])),
  trustLevel: Schema.optional(Schema.Literals(["guided", "moderate", "unattended", "lab_full"])),
  scanProfile: Schema.optional(Schema.Literals(["paranoid", "stealth", "balanced", "aggressive", "lab-insane"])),
  forceReschedule: Schema.optional(Schema.Boolean).annotate({
    description:
      "Intentionally rebuild an existing operation graph. Leave false during active runs; use operation_run, operation_resume, or operation_recover to continue.",
  }),
  includeSupervisor: Schema.optional(Schema.Boolean),
  maxConcurrentLanes: Schema.optional(Schema.Number),
  budgetUSD: Schema.optional(Schema.Number),
  modelRoutes: Schema.optional(ModelRoutes),
})

type Metadata = {
  operationID: string
  json: string
  markdown: string
  lanes: number
  archivedStaleLaneProofs: number
}

async function hasActiveExecution(worktree: string, operationID: string) {
  const root = operationPath(worktree, operationID)
  const runLog = path.join(root, "plans", "operation-run.jsonl")
  try {
    const content = await fs.readFile(runLog, "utf8")
    if (content.trim().length > 0) return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  try {
    const entries = await fs.readdir(path.join(root, "lane-complete"), { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name.endsWith(".json"))) return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }

  return false
}

export const OperationScheduleTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_schedule",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>) =>
      Effect.gen(function* () {
        if (params.forceReschedule && (yield* Effect.tryPromise(() => hasActiveExecution(Instance.worktree, params.operationID)).pipe(Effect.orDie))) {
          return yield* Effect.die(
            new Error(
              "forceReschedule cannot be used after operation execution has started; use operation_run, operation_resume, or operation_recover to continue.",
            ),
          )
        }
        const result = yield* Effect.tryPromise(() => writeOperationGraph(Instance.worktree, params)).pipe(Effect.orDie)
        return {
          title: `Scheduled ${result.lanes} operation lanes`,
          output: [
            `operation_id: ${result.operationID}`,
            `json: ${result.json}`,
            `markdown: ${result.markdown}`,
            `lanes: ${result.lanes}`,
            `archived_stale_lane_proofs: ${result.archivedStaleLaneProofs}`,
          ].join("\n"),
          metadata: result,
        }
      }),
  }),
)
