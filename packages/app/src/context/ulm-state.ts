import type {
  Event,
  PermissionRequest,
  QuestionRequest,
  Session,
  UlmOperationStatusSummary,
} from "@opencode-ai/sdk/v2"

type OperationUpdatedEvent = Extract<Event, { type: "operation.updated" }>
type ApprovalCounts = { questions: number; permissions: number }
type ConfidenceLevel = "ready" | "attention" | "blocked"
type OperationTagged<T> = T & { metadata?: Record<string, unknown> }

export type UlmApprovalSource = {
  sessions: Pick<Session, "id" | "title" | "parentID">[]
  questions: Record<string, OperationTagged<QuestionRequest>[] | undefined>
  permissions: Record<string, OperationTagged<PermissionRequest>[] | undefined>
}

const emptyCounts = {
  findings: {
    total: 0,
    byState: { candidate: 0, needs_validation: 0, validated: 0, report_ready: 0, rejected: 0 },
    bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 },
  },
  evidence: {
    total: 0,
    byKind: { command_output: 0, http_response: 0, screenshot: 0, file: 0, note: 0, log: 0 },
  },
  reports: { outline: false, markdown: false, html: false, pdf: false, readme: false, manifest: false },
}

function operationTime(item: UlmOperationStatusSummary) {
  return item.operation?.time.updated ?? item.goal?.updatedAt ?? item.operation?.time.created ?? ""
}

function statusPriority(item: UlmOperationStatusSummary) {
  const status = item.operation?.status
  if (status === "blocked") return 0
  if (status === "running") return 1
  if (status === "planned") return 2
  if (status === "paused") return 3
  if (status === "complete") return 4
  return 5
}

function operationIDFromMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  const metadata = value as Record<string, unknown>
  return typeof metadata.operationID === "string" ? metadata.operationID : undefined
}

function requestOperationID(value: OperationTagged<QuestionRequest | PermissionRequest>) {
  if (!("metadata" in value)) return
  return operationIDFromMetadata(value.metadata)
}

export function sortOperations(operations: UlmOperationStatusSummary[]) {
  return operations.slice().sort((a, b) => {
    const status = statusPriority(a) - statusPriority(b)
    if (status !== 0) return status
    const updated = operationTime(b).localeCompare(operationTime(a))
    if (updated !== 0) return updated
    return a.operationID.localeCompare(b.operationID)
  })
}

export function operationListFromResponse(value: unknown): UlmOperationStatusSummary[] {
  if (Array.isArray(value)) return value as UlmOperationStatusSummary[]
  if (typeof value === "string") throw new Error(value.slice(0, 160))
  throw new Error("Unexpected ULM operation list response")
}

export function applyOperationUpdated(
  operations: UlmOperationStatusSummary[],
  event: OperationUpdatedEvent,
): UlmOperationStatusSummary[] {
  const patch = event.properties
  const index = operations.findIndex((item) => item.operationID === patch.operationID)
  const current =
    index === -1
      ? ({
          operationID: patch.operationID,
          root: "",
          policies: { foregroundCommand: "" },
          plans: { operation: false },
          findings: emptyCounts.findings,
          evidence: emptyCounts.evidence,
          reports: emptyCounts.reports,
          runtimeSummary: false,
          lastEvents: [],
        } satisfies UlmOperationStatusSummary)
      : operations[index]

  const next: UlmOperationStatusSummary = {
    ...current,
    operation: patch.operation
      ? ({
          ...(current.operation ?? {
            operationID: patch.operationID,
            objective: patch.operation.objective ?? "",
            stage: "intake",
            status: "planned",
            summary: "",
            nextActions: [],
            blockers: [],
            riskLevel: "low",
            activeTasks: [],
            evidence: [],
            time: { created: "", updated: "" },
          }),
          ...patch.operation,
        } as UlmOperationStatusSummary["operation"])
      : current.operation,
    findings: patch.findings ? { ...current.findings, total: patch.findings.total } : current.findings,
    evidence: patch.evidence ? { ...current.evidence, total: patch.evidence.total } : current.evidence,
    reports: patch.reports ? { ...current.reports, ...patch.reports } : current.reports,
    runtimeSummary: patch.runtimeSummary ?? current.runtimeSummary,
  }

  if (index === -1) return sortOperations([next, ...operations])
  const list = operations.slice()
  list[index] = next
  return sortOperations(list)
}

export function pendingApprovalCounts(source: UlmApprovalSource, operationID: string): ApprovalCounts {
  const sessionIDs = new Set(source.sessions.map((session) => session.id))
  const count = <T extends QuestionRequest | PermissionRequest>(items: Record<string, OperationTagged<T>[] | undefined>) =>
    Object.entries(items).reduce((total, [sessionID, requests]) => {
      if (!sessionIDs.has(sessionID)) return total
      return total + (requests ?? []).filter((request) => requestOperationID(request) === operationID).length
    }, 0)

  return {
    questions: count(source.questions),
    permissions: count(source.permissions),
  }
}

export function confidenceForOperation(summary: UlmOperationStatusSummary, approvals: ApprovalCounts) {
  const reasons: string[] = []

  if ((summary.operation?.blockers.length ?? 0) > 0) reasons.push(...(summary.operation?.blockers ?? []))
  if (approvals.questions > 0) reasons.push(`${approvals.questions} pending question${approvals.questions === 1 ? "" : "s"}`)
  if (approvals.permissions > 0)
    reasons.push(`${approvals.permissions} pending permission${approvals.permissions === 1 ? "" : "s"}`)

  if (reasons.length > 0 || summary.operation?.status === "blocked") {
    return { level: "blocked" as ConfidenceLevel, label: "Do not walk away", reasons }
  }

  if (!summary.plans.operation) reasons.push("Operation plan is missing")
  if (!summary.runtimeSummary) reasons.push("Runtime summary is missing")
  if (summary.supervisor?.blockers.length) reasons.push(...summary.supervisor.blockers)

  if (reasons.length > 0) return { level: "attention" as ConfidenceLevel, label: "Needs attention", reasons }
  return { level: "ready" as ConfidenceLevel, label: "Safe to leave running", reasons: ["No blocking gaps detected"] }
}
