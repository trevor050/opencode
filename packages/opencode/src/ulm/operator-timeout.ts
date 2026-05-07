import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"
import { superviseOperation } from "./operation-supervisor"
import type { OperationGoalRecord } from "./operation-goal"
import { effectiveULMContinuation, type ULMRuntimeConfig } from "./config"

export type OperatorTimeoutKind = "permission" | "question"

export type OperatorTimeoutRecord = {
  operationID: string
  kind: OperatorTimeoutKind
  requestID: string
  sessionID: string
  timedOutAt: string
  fallback: string
  prompt?: string
  sensitive: boolean
}

const sensitivePatterns = [
  "authorization",
  "authorize",
  "credential",
  "password",
  "scope",
  "expand",
  "destructive",
  "privacy",
  "private",
  "install",
  "download",
  "secret",
  "token",
]

export function operatorFallbackTimeoutMillis(goal: OperationGoalRecord, config: ULMRuntimeConfig = {}) {
  if (config.operator_timeout_seconds === 0) return undefined
  return Math.max(1, Math.round((config.operator_timeout_seconds ?? goal.continuation?.operatorFallbackTimeoutSeconds ?? 180) * 1000))
}

async function readOperatorTimeouts(worktree: string, operationID: string) {
  const dir = path.join(operationPath(worktree, operationID), "operator-timeouts")
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  return (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          try {
            return JSON.parse(await fs.readFile(path.join(dir, entry), "utf8")) as OperatorTimeoutRecord
          } catch {
            return undefined
          }
        }),
    )
  ).filter((record): record is OperatorTimeoutRecord => record !== undefined)
}

export async function operatorTimeoutCount(
  worktree: string,
  input: { operationID: string; kind: OperatorTimeoutKind },
) {
  return (await readOperatorTimeouts(worktree, slug(input.operationID, "operation"))).filter(
    (record) => record.kind === input.kind,
  ).length
}

async function operatorRecentTimeoutCount(
  worktree: string,
  input: { operationID: string; kind: OperatorTimeoutKind; since: Date },
) {
  return (await readOperatorTimeouts(worktree, slug(input.operationID, "operation"))).filter((record) => {
    if (record.kind !== input.kind) return false
    const timestamp = Date.parse(record.timedOutAt)
    return Number.isFinite(timestamp) && timestamp >= input.since.getTime()
  }).length
}

export async function operatorFallbackWaitMillis(
  worktree: string,
  input: {
    operationID: string
    kind: OperatorTimeoutKind
    goal: OperationGoalRecord
    config?: ULMRuntimeConfig
    now?: Date
  },
) {
  const continuation = effectiveULMContinuation(input.goal, input.config)
  if (!continuation.enabled || !continuation.operatorFallbackEnabled) return undefined
  const timeoutMillis = operatorFallbackTimeoutMillis(input.goal, input.config)
  if (timeoutMillis === undefined) return undefined
  if (continuation.maxRepeatedOperatorTimeoutsPerKind <= 0) return timeoutMillis
  const now = input.now ?? new Date()
  const count = await operatorRecentTimeoutCount(worktree, {
    operationID: input.operationID,
    kind: input.kind,
    since: new Date(now.getTime() - continuation.operatorFallbackSuppressionWindowSeconds * 1000),
  })
  if (count >= continuation.maxRepeatedOperatorTimeoutsPerKind) return 0
  return timeoutMillis
}

export function isSensitiveOperatorPrompt(text: string) {
  const lower = text.toLowerCase()
  return sensitivePatterns.some((pattern) => lower.includes(pattern))
}

export async function recordOperatorTimeout(
  worktree: string,
  input: Omit<OperatorTimeoutRecord, "timedOutAt"> & { timedOutAt?: string },
) {
  const record: OperatorTimeoutRecord = {
    ...input,
    operationID: slug(input.operationID, "operation"),
    timedOutAt: input.timedOutAt ?? new Date().toISOString(),
  }
  const dir = path.join(operationPath(worktree, record.operationID), "operator-timeouts")
  const file = path.join(
    dir,
    `${record.timedOutAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "")}-${record.kind}-${record.requestID}.json`,
  )
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, JSON.stringify({ ...record, file }, null, 2) + "\n")
  await superviseOperation(worktree, {
    operationID: record.operationID,
    reviewKind: "operator_timeout",
    maxActions: 1,
    latestAssistantMessage: `${record.kind} timeout fallback: ${record.fallback}`,
  })
  return { ...record, file }
}
