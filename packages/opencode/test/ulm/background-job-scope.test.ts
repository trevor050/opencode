import { describe, expect, test } from "bun:test"
import { backgroundJobInScope, relevantBackgroundJobs } from "@/tool/background_job_scope"
import type { BackgroundJob } from "@/background/job"

function job(input: {
  id: string
  operationID?: string
  worktree?: string
  status?: BackgroundJob.Status
}): BackgroundJob.Info {
  return {
    id: input.id,
    type: "task",
    status: input.status ?? "stale",
    startedAt: 1,
    metadata: {
      ...(input.operationID ? { operationID: input.operationID } : {}),
      ...(input.worktree ? { worktree: input.worktree } : {}),
    },
  }
}

describe("ULM background job scoping", () => {
  test("keeps same operation ids isolated by worktree", () => {
    const current = "/tmp/ulm-run-current"
    const stalePriorRun = job({
      id: "prior",
      operationID: "synthetic-surface-48h-rehearsal",
      worktree: "/tmp/ulm-run-prior",
    })
    const currentRun = job({
      id: "current",
      operationID: "synthetic-surface-48h-rehearsal",
      worktree: current,
    })
    const noWorktreeLegacy = job({
      id: "legacy",
      operationID: "synthetic-surface-48h-rehearsal",
    })

    expect(backgroundJobInScope({ job: stalePriorRun, operationID: "synthetic-surface-48h-rehearsal", worktree: current })).toBe(false)
    expect(backgroundJobInScope({ job: currentRun, operationID: "synthetic-surface-48h-rehearsal", worktree: current })).toBe(true)
    expect(backgroundJobInScope({ job: noWorktreeLegacy, operationID: "synthetic-surface-48h-rehearsal", worktree: current })).toBe(true)
    expect(relevantBackgroundJobs({
      operationID: "synthetic-surface-48h-rehearsal",
      jobs: [stalePriorRun, currentRun, noWorktreeLegacy],
      worktree: current,
    }).map((item) => item.id)).toEqual(["current", "legacy"])
  })
})
