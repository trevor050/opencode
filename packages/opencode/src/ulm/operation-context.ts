import fs from "fs/promises"
import path from "path"
import { operationPath, operationsRoot, slug } from "./artifact"
import type { OperationGoalRecord } from "./operation-goal"
import { effectiveULMContinuation, type ULMRuntimeConfig } from "./config"
import type { SessionID } from "@/session/schema"

export type ActiveOperationContext = {
  worktree: string
  operationID: string
  goal: OperationGoalRecord
}

export type OperationSessionBinding = {
  sessionID: SessionID
  operationID: string
  boundAt: string
  source?: string
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return undefined
  }
}

function parseTime(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

function sessionBindingsRoot(worktree: string) {
  return path.join(worktree, ".ulmcode", "session-bindings")
}

function safeSessionID(sessionID: SessionID) {
  return String(sessionID)
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function sessionBindingFile(worktree: string, sessionID: SessionID) {
  return path.join(sessionBindingsRoot(worktree), `${safeSessionID(sessionID) || "session"}.json`)
}

export async function bindOperationSession(
  worktree: string,
  input: { sessionID: SessionID; operationID: string; source?: string; now?: string },
): Promise<OperationSessionBinding> {
  const binding: OperationSessionBinding = {
    sessionID: input.sessionID,
    operationID: slug(input.operationID, "operation"),
    boundAt: input.now ?? new Date().toISOString(),
    source: input.source,
  }
  const file = sessionBindingFile(worktree, input.sessionID)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(binding, null, 2) + "\n")
  return binding
}

export async function operationForSession(worktree: string, sessionID: SessionID): Promise<ActiveOperationContext | undefined> {
  const binding = await readJson<OperationSessionBinding>(sessionBindingFile(worktree, sessionID))
  if (!binding?.operationID) return undefined
  const goal = await readJson<OperationGoalRecord>(
    path.join(operationPath(worktree, binding.operationID), "goals", "operation-goal.json"),
  )
  if (goal?.status !== "active") return undefined
  return { worktree, operationID: goal.operationID ?? binding.operationID, goal }
}

export async function activeOperationGoal(worktree: string): Promise<ActiveOperationContext | undefined> {
  const root = operationsRoot(worktree)
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return undefined
  }
  const goals = (
    await Promise.all(
      entries.map(async (entry) => ({
        operationID: entry,
        goal: await readJson<OperationGoalRecord>(path.join(root, entry, "goals", "operation-goal.json")),
      })),
    )
  )
    .filter((entry): entry is { operationID: string; goal: OperationGoalRecord } => entry.goal?.status === "active")
    .sort((a, b) => parseTime(b.goal.updatedAt ?? b.goal.createdAt) - parseTime(a.goal.updatedAt ?? a.goal.createdAt))
  const latest = goals[0]
  if (!latest) return undefined
  return { worktree, operationID: latest.goal.operationID ?? latest.operationID, goal: latest.goal }
}

export async function activeOperationForContext(ctx: {
  worktree: string
  directory: string
  sessionID?: SessionID
}): Promise<ActiveOperationContext | undefined> {
  // Chat/runtime context must be session-bound. Falling back to the newest
  // active operation in the worktree makes fresh chats inherit stale pentests.
  if (!ctx.sessionID) return undefined
  return (await operationForSession(ctx.worktree, ctx.sessionID)) ?? (await operationForSession(ctx.directory, ctx.sessionID))
}

export type OperationPlanExcerpt = {
  path?: string
  format?: "json" | "markdown"
  maxChars: number
  truncated: boolean
  chars: number
  content?: string
}

async function readPlanCandidate(file: string, format: OperationPlanExcerpt["format"], maxChars: number) {
  try {
    const raw = await fs.readFile(file, "utf8")
    const content = raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n[ULM operation plan truncated at ${maxChars} chars]` : raw
    return {
      path: file,
      format,
      maxChars,
      truncated: raw.length > maxChars,
      chars: raw.length,
      content,
    } satisfies OperationPlanExcerpt
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export async function readOperationPlanExcerpt(
  worktree: string,
  operationID: string,
  maxChars: number,
): Promise<OperationPlanExcerpt> {
  const root = operationPath(worktree, operationID)
  return (
    (await readPlanCandidate(path.join(root, "plans", "operation-plan.json"), "json", maxChars)) ??
    (await readPlanCandidate(path.join(root, "plans", "operation-plan.md"), "markdown", maxChars)) ??
    (await readPlanCandidate(path.join(root, "plans", "discovery-charter.json"), "json", maxChars)) ??
    (await readPlanCandidate(path.join(root, "plans", "discovery-charter.md"), "markdown", maxChars)) ?? {
      maxChars,
      truncated: false,
      chars: 0,
    }
  )
}

export function operationAllowsUnattendedFallback(goal: OperationGoalRecord | undefined, config: ULMRuntimeConfig = {}) {
  if (goal?.status !== "active") return false
  const continuation = effectiveULMContinuation(goal, config)
  return continuation.enabled && continuation.operatorFallbackEnabled
}
