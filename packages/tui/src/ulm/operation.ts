import { existsSync } from "fs"
import fs from "fs/promises"
import path from "path"

export type SessionID = string

export type ActiveOperationContext = {
  worktree: string
  operationID: string
  goal: {
    operationID?: string
    status?: string
    objective?: string
    updatedAt?: string
    createdAt?: string
  }
}

export type OperationSessionBinding = {
  sessionID: SessionID
  operationID: string
  boundAt: string
  source?: string
}

export type OperationPlanExcerpt = {
  path?: string
  format?: "json" | "markdown"
  maxChars: number
  truncated: boolean
  chars: number
  content?: string
}

export function slug(input: string, fallback: string) {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return value || fallback
}

export function operationsRoot(worktree: string) {
  const base = path.resolve(worktree)
  const root = path.parse(base).root
  if (base === root) return path.join(path.resolve(process.cwd()), ".ulmcode", "operations")
  let current = base
  while (true) {
    const candidate = path.join(current, ".ulmcode", "operations")
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return path.join(base, ".ulmcode", "operations")
    current = parent
  }
}

export function operationPath(worktree: string, operationID: string) {
  return path.join(operationsRoot(worktree), slug(operationID, "operation"))
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
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

export async function operationForSession(
  worktree: string,
  sessionID: SessionID,
): Promise<ActiveOperationContext | undefined> {
  const binding = await readJson<OperationSessionBinding>(sessionBindingFile(worktree, sessionID))
  if (!binding?.operationID) return undefined
  const goal = await readJson<ActiveOperationContext["goal"]>(
    path.join(operationPath(worktree, binding.operationID), "goals", "operation-goal.json"),
  )
  if (goal?.status !== "active") return undefined
  return { worktree, operationID: goal.operationID ?? binding.operationID, goal }
}

export async function listOperationSessionBindings(worktree: string): Promise<OperationSessionBinding[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(sessionBindingsRoot(worktree))
  } catch {
    return []
  }
  const bindings = (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJson<OperationSessionBinding>(path.join(sessionBindingsRoot(worktree), entry))),
    )
  )
    .filter((binding): binding is OperationSessionBinding => !!binding?.sessionID && !!binding.operationID)
    .sort((a, b) => parseTime(b.boundAt) - parseTime(a.boundAt))
  return bindings
}

async function readPlanCandidate(file: string, format: OperationPlanExcerpt["format"], maxChars: number) {
  try {
    const raw = await fs.readFile(file, "utf8")
    const content =
      raw.length > maxChars ? `${raw.slice(0, maxChars)}\n\n[ULM operation plan truncated at ${maxChars} chars]` : raw
    return {
      path: file,
      format,
      maxChars,
      truncated: raw.length > maxChars,
      chars: raw.length,
      content,
    } satisfies OperationPlanExcerpt
  } catch {
    return undefined
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
