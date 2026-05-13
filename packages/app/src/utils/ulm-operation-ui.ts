import type { UlmFinalArtifact, UlmOperationStatusSummary } from "@opencode-ai/sdk/v2"
import { isUlmOperationsDirectory } from "./ulm-workspace"

export type ReportPackageState = "ready" | "partial" | "missing"
type OperationSessionBinding = {
  sessionID: string
  operationID: string
  boundAt: string
  source?: string
}
export type SessionBoundOperation = UlmOperationStatusSummary & { sessions?: OperationSessionBinding[] }

export function operationTitle(item: UlmOperationStatusSummary) {
  return item.operation?.objective || item.goal?.objective || item.operationID
}

export function operationRootPath(item: UlmOperationStatusSummary) {
  return item.root || undefined
}

export function finalPackagePath(item: UlmOperationStatusSummary) {
  return item.root ? `${item.root}/deliverables/final` : undefined
}

export function currentOperationFilesPath(item: UlmOperationStatusSummary | undefined) {
  return item ? operationRootPath(item) : undefined
}

export function operationForSession(operations: SessionBoundOperation[], sessionID: string | undefined) {
  if (!sessionID) return undefined
  return operations.find((item) => item.sessions?.some((binding) => binding.sessionID === sessionID))
}

export function operationFilesPathForSession(
  operations: SessionBoundOperation[],
  sessionID: string | undefined,
  allOperationsPath: string | undefined,
) {
  return currentOperationFilesPath(operationForSession(operations, sessionID)) ?? allOperationsPath
}

export function operationFilesRootForDirectory(directory: string | undefined) {
  if (!directory) return undefined
  if (directory.endsWith("/packages/opencode")) return `${directory.slice(0, -"/packages/opencode".length)}/.ulmcode/operations`
  if (directory.endsWith("/opencode")) return `${directory}/.ulmcode/operations`
  if (isUlmOperationsDirectory(directory)) return `${directory}/.ulmcode/operations`
  return directory
}

export function operationFilesOpenPathForSession(
  operations: SessionBoundOperation[],
  sessionID: string | undefined,
  directory: string | undefined,
) {
  return operationFilesPathForSession(operations, sessionID, operationFilesRootForDirectory(directory))
}

export function operationChatSessionID(item: SessionBoundOperation) {
  return item.sessions?.slice().sort((a, b) => Date.parse(b.boundAt) - Date.parse(a.boundAt))[0]?.sessionID
}

export function operationChatPath(base: string, item: SessionBoundOperation) {
  const sessionID = operationChatSessionID(item)
  return sessionID ? `${base}/session/${sessionID}` : `${base}/session`
}

export function reportPackageState(item: UlmOperationStatusSummary): ReportPackageState {
  if (item.reports.html && item.reports.pdf && item.reports.manifest) return "ready"
  if (
    item.reports.outline ||
    item.reports.markdown ||
    item.reports.html ||
    item.reports.pdf ||
    item.reports.readme ||
    item.reports.manifest ||
    item.runtimeSummary
  )
    return "partial"
  return "missing"
}

export function operationCounts(operations: UlmOperationStatusSummary[]) {
  return {
    running: operations.filter((item) => item.operation?.status === "running").length,
    open: operations.filter((item) => item.operation?.status !== "complete" && item.operation?.status !== "paused").length,
    total: operations.length,
  }
}

export function operationStatusGroups(operations: UlmOperationStatusSummary[]) {
  return {
    active: operations.filter((item) => item.operation?.status !== "complete" && item.operation?.status !== "paused"),
    paused: operations.filter((item) => item.operation?.status === "paused"),
    completed: operations.filter((item) => item.operation?.status === "complete"),
  }
}

function artifactGroup(file: string) {
  if (file === "status.md" || file === "operation.json" || file === "memory.md") return "Overview"
  if (file.startsWith("plans/")) return "Plans"
  if (file.startsWith("evidence/") || file === "evidence.jsonl" || file.startsWith("findings/")) return "Evidence"
  if (file.startsWith("deliverables/") || file.startsWith("reports/")) return "Reports"
  if (file.startsWith("profiles/") || file.startsWith("graph/") || file.startsWith("chains/")) return "Context"
  return "Other"
}

const groupOrder = ["Overview", "Plans", "Evidence", "Reports", "Context", "Other"]

export function artifactGroups(artifacts: Array<Pick<UlmFinalArtifact, "exists" | "file">>) {
  return groupOrder
    .map((label) => ({
      label,
      items: artifacts.filter((artifact) => artifact.exists && artifactGroup(artifact.file) === label),
    }))
    .filter((group) => group.items.length > 0)
}
