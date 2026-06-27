import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"

export type OperationStrategyItem = {
  title: string
  why?: string
  suggestedLane?: string
  usefulTools?: string[]
  expectedProof?: string[]
  estimatedMinutes?: number
}

export type OperationStrategyMemo = {
  operationID: string
  generatedAt?: string
  horizon?: string
  items: OperationStrategyItem[]
  gaps: string[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const items = value.map(stringValue).filter((item): item is string => Boolean(item))
  return items.length ? items : undefined
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

export function normalizeStrategyMemo(input: unknown): OperationStrategyMemo {
  const record = asRecord(input)
  const operationID = slug(stringValue(record.operationID) ?? "operation", "operation")
  const gaps: string[] = []
  if (!stringValue(record.operationID)) gaps.push("operationID missing")

  const rawItems = Array.isArray(record.items) ? record.items : []
  if (!Array.isArray(record.items)) gaps.push("items missing")

  const items = rawItems
    .map((raw, index): OperationStrategyItem | undefined => {
      const item = asRecord(raw)
      const title = stringValue(item.title)
      if (!title) {
        gaps.push(`item ${index} missing title`)
        return undefined
      }
      const normalized: OperationStrategyItem = { title }
      const why = stringValue(item.why)
      const suggestedLane = stringValue(item.suggestedLane)
      const usefulTools = stringList(item.usefulTools)
      const expectedProof = stringList(item.expectedProof)
      const estimatedMinutes = positiveNumber(item.estimatedMinutes)
      if (why) normalized.why = why
      if (suggestedLane) normalized.suggestedLane = slug(suggestedLane, "lane")
      if (usefulTools) normalized.usefulTools = usefulTools
      if (expectedProof) normalized.expectedProof = expectedProof
      if (estimatedMinutes) normalized.estimatedMinutes = estimatedMinutes
      return normalized
    })
    .filter((item): item is OperationStrategyItem => Boolean(item))

  return {
    operationID,
    generatedAt: stringValue(record.generatedAt),
    horizon: stringValue(record.horizon),
    items,
    gaps,
  }
}

export async function readOperationStrategyMemo(worktree: string, operationID: string) {
  const root = operationPath(worktree, operationID)
  const file = path.join(root, "strategy", "next-actions.json")
  try {
    return normalizeStrategyMemo(JSON.parse(await fs.readFile(file, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    return normalizeStrategyMemo({
      operationID,
      items: [],
      gaps: [`failed to read strategy memo: ${(error as Error).message}`],
    })
  }
}

export async function writeStrategyHintGaps(worktree: string, operationID: string, gaps: string[]) {
  if (!gaps.length) return undefined
  const file = path.join(operationPath(worktree, operationID), "strategy", "hint-gaps.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        operationID: slug(operationID, "operation"),
        generatedAt: new Date().toISOString(),
        gaps,
      },
      null,
      2,
    ) + "\n",
  )
  return file
}
