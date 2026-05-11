import path from "path"
import type { BackgroundJob } from "@/background/job"

export function backgroundJobOperationID(job: BackgroundJob.Info) {
  const value = job.metadata?.operationID
  return typeof value === "string" && value ? value : undefined
}

export function backgroundJobWorktree(job: BackgroundJob.Info) {
  const value = job.metadata?.worktree
  return typeof value === "string" && value ? value : undefined
}

function sameWorktree(left: string | undefined, right: string | undefined) {
  if (!left || !right) return true
  return path.resolve(left) === path.resolve(right)
}

export function backgroundJobInScope(input: {
  job: BackgroundJob.Info
  operationID?: string
  worktree?: string
}) {
  const jobOperationID = backgroundJobOperationID(input.job)
  if (input.operationID && jobOperationID !== input.operationID) return false
  return sameWorktree(backgroundJobWorktree(input.job), input.worktree)
}

export function relevantBackgroundJobs(input: {
  operationID: string
  jobs: BackgroundJob.Info[]
  worktree?: string
}) {
  const worktreeJobs = input.jobs.filter((job) => sameWorktree(backgroundJobWorktree(job), input.worktree))
  const operationJobs = worktreeJobs.filter((job) => backgroundJobOperationID(job) === input.operationID)
  if (operationJobs.length) return operationJobs
  return worktreeJobs.filter((job) => backgroundJobOperationID(job) === undefined)
}
