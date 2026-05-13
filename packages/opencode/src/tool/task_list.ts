import * as Tool from "./tool"
import DESCRIPTION from "./task_list.txt"
import { BackgroundJob } from "@/background/job"
import { Instance } from "@/project/instance"
import { backgroundJobInScope } from "./background_job_scope"
import { taskRestartArgs } from "./task_restart_args"
import { Effect, Schema } from "effect"

export const Parameters = Schema.Struct({
  status: Schema.optional(Schema.Literals(["running", "completed", "error", "cancelled", "stale"])),
  operationID: Schema.optional(Schema.String),
})

type Metadata = {
  count: number
}

function currentWorktree() {
  try {
    return Instance.worktree
  } catch {
    return undefined
  }
}

export const TaskListTool = Tool.define<typeof Parameters, Metadata, BackgroundJob.Service>(
  "task_list",
  Effect.gen(function* () {
    const jobs = yield* BackgroundJob.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const worktree = currentWorktree()
          const items = (yield* jobs.list()).filter((job) => {
            if (params.status && job.status !== params.status) return false
            if (params.operationID && !backgroundJobInScope({ job, operationID: params.operationID, worktree })) return false
            return true
          })
          return {
            title: `${items.length} background task${items.length === 1 ? "" : "s"}`,
            output: items.length
              ? items
                  .map((job) => {
                    const restartArgs = taskRestartArgs(job)
                    return [
                      `task_id: ${job.id}`,
                      `type: ${job.type}`,
                      `status: ${job.status}`,
                      ...(typeof job.metadata?.operationID === "string" ? [`operation_id: ${job.metadata.operationID}`] : []),
                      ...(restartArgs
                        ? [
                            "restartable: true",
                            "restart_args: available via task_status or task_restart; omitted from task_list to keep operation resumes compact and avoid re-echoing old task prompts",
                          ]
                        : []),
                      ...(job.title ? [`title: ${job.title}`] : []),
                      ...(job.completedAt ? [`completed_at: ${new Date(job.completedAt).toISOString()}`] : []),
                    ].join("\n")
                  })
                  .join("\n\n")
              : "No background tasks found.",
            metadata: {
              count: items.length,
            },
          }
        }),
    }
  }),
)
