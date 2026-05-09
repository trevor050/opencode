import type { UlmFinalArtifact, UlmOperationStatusSummary } from "@opencode-ai/sdk/v2"

export type ReportPackageState = "ready" | "partial" | "missing"

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
    open: operations.filter((item) => item.operation?.status !== "complete").length,
    total: operations.length,
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
