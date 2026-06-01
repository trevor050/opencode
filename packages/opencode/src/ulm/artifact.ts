import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Bus } from "@/bus"
import { OperationEvent } from "./event"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Schema } from "effect"
import { containsRawCredentialSecret, credentialIndexGaps, expectedCredentialServices, missingCredentialServices } from "./credential-safety"
import { assertOperationArtifactSafe, scanOperationArtifacts } from "./operation-artifact-safety"

export const STAGES = ["intake", "recon", "mapping", "validation", "reporting", "handoff"] as const
export const OPERATION_STATUSES = ["planned", "running", "blocked", "paused", "complete"] as const
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const
export const FINDING_STATES = ["candidate", "needs_validation", "validated", "report_ready", "rejected"] as const
export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const
export const EVIDENCE_KINDS = ["command_output", "http_response", "screenshot", "file", "note", "log"] as const
export const FINAL_PACKAGE_FILES = [
  "report.pdf",
  "report.html",
  "findings.json",
  "evidence-index.json",
  "people-profiles.md",
  "identity-graph.json",
  "operator-review.md",
  "executive-summary.md",
  "technical-appendix.md",
  "board-report.md",
  "board-report.pdf",
  "ceh-technical-report.md",
  "ceh-technical-report.pdf",
  "ulm-team-report.md",
  "ulm-team-report.pdf",
  "runtime-summary.md",
  "README.md",
  "manifest.json",
] as const

export type Stage = (typeof STAGES)[number]
export type OperationStatus = (typeof OPERATION_STATUSES)[number]
export type RiskLevel = (typeof RISK_LEVELS)[number]
export type FindingState = (typeof FINDING_STATES)[number]
export type Severity = (typeof SEVERITIES)[number]
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
type OperationUpdatedArtifact = Schema.Schema.Type<typeof OperationEvent.Updated.properties>["artifact"]

export type EvidenceRef = {
  id: string
  path?: string
  summary?: string
  command?: string
  createdAt?: string
}

async function publishOperationUpdated(
  worktree: string,
  input: { operationID: string; artifact: OperationUpdatedArtifact; path?: string },
) {
  try {
    const status = await readOperationStatus(worktree, input.operationID, { eventLimit: 0 }).catch(() => undefined)
    await Bus.publish(
      {
        directory: worktree,
        worktree,
        project: {
          id: ProjectV2.ID.global,
          worktree,
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: [],
        },
      },
      OperationEvent.Updated,
      {
        ...input,
        operation: status?.operation
          ? {
              objective: status.operation.objective,
              stage: status.operation.stage,
              status: status.operation.status,
              summary: status.operation.summary,
              riskLevel: status.operation.riskLevel,
              nextActions: status.operation.nextActions,
              blockers: status.operation.blockers,
            }
          : undefined,
        findings: status?.findings ? { total: status.findings.total } : undefined,
        evidence: status?.evidence ? { total: status.evidence.total } : undefined,
        reports: status?.reports,
        runtimeSummary: status?.runtimeSummary,
      },
    )
  } catch {}
}

export type OperationCheckpointInput = {
  operationID?: string
  objective?: string
  stage: Stage
  status: OperationStatus
  summary: string
  nextActions?: string[]
  blockers?: string[]
  riskLevel?: RiskLevel
  activeTasks?: string[]
  evidence?: EvidenceRef[]
  notes?: string
}

export type OperationRecord = {
  operationID: string
  objective: string
  stage: Stage
  status: OperationStatus
  summary: string
  nextActions: string[]
  blockers: string[]
  riskLevel: RiskLevel
  activeTasks: string[]
  evidence: EvidenceRef[]
  notes?: string
  time: {
    created: string
    updated: string
  }
}

export type FindingInput = {
  operationID: string
  findingID?: string
  title: string
  state: FindingState
  severity: Severity
  confidence: number
  affectedAssets: string[]
  evidence: EvidenceRef[]
  description: string
  impact?: string
  remediation?: string
  sourceTasks?: string[]
}

export type EvidenceInput = {
  operationID: string
  evidenceID?: string
  title: string
  kind: EvidenceKind
  summary: string
  source?: string
  command?: string
  path?: string
  content?: string
}

export type EvidenceRecord = Omit<EvidenceInput, "content"> & {
  evidenceID: string
  path?: string
  time: {
    created: string
    updated: string
  }
}

export type DistrictProfileInput = {
  operationID: string
  name: string
  domains?: string[]
  systems?: Array<{ name: string; category: string; source: string; notes?: string }>
  departments?: Array<{ name: string; source: string; notes?: string }>
  notes?: string[]
}

export type PersonProfileInput = {
  operationID: string
  name: string
  role: string
  organization?: string
  roleCategory:
    | "district_leadership"
    | "school_leadership"
    | "technology"
    | "student_services"
    | "finance_hr"
    | "teacher_staff"
    | "vendor_partner"
    | "other"
  whyTheyMatter: string
  likelyAccess: string[]
  publicContacts?: Array<{ type: "email" | "phone" | "office" | "other"; value: string; source: string }>
  sources: Array<{ title: string; url?: string; path?: string; summary: string }>
  validationIdeas?: string[]
  excludedPrivateInfo?: string[]
}

export type IdentityGraphInput = {
  operationID: string
  nodes: Array<{
    id: string
    kind: "person" | "account" | "group" | "role" | "application" | "data" | "vendor" | "device"
    label: string
    source?: string
  }>
  edges: Array<{
    from: string
    to: string
    relationship: string
    evidence?: string[]
    confidence?: "low" | "medium" | "high"
  }>
  notes?: string[]
}

export type ProfileWriteResult = {
  operationID: string
  json: string
  markdown: string
}

export type EvidenceWriteResult = {
  operationID: string
  evidenceID: string
  json: string
  rawPath?: string
  record: EvidenceRecord
}

export type FindingRecord = FindingInput & {
  findingID: string
  time: {
    created: string
    updated: string
  }
}

export type ReportLintResult = {
  operationID: string
  ok: boolean
  checkedAt: string
  gaps: string[]
  repairHints: string[]
  counts: {
    findings: number
    reportReady: number
    validated: number
    candidates: number
    rejected: number
  }
}

export type ReportOutlineInput = {
  operationID: string
  audience?: "technical" | "executive" | "board" | "mixed"
  targetPages?: number
  includeAppendix?: boolean
  designProfile?: "standard" | "premium" | "board-ready"
  includeCoverageSection?: boolean
  includeHandoffChecklist?: boolean
}

export type ReportLintOptions = {
  requireReport?: boolean
  minWords?: number
  requireOutlineBudget?: boolean
  minOutlineTargetPages?: number
  minOutlineWordsPerPage?: number
  requireOutlineSections?: boolean
  minOutlineSectionWords?: number
  minOutlineSectionWordsPerPage?: number
  requireFindingSections?: boolean
  minFindingWords?: number
  minPdfPages?: number
  finalHandoff?: boolean
  requireOperationPlan?: boolean
  requireRenderedDeliverables?: boolean
  requireRuntimeSummary?: boolean
}

export type OperationStatusSummary = {
  operationID: string
  root: string
  sessions?: {
    sessionID: string
    operationID: string
    boundAt: string
    source?: string
  }[]
  operation?: OperationRecord
  goal?: {
    status: string
    objective: string
    targetDurationHours?: number
    updatedAt?: string
    completedAt?: string
  }
  supervisor?: {
    generatedAt?: string
    action?: string
    reason?: string
    requiredNextTool?: string
    blockers: string[]
    nextTools: string[]
  }
  toolInventory?: {
    generatedAt?: string
    total: number
    installed: number
    missing: number
    highValueMissing: number
    installedHighValue: string[]
    missingHighValue: string[]
  }
  policies: {
    foregroundCommand: string
  }
  plans: {
    operation: boolean
    discoveryCharter: boolean
    discoveryCharterApproval?: PlanningApproval["status"]
  }
  findings: {
    total: number
    byState: Record<FindingState, number>
    bySeverity: Record<Severity, number>
  }
  evidence: {
    total: number
    byKind: Record<EvidenceKind, number>
  }
  reports: {
    outline: boolean
    markdown: boolean
    html: boolean
    pdf: boolean
    readme: boolean
    manifest: boolean
  }
  runtimeSummary: boolean
  evalScorecard: boolean
  graph?: {
    exists: boolean
    lanes: {
      total: number
      byStatus: Record<string, number>
      failed: string[]
      running: string[]
      incomplete: string[]
      missingProofs: string[]
      invalidProofs: string[]
      invalidProofReasons: Record<string, string[]>
    }
  }
  runtime?: {
    generatedAt: string
    modelCalls?: RuntimeSummaryRecord["modelCalls"]
    usage?: RuntimeSummaryRecord["usage"]
    compaction?: RuntimeSummaryRecord["compaction"]
    fetches?: RuntimeSummaryRecord["fetches"]
    backgroundTasks?: RuntimeSummaryRecord["backgroundTasks"]
    notes?: RuntimeSummaryRecord["notes"]
  }
  lastEvents: unknown[]
}

type OperationGraphStatusRecord = {
  lanes?: Array<{
    id?: string
    status?: string
    expectedArtifacts?: string[]
    terminalState?: string
    skipReason?: string
    coverageImpact?: string
    releaseRequired?: boolean
  }>
}

type LaneProofRecord = {
  operationID?: string
  laneID?: string
  status?: string
  summary?: string
  artifacts?: string[]
  evidenceRefs?: string[]
  coverageImpact?: string
  releaseRequired?: boolean
}

type OperationGoalStatusRecord = {
  status?: string
  objective?: string
  targetDurationHours?: number
  updatedAt?: string
  completedAt?: string
}

type SupervisorReviewStatusRecord = {
  generatedAt?: string
  decisions?: Array<{
    action?: string
    reason?: string
    requiredNextTool?: string
  }>
}

type ToolInventoryStatusRecord = {
  generatedAt?: string
  counts?: {
    total?: number
    installed?: number
    missing?: number
    highValueMissing?: number
  }
  tools?: Array<{
    id?: string
    installed?: boolean
    highValue?: boolean
  }>
}

type OperationPlanStatusRecord = {
  planningApproval?: PlanningApproval
}

export type OperationResumeBrief = {
  operationID: string
  root: string
  generatedAt: string
  checkpoint?: Pick<
    OperationRecord,
    "objective" | "stage" | "status" | "summary" | "riskLevel" | "nextActions" | "blockers" | "activeTasks" | "time"
  >
  health: {
    ready: boolean
    status: "ready" | "attention_required"
    gaps: string[]
  }
  artifacts: OperationStatusSummary["plans"] & {
    reports: OperationStatusSummary["reports"]
    runtimeSummary: boolean
    findings: OperationStatusSummary["findings"]["total"]
    evidence: OperationStatusSummary["evidence"]["total"]
  }
  runtime?: OperationStatusSummary["runtime"]
  recommendedTools: string[]
  continuationPrompt: string
  lastEvents: unknown[]
}

export type OperationResumeOptions = {
  eventLimit?: number
  staleAfterMinutes?: number
  now?: string
}

function emptyFindingStateCounts() {
  return Object.fromEntries(FINDING_STATES.map((state) => [state, 0])) as Record<FindingState, number>
}

function emptySeverityCounts() {
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>
}

function emptyEvidenceKindCounts() {
  return Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, 0])) as Record<EvidenceKind, number>
}

export type OperationAuditOptions = OperationResumeOptions & ReportLintOptions

export type OperationAuditResult = {
  operationID: string
  root: string
  generatedAt: string
  ok: boolean
  checks: {
    resume: {
      ok: boolean
      status: OperationResumeBrief["health"]["status"]
      gaps: string[]
    }
    finalHandoff: {
      ok: boolean
      status: "ready" | "attention_required"
      gaps: string[]
      counts: ReportLintResult["counts"]
      gates?: {
        minOutlineTargetPages?: number
        minPdfPages?: number
      }
    }
    coverage: CoverageReadiness
    credentialHandoff: {
      ok: boolean
      required: boolean
      status: "ready" | "attention_required" | "not_required"
      gaps: string[]
      credentialCount: number
      expectedServices?: string[]
      missingServices?: string[]
      submittedAt?: string
      reviewFile: string
    }
    credentialLeakAudit: {
      ok: boolean
      findings: Array<{ label: string; reason: string }>
    }
  }
  blockers: string[]
  recommendedTools: string[]
  files: {
    json: string
    markdown: string
  }
}

export type OperationStageGateOptions = Pick<
  ReportLintOptions,
  | "requireReport"
  | "minWords"
  | "requireOutlineBudget"
  | "minOutlineTargetPages"
  | "minOutlineWordsPerPage"
  | "requireOutlineSections"
  | "minOutlineSectionWords"
  | "minOutlineSectionWordsPerPage"
  | "requireFindingSections"
  | "minFindingWords"
  | "minPdfPages"
> & {
  stage?: Stage
}

export type OperationStageGateResult = {
  operationID: string
  root: string
  generatedAt: string
  stage: Stage
  ok: boolean
  gaps: string[]
  requiredArtifacts: string[]
  recommendedTools: string[]
  files: {
    json: string
    markdown: string
  }
}

export type ReportRenderInput = {
  operationID: string
  title?: string
}

export type ReportRenderResult = {
  operationID: string
  html: string
  pdf: string
  readme: string
  manifest: string
  internalReviewMarkdown: string
  internalReviewJson: string
  findingsJson: string
  evidenceIndex: string
  operatorReview: string
  executiveSummary: string
  technicalAppendix: string
  boardReport: string
  boardReportPdf: string
  cehTechnicalReport: string
  cehTechnicalReportPdf: string
  ulmTeamReport: string
  ulmTeamReportPdf: string
  runtimeSummaryMarkdown: string
  finalDir: string
  findings: number
}

type InternalReviewEntry = {
  artifact: string
  location: string
  reasons: string[]
  content: string
}

export type RuntimeSummaryInput = {
  operationID: string
  sessionMessages?: RuntimeUsageMessage[]
  modelCalls?: {
    total?: number
    byModel?: Record<string, number>
  }
  usage?: {
    inputTokens?: number
    outputTokens?: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    totalTokens?: number
    costUSD?: number
    budgetUSD?: number
    remainingUSD?: number
    byAgent?: Record<
      string,
      {
        calls?: number
        totalTokens?: number
        costUSD?: number
      }
    >
    byLane?: Record<
      string,
      {
        calls?: number
        totalTokens?: number
        costUSD?: number
      }
    >
  }
  compaction?: {
    count?: number
    pressure?: "low" | "moderate" | "high" | "critical"
    lastSummary?: string
  }
  fetches?: {
    total?: number
    repeatedTargets?: string[]
  }
  backgroundTasks?: Array<{
    id: string
    agent?: string
    status: "running" | "completed" | "failed" | "cancelled" | "stale" | "superseded" | "nonblocking" | "needs_recovery" | "unknown"
    summary?: string
    restartArgs?: {
      task_id: string
      background: boolean
      description: string
      prompt: string
      subagent_type: string
      operationID?: string
      laneID?: string
      command?: string
    }
  }>
  notes?: string[]
}

export type RuntimeUsageMessage = {
  role?: string
  agent?: string
  laneID?: string
  modelID?: string
  providerID?: string
  summary?: boolean
  cost?: number
  parts?: Array<{
    type?: string
    auto?: boolean
    overflow?: boolean
  }>
  tokens?: {
    total?: number
    input?: number
    output?: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
}

export type RuntimeSummaryRecord = RuntimeSummaryInput & {
  operationID: string
  generatedAt: string
  operation?: Pick<OperationRecord, "stage" | "status" | "summary" | "nextActions" | "blockers" | "activeTasks">
  artifacts: {
    root: string
    status: string
    events: string
    findings: string
    final: string
  }
}

export type RuntimeSummaryResult = {
  operationID: string
  json: string
  markdown: string
  finalDir: string
}

export type EvalScorecardInput = {
  operationID: string
  target: string
  sandbox?: string
  allowedProfiles?: string[]
  successCriteria: string[]
  artifactRequirements?: string[]
  mitreTags?: string[]
  budget?: {
    maxHours?: number
    maxUSD?: number
  }
  metrics: {
    passed: boolean
    timeToFirstSignalMs?: number
    validatedFindings: number
    falsePositives: number
    toolFailures: number
    retries: number
    costUSD?: number
    reportQuality: "passed" | "failed" | "not_checked"
  }
  notes?: string[]
}

export type EvalScorecardRecord = EvalScorecardInput & {
  operationID: string
  generatedAt: string
}

export type EvalScorecardResult = {
  operationID: string
  json: string
  markdown: string
}

export type OperationPlanPhase = {
  stage: Stage
  objective: string
  actions: string[]
  successCriteria: string[]
  subagents: string[]
  noSubagents: string[]
}

export type OperationExecutionBlock = {
  id?: string
  stage: Stage
  laneID: string
  title: string
  startMinute: number
  durationMinutes: number
  objective: string
  actions: string[]
  successCriteria: string[]
  fallbackWork: string[]
  subagents: string[]
  expectedArtifacts?: string[]
}

export type PlanningApproval = {
  status: "not_required" | "pending" | "approved" | "rejected"
  discoveryCharterPath?: string
  approvedAt?: string
  approver?: string
  notes?: string[]
}

export type DiscoveryCharterInvestmentStrategy = {
  purpose: string
  researchQuestions: string[]
  reconInvestments: string[]
  operatorQuestions: string[]
  candidateDeepWorkLanes: string[]
  decisionCriteriaForFullPlan: string[]
}

export type OperationTimeBudget = {
  targetHours: number
  finalizationWindowHours?: number
  durationFit?: {
    confidence: "low" | "medium" | "high" | "duration_sized"
    evidence: string[]
    overflowBacklog: string[]
  }
  allocations: Array<{
    stage: Stage
    hours: number
    work: string
  }>
  executionBlocks?: OperationExecutionBlock[]
}

export type CoverageContractStatus = "unmet" | "partial" | "met" | "released"
export type CoverageImpact = "none" | "low" | "medium" | "high" | "blocks_release"

export type CoverageContractInput = {
  operationID: string
  status?: CoverageContractStatus
  goals: string[]
  minimumEvidence: string[]
  requiredLanes: string[]
  allowedSkippedLanes: string[]
  fallbackRules: string[]
  retryRules: string[]
  subagentOpportunities: string[]
  reportGates: string[]
  releaseNotes?: string[]
}

export type CoverageContractRecord = CoverageContractInput & {
  operationID: string
  status: CoverageContractStatus
  writtenAt: string
}

export type CoverageReadiness = {
  ok: boolean
  status: CoverageContractStatus | "missing"
  gaps: string[]
}

export type OperationPlanInput = {
  operationID: string
  templateName?: string
  trustLevel?: "guided" | "moderate" | "unattended" | "lab_full"
  scanProfile?: "paranoid" | "stealth" | "balanced" | "aggressive" | "lab-insane"
  browserEvidence?: boolean
  operationMemory?: boolean
  reportDesignProfile?: "standard" | "premium" | "board-ready"
  credentialTargets?: string[]
  scopeRules?: string[]
  assumptions?: string[]
  planningApproval?: PlanningApproval
  discoveryCharter?: DiscoveryCharterInvestmentStrategy
  timeBudget?: OperationTimeBudget
  coverageContract?: Omit<CoverageContractInput, "operationID"> & { operationID?: string }
  phases: OperationPlanPhase[]
  reportingCloseout: string[]
}

export type OperationPlanRecord = OperationPlanInput & {
  operationID: string
  writtenAt: string
  objective?: string
}

export type OperationPlanResult = {
  operationID: string
  json: string
  markdown: string
  phases: number
}

export type OperationDiscoveryCharterInput = Omit<
  OperationPlanInput,
  "timeBudget" | "coverageContract" | "phases" | "reportingCloseout"
> & {
  discoveryCharter: DiscoveryCharterInvestmentStrategy
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
  const resolvedWorktree = base
  let current = resolvedWorktree
  while (true) {
    const candidate = path.join(current, ".ulmcode", "operations")
    if (existsSync(candidate)) return candidate

    const parent = path.dirname(current)
    if (parent === current) return path.join(resolvedWorktree, ".ulmcode", "operations")
    current = parent
  }
}

export function operationPath(worktree: string, operationID: string) {
  return path.join(operationsRoot(worktree), slug(operationID, "operation"))
}

async function readOperationObjective(worktree: string, operationID: string) {
  const root = operationPath(worktree, operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  if (operation?.objective) return operation.objective
  const goal = await readJson<OperationGoalStatusRecord>(path.join(root, "goals", "operation-goal.json"))
  return goal?.objective
}

export function makeOperationID(input: Pick<OperationCheckpointInput, "operationID" | "objective">) {
  return slug(input.operationID ?? input.objective ?? "", `operation-${Date.now()}`)
}

export function makeFindingID(input: Pick<FindingInput, "findingID" | "title">) {
  return slug(input.findingID ?? input.title, `finding-${Date.now()}`)
}

export function makeEvidenceID(input: Pick<EvidenceInput, "evidenceID" | "title">) {
  return slug(input.evidenceID ?? input.title, `evidence-${Date.now()}`)
}

export function makePersonProfileID(input: Pick<PersonProfileInput, "name" | "role">) {
  return slug(`${input.name}-${input.role}`, `person-${Date.now()}`)
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function normalizeOperationRecord(record: OperationRecord | undefined): OperationRecord | undefined {
  if (!record) return undefined
  const legacy = record as OperationRecord & { createdAt?: string; updatedAt?: string }
  return {
    ...record,
    stage: record.stage ?? "intake",
    status: (record.status as string | undefined) === "active" ? "running" : (record.status ?? "running"),
    summary: record.summary ?? "",
    nextActions: record.nextActions ?? [],
    blockers: record.blockers ?? [],
    riskLevel: record.riskLevel ?? "medium",
    activeTasks: record.activeTasks ?? [],
    evidence: record.evidence ?? [],
    time: record.time ?? {
      created: legacy.createdAt ?? new Date().toISOString(),
      updated: legacy.updatedAt ?? legacy.createdAt ?? new Date().toISOString(),
    },
  }
}

async function readOperationSessionBindings(worktree: string, operationID: string) {
  const dir = path.join(worktree, ".ulmcode", "session-bindings")
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const bindings = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJson<NonNullable<OperationStatusSummary["sessions"]>[number]>(path.join(dir, entry))),
  )
  return bindings
    .filter((binding): binding is NonNullable<OperationStatusSummary["sessions"]>[number] => binding?.operationID === operationID)
    .sort((a, b) => b.boundAt.localeCompare(a.boundAt))
}

async function readText(file: string) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

type CredentialReviewSubmission = {
  operationID?: string
  submittedAt?: string
  credentials?: unknown[]
  file?: string
}

export function operationPlanRequiresCredentialHandoff(plan: unknown) {
  if (!plan) return false
  if (expectedCredentialServices(plan).length > 0) return true
  const text = JSON.stringify(plan).toLowerCase()
  if (!/\bcredential|\bauthenticated\b/.test(text)) return false
  if (/\b(?:no|without)\s+(?:[a-z0-9_-]+\s+){0,4}credentials?\b/.test(text) || /\bunauthenticated\b/.test(text)) {
    return false
  }
  return (
    /\b(?:provided|available|submitted|vault|test|use|using|required|credentialed)\b.{0,120}\bcredentials?\b/.test(text) ||
    /\bcredentials?\b.{0,120}\b(?:provided|available|submitted|vault|test|use|using|required)\b/.test(text) ||
    /\bauthenticated\b.{0,120}\b(?:checks?|validation|review|router|portal|ad|ldap|login|service)\b/.test(text)
  )
}

async function evaluateCredentialHandoff(root: string, plan: unknown) {
  const required = operationPlanRequiresCredentialHandoff(plan)
  const reviewFile = path.join(root, "credentials", "review-submission.json")
  const review = await readJson<CredentialReviewSubmission>(reviewFile)
  const operationID = path.basename(root)
  const credentialCount = Array.isArray(review?.credentials) ? review.credentials.length : 0
  const submittedAtValid = typeof review?.submittedAt === "string" && Number.isFinite(Date.parse(review.submittedAt))
  const submitted = Boolean(submittedAtValid && credentialCount > 0)
  const operationIDGaps =
    review?.operationID && slug(review.operationID, "operation") !== operationID
      ? ["credential review operation id does not match selected operation"]
      : []
  const submittedAtGaps =
    review?.submittedAt && !submittedAtValid ? ["credential review submittedAt is not a valid timestamp"] : []
  const fileReferenceGaps =
    review?.file && path.resolve(review.file) !== path.resolve(reviewFile)
      ? ["credential review file reference is not canonical"]
      : []
  const indexGaps = Array.isArray(review?.credentials) ? credentialIndexGaps(review.credentials) : []
  const missingServices = missingCredentialServices(plan, Array.isArray(review?.credentials) ? review.credentials : [])
  const serviceGaps = missingServices.map((service) => `credential review is missing a submitted record for plan service: ${service}`)
  const rawSecretGaps = containsRawCredentialSecret(review?.credentials)
    ? ["credential review contains raw secret fields instead of redacted records"]
    : []
  const reviewGaps = [...operationIDGaps, ...submittedAtGaps, ...fileReferenceGaps, ...indexGaps, ...serviceGaps, ...rawSecretGaps]
  const gaps =
    required && review?.submittedAt && !submittedAtValid
      ? submittedAtGaps
      : required && !submitted
      ? [
          review?.submittedAt
            ? "credentialed plan requires at least one submitted credential vault record"
            : "credentialed plan requires submitted credential vault review",
        ]
      : required
        ? reviewGaps
        : []
  return {
    ok: !required || (submitted && reviewGaps.length === 0),
    required,
    status: required ? (submitted && reviewGaps.length === 0 ? "ready" : "attention_required") : "not_required",
    gaps,
    credentialCount,
    expectedServices: expectedCredentialServices(plan),
    missingServices,
    submittedAt: review?.submittedAt,
    reviewFile,
  } as const
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n")
}

async function appendJsonl(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(data) + "\n")
}

async function readJsonlTail(file: string, limit: number) {
  try {
    return (await fs.readFile(file, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function fileSize(file: string) {
  try {
    const stat = await fs.stat(file)
    return stat.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function nonEmptyArtifact(root: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("..") || relativePath.includes("*"))
    return false
  const resolved = path.resolve(root, relativePath.replace(/\/+$/g, ""))
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) return false
  try {
    const stat = await fs.stat(resolved)
    if (stat.isDirectory()) return (await fs.readdir(resolved)).length > 0
    return stat.size > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function proofCoversExpected(artifact: string, expected: string) {
  const cleanArtifact = artifact.replace(/\/+$/g, "")
  const cleanExpected = expected.replace(/\/+$/g, "")
  if (expected.endsWith("/")) return cleanArtifact === cleanExpected || cleanArtifact.startsWith(`${cleanExpected}/`)
  return cleanArtifact === cleanExpected
}

async function laneProofIsValid(
  root: string,
  operationID: string,
  lane: NonNullable<OperationGraphStatusRecord["lanes"]>[number],
) {
  return (await laneProofProblems(root, operationID, lane)).length === 0
}

async function laneProofProblems(
  root: string,
  operationID: string,
  lane: NonNullable<OperationGraphStatusRecord["lanes"]>[number],
) {
  const problems: string[] = []
  const laneID = lane.id
  if (!laneID) return ["lane id is missing"]
  const proof = await readJson<LaneProofRecord>(path.join(root, "lane-complete", `${laneID}.json`))
  if (!proof) return ["lane-complete proof file is missing"]
  if (proof.operationID !== operationID) problems.push(`operationID must be ${operationID}`)
  if (proof.laneID !== laneID) problems.push(`laneID must be ${laneID}`)
  if (proof.status !== "complete") problems.push("status must be complete")
  if (!proof.summary?.trim()) problems.push("summary is required")
  const artifacts = proof.artifacts ?? []
  if (!artifacts.length) problems.push("artifacts are required")
  for (const artifact of artifacts) {
    if (!(await nonEmptyArtifact(root, artifact))) problems.push(`artifact is missing or empty: ${artifact}`)
  }
  for (const expected of lane.expectedArtifacts ?? []) {
    if (!artifacts.some((artifact) => proofCoversExpected(artifact, expected)))
      problems.push(`does not cover expected artifact: ${expected}`)
  }
  return problems
}

async function laneTerminalProofIsAccepted(
  root: string,
  operationID: string,
  lane: NonNullable<OperationGraphStatusRecord["lanes"]>[number],
) {
  const laneID = lane.id
  if (!laneID) return false
  const status = lane.status
  if (status !== "skipped" && status !== "blocked") return false
  if (lane.releaseRequired !== false || lane.coverageImpact === "blocks_release") return false
  const proof = await readJson<LaneProofRecord>(path.join(root, "lane-complete", `${laneID}.json`))
  if (!proof) return false
  if (proof.operationID !== operationID || proof.laneID !== laneID || proof.status !== status) return false
  if (!proof.summary?.trim()) return false
  if (proof.releaseRequired !== false || proof.coverageImpact === "blocks_release") return false
  for (const artifact of proof.artifacts ?? []) {
    if (!(await nonEmptyArtifact(root, artifact))) return false
  }
  return true
}

async function laneTerminalProofProblems(
  root: string,
  operationID: string,
  lane: NonNullable<OperationGraphStatusRecord["lanes"]>[number],
) {
  const problems: string[] = []
  const laneID = lane.id
  if (!laneID) return ["lane id is missing"]
  const status = lane.status
  if (status !== "skipped" && status !== "blocked") return ["lane status is not terminal skipped or blocked"]
  const proof = await readJson<LaneProofRecord>(path.join(root, "lane-complete", `${laneID}.json`))
  if (!proof) return ["lane-complete proof file is missing"]
  if (proof.operationID !== operationID) problems.push(`operationID must be ${operationID}`)
  if (proof.laneID !== laneID) problems.push(`laneID must be ${laneID}`)
  if (proof.status !== status) problems.push(`status must be ${status}`)
  if (!proof.summary?.trim()) problems.push("summary is required")
  if (lane.releaseRequired !== false || lane.coverageImpact === "blocks_release")
    problems.push("terminal skipped/blocked proof is only accepted for non-release lanes that do not block release")
  if (proof.releaseRequired !== false) problems.push("releaseRequired must be false")
  if (proof.coverageImpact === "blocks_release") problems.push("coverageImpact must not be blocks_release")
  for (const artifact of proof.artifacts ?? []) {
    if (!(await nonEmptyArtifact(root, artifact))) problems.push(`artifact is missing or empty: ${artifact}`)
  }
  return problems
}

function statusTime(value: string | undefined) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

async function readLatestSupervisorStatus(root: string): Promise<OperationStatusSummary["supervisor"] | undefined> {
  let entries: string[]
  try {
    entries = await fs.readdir(path.join(root, "supervisor"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  const reviews = (
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith("supervisor-review-") && entry.endsWith(".json"))
        .map((entry) => readJson<SupervisorReviewStatusRecord>(path.join(root, "supervisor", entry))),
    )
  )
    .filter((review): review is SupervisorReviewStatusRecord => !!review)
    .sort((a, b) => statusTime(b.generatedAt) - statusTime(a.generatedAt))
  const review = reviews[0]
  if (!review) return undefined
  const decision = review.decisions?.[0]
  return {
    generatedAt: review.generatedAt,
    action: decision?.action,
    reason: decision?.reason,
    requiredNextTool: decision?.requiredNextTool,
    blockers: (review.decisions ?? [])
      .filter(
        (item) =>
          item.action &&
          item.action !== "continue" &&
          item.action !== "handoff_ready" &&
          item.action !== "release_handoff",
      )
      .map((item) => item.reason)
      .filter((item): item is string => !!item),
    nextTools: [
      ...new Set(
        (review.decisions ?? []).map((item) => item.requiredNextTool).filter((item): item is string => !!item),
      ),
    ],
  }
}

async function readToolInventoryStatus(root: string): Promise<OperationStatusSummary["toolInventory"] | undefined> {
  const inventory = await readJson<ToolInventoryStatusRecord>(path.join(root, "tool-inventory", "tool-inventory.json"))
  if (!inventory) return undefined
  const highValue = (inventory.tools ?? []).filter((tool) => tool.highValue)
  return {
    generatedAt: inventory.generatedAt,
    total: inventory.counts?.total ?? inventory.tools?.length ?? 0,
    installed: inventory.counts?.installed ?? inventory.tools?.filter((tool) => tool.installed).length ?? 0,
    missing: inventory.counts?.missing ?? inventory.tools?.filter((tool) => !tool.installed).length ?? 0,
    highValueMissing: inventory.counts?.highValueMissing ?? highValue.filter((tool) => !tool.installed).length,
    installedHighValue: highValue
      .filter((tool) => tool.installed)
      .map((tool) => tool.id)
      .filter((item): item is string => !!item)
      .slice(0, 8),
    missingHighValue: highValue
      .filter((tool) => !tool.installed)
      .map((tool) => tool.id)
      .filter((item): item is string => !!item)
      .slice(0, 8),
  }
}

async function readGraphStatus(root: string, operationID: string): Promise<OperationStatusSummary["graph"]> {
  const graph = await readJson<OperationGraphStatusRecord>(path.join(root, "plans", "operation-graph.json"))
  if (!graph?.lanes) return undefined
  const byStatus: Record<string, number> = {}
  const failed: string[] = []
  const running: string[] = []
  const incomplete: string[] = []
  const missingProofs: string[] = []
  const invalidProofs: string[] = []
  const invalidProofReasons: Record<string, string[]> = {}
  for (const lane of graph.lanes) {
    const id = lane.id ?? "unknown"
    const status = lane.status ?? "unknown"
    byStatus[status] = (byStatus[status] ?? 0) + 1
    const acceptedTerminalProof = await laneTerminalProofIsAccepted(root, operationID, lane)
    if (status === "failed") failed.push(id)
    if (status === "running") running.push(id)
    if (status !== "complete" && !acceptedTerminalProof) incomplete.push(id)
    if (status === "complete") {
      const proofPath = path.join(root, "lane-complete", `${id}.json`)
      if (!(await exists(proofPath))) missingProofs.push(id)
      else {
        const proofProblems = await laneProofProblems(root, operationID, lane)
        if (proofProblems.length) {
          invalidProofs.push(id)
          invalidProofReasons[id] = proofProblems
        }
      }
    } else if ((status === "skipped" || status === "blocked") && !acceptedTerminalProof) {
      const proofPath = path.join(root, "lane-complete", `${id}.json`)
      if (await exists(proofPath)) {
        invalidProofs.push(id)
        invalidProofReasons[id] = await laneTerminalProofProblems(root, operationID, lane)
      }
    }
  }
  return {
    exists: true,
    lanes: {
      total: graph.lanes.length,
      byStatus,
      failed,
      running,
      incomplete,
      missingProofs,
      invalidProofs,
      invalidProofReasons,
    },
  }
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function roundUsage(value: number) {
  return Number(value.toFixed(6))
}

function derivedTotal(tokens: RuntimeUsageMessage["tokens"]) {
  if (!tokens) return 0
  if (tokens.total !== undefined) return finite(tokens.total)
  return finite(tokens.input) + finite(tokens.output) + finite(tokens.reasoning)
}

export function summarizeRuntimeUsage(messages: RuntimeUsageMessage[]) {
  const modelCalls: NonNullable<RuntimeSummaryInput["modelCalls"]> = { total: 0, byModel: {} }
  const usage: NonNullable<RuntimeSummaryInput["usage"]> = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    byAgent: {},
    byLane: {},
  }

  for (const message of messages) {
    if (message.role !== "assistant") continue
    const model = message.modelID ?? "unknown"
    const agent = message.agent ?? "unknown"
    const laneID = message.laneID
    const tokens = message.tokens
    const totalTokens = derivedTotal(tokens)
    const cost = finite(message.cost)

    modelCalls.total = (modelCalls.total ?? 0) + 1
    modelCalls.byModel![model] = (modelCalls.byModel![model] ?? 0) + 1
    usage.inputTokens = (usage.inputTokens ?? 0) + finite(tokens?.input)
    usage.outputTokens = (usage.outputTokens ?? 0) + finite(tokens?.output)
    usage.reasoningTokens = (usage.reasoningTokens ?? 0) + finite(tokens?.reasoning)
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + finite(tokens?.cache?.read)
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + finite(tokens?.cache?.write)
    usage.totalTokens = (usage.totalTokens ?? 0) + totalTokens
    usage.costUSD = roundUsage((usage.costUSD ?? 0) + cost)

    const agentUsage = usage.byAgent![agent] ?? { calls: 0, totalTokens: 0, costUSD: 0 }
    usage.byAgent![agent] = {
      calls: (agentUsage.calls ?? 0) + 1,
      totalTokens: (agentUsage.totalTokens ?? 0) + totalTokens,
      costUSD: roundUsage((agentUsage.costUSD ?? 0) + cost),
    }
    if (laneID) {
      const laneUsage = usage.byLane![laneID] ?? { calls: 0, totalTokens: 0, costUSD: 0 }
      usage.byLane![laneID] = {
        calls: (laneUsage.calls ?? 0) + 1,
        totalTokens: (laneUsage.totalTokens ?? 0) + totalTokens,
        costUSD: roundUsage((laneUsage.costUSD ?? 0) + cost),
      }
    }
  }

  return { modelCalls, usage }
}

function mergeRuntimeUsage(input: RuntimeSummaryInput) {
  const derived = input.sessionMessages?.length ? summarizeRuntimeUsage(input.sessionMessages) : undefined
  const compaction = input.compaction ?? deriveRuntimeCompaction(input.sessionMessages ?? [])
  if (!derived) {
    const next = { ...input, usage: normalizeRuntimeBudget(input.usage) }
    return compaction ? { ...next, compaction } : next
  }
  const usage = input.usage
    ? {
        ...derived.usage,
        ...input.usage,
        byAgent: {
          ...derived.usage.byAgent,
          ...input.usage.byAgent,
        },
        byLane: {
          ...derived.usage.byLane,
          ...input.usage.byLane,
        },
      }
    : derived.usage

  return {
    ...input,
    modelCalls: input.modelCalls ?? derived.modelCalls,
    usage: normalizeRuntimeBudget(usage),
    compaction,
  }
}

function compactionPressure(count: number): "low" | "moderate" | "high" | "critical" {
  if (count >= 8) return "critical"
  if (count >= 4) return "high"
  if (count >= 2) return "moderate"
  return "low"
}

function deriveRuntimeCompaction(messages: RuntimeUsageMessage[]): RuntimeSummaryInput["compaction"] | undefined {
  const count = messages.reduce(
    (total, message) => total + (message.parts ?? []).filter((part) => part.type === "compaction").length,
    0,
  )
  if (!count) return undefined
  return {
    count,
    pressure: compactionPressure(count),
  }
}

function normalizeRuntimeBudget(usage: RuntimeSummaryInput["usage"]) {
  if (!usage) return usage
  if (usage.remainingUSD !== undefined) return usage
  const budgetUSD = usage.budgetUSD
  const costUSD = usage.costUSD
  if (budgetUSD === undefined || costUSD === undefined || !Number.isFinite(budgetUSD) || !Number.isFinite(costUSD)) {
    return usage
  }
  return {
    ...usage,
    remainingUSD: roundUsage(budgetUSD - costUSD),
  }
}

async function operationCredentialRedactionPairs(operationID: string) {
  const operationSlug = slug(operationID, "operation")
  const dataDirs = [
    process.env.ULMCODE_CREDENTIAL_FALLBACK_DATA_DIR,
    path.join(process.env.HOME ?? "", ".local", "share", "ulmcode"),
    path.join(process.env.HOME ?? "", ".local", "share", "opencode"),
  ].filter((item): item is string => Boolean(item))
  const pairs: [string, string][] = []
  for (const dataDir of dataDirs) {
    const dir = path.join(dataDir, "storage", "ulm", "credential", operationSlug)
    const entries = await fs.readdir(dir).catch(() => [])
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue
      const record = await readJson<Record<string, unknown>>(path.join(dir, entry))
      for (const key of ["username", "password", "secret", "token", "apiKey"]) {
        const value = record?.[key]
        if (typeof value !== "string" || value.length < 3) continue
        pairs.push([value, key === "username" ? "[REDACTED_CREDENTIAL_USERNAME]" : "[REDACTED_CREDENTIAL_SECRET]"])
      }
    }
  }
  return pairs
}

export async function redactOperationCredentialValues<T>(operationID: string, value: T): Promise<T> {
  const pairs = await operationCredentialRedactionPairs(operationID)
  if (!pairs.length) return value
  const redact = (item: unknown): unknown => {
    if (typeof item === "string") {
      return pairs.reduce((text, [raw, replacement]) => text.split(raw).join(replacement), item)
    }
    if (Array.isArray(item)) return item.map((entry) => redact(entry))
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, redact(entry)]))
    }
    return item
  }
  return redact(value) as T
}

function listLines(items: string[] | undefined, empty: string) {
  if (!items?.length) return [`- ${empty}`]
  return items.map((item) => `- ${item}`)
}

function compactRecord(input: Record<string, number> | undefined) {
  return Object.entries(input ?? {})
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")
}

export function formatOperationStatusDashboard(status: OperationStatusSummary) {
  const operation = status.operation
  const modelSplit = compactRecord(status.runtime?.modelCalls?.byModel)
  const stateSplit = compactRecord(status.findings.byState)
  const severitySplit = compactRecord(status.findings.bySeverity)
  const evidenceSplit = compactRecord(status.evidence.byKind)
  const reports = [
    status.plans.operation ? "plan" : undefined,
    status.reports.outline ? "outline" : undefined,
    status.reports.markdown ? "report.md" : undefined,
    status.reports.html ? "html" : undefined,
    status.reports.pdf ? "pdf" : undefined,
    status.reports.readme ? "readme" : undefined,
    status.reports.manifest ? "manifest" : undefined,
    status.runtimeSummary ? "runtime" : undefined,
  ].filter((item): item is string => !!item)
  const background = status.runtime?.backgroundTasks ?? []
  const runtimeNotes = status.runtime?.notes ?? []
  return [
    `# ${status.operationID} - ${operation?.stage ?? "unknown"}/${operation?.status ?? "unknown"}`,
    "",
    `root: ${status.root}`,
    `risk: ${operation?.riskLevel ?? "unknown"}`,
    `summary: ${operation?.summary ?? "No checkpoint recorded."}`,
    `goal: ${status.goal?.status ?? "missing"}${
      status.goal?.targetDurationHours !== undefined ? `, ${status.goal.targetDurationHours}h` : ""
    }${status.goal?.objective ? ` - ${status.goal.objective}` : ""}`,
    `supervisor: ${status.supervisor?.action ?? "none"}${
      status.supervisor?.reason ? ` - ${status.supervisor.reason}` : ""
    }${status.supervisor?.requiredNextTool ? `; next_tool ${status.supervisor.requiredNextTool}` : ""}`,
    `tools: ${
      status.toolInventory
        ? `${status.toolInventory.installed}/${status.toolInventory.total} installed, ${status.toolInventory.highValueMissing} high-value missing`
        : "inventory missing; run tool_inventory"
    }`,
    `policy: ${status.policies.foregroundCommand}`,
    "",
    `findings: ${status.findings.total} total${stateSplit ? ` (${stateSplit})` : ""}${
      severitySplit ? `; severity ${severitySplit}` : ""
    }`,
    `evidence: ${status.evidence.total} total${evidenceSplit ? ` (${evidenceSplit})` : ""}`,
    `reports: ${reports.length ? reports.join(", ") : "none"}`,
    `runtime: ${status.runtime?.modelCalls?.total ?? 0} calls, ${status.runtime?.usage?.totalTokens ?? 0} tokens, $${
      status.runtime?.usage?.costUSD ?? 0
    }${status.runtime?.usage?.remainingUSD !== undefined ? `, $${status.runtime.usage.remainingUSD} remaining` : ""}`,
    `models: ${modelSplit || "none recorded"}`,
    "",
    "next_actions:",
    ...listLines(operation?.nextActions, "none recorded"),
    "",
    "blockers:",
    ...listLines([...(operation?.blockers ?? []), ...(status.supervisor?.blockers ?? [])], "none recorded"),
    "",
    "active_tasks:",
    ...listLines(operation?.activeTasks, "none recorded"),
    "",
    "background:",
    ...(background.length
      ? background.map(
          (task) =>
            `- ${task.id} ${task.status}${task.agent ? ` (${task.agent})` : ""}${
              task.summary ? ` - ${task.summary}` : ""
            }${task.restartArgs ? `; restart_args: ${JSON.stringify(task.restartArgs)}` : ""}`,
        )
      : ["- none recorded"]),
    "",
    "runtime_notes:",
    ...listLines(runtimeNotes, "none recorded"),
    "",
  ].join("\n")
}

function unique(items: string[]) {
  return [...new Set(items)]
}

function minutesSince(value: string | undefined, now: Date) {
  if (!value) return undefined
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return undefined
  return Math.max(0, Math.floor((now.getTime() - time) / 60_000))
}

function runtimeHealthGaps(status: OperationStatusSummary) {
  const gaps: string[] = []
  const usage = status.runtime?.usage
  const costUSD = usage?.costUSD
  const budgetUSD = usage?.budgetUSD
  const remainingUSD = usage?.remainingUSD
  if (
    budgetUSD !== undefined &&
    costUSD !== undefined &&
    Number.isFinite(budgetUSD) &&
    Number.isFinite(costUSD) &&
    budgetUSD > 0 &&
    (remainingUSD !== undefined && Number.isFinite(remainingUSD) ? remainingUSD <= 0 : costUSD >= budgetUSD)
  ) {
    gaps.push(`runtime budget exhausted: spent $${costUSD} of $${budgetUSD}`)
  }
  for (const note of status.runtime?.notes ?? []) {
    if (note.startsWith("runtime blind spot:")) {
      gaps.push(`runtime usage blind spot recorded: ${note}`)
    }
  }
  return gaps
}

function formatInvalidProofReasons(reasons: string[] | undefined) {
  return reasons?.length ? `: ${reasons.join("; ")}` : ""
}

function completedNmapTaskExists(status: OperationStatusSummary) {
  return (status.runtime?.backgroundTasks ?? []).some(
    (task) => task.status === "completed" && /\bnmap\b/i.test(backgroundTaskText(task)),
  )
}

function nonBlockingCompletedHandoffRuntimeTask(
  status: OperationStatusSummary,
  task: NonNullable<RuntimeSummaryRecord["backgroundTasks"]>[number],
) {
  if (status.operation?.stage !== "handoff") return false
  if (task.status !== "stale") return false
  const text = backgroundTaskText(task)
  if (/\breport\b/i.test(text)) return true
  if (completedNmapTaskExists(status) && /\bnmap\b/i.test(text)) return true
  if (/\bnuclei\b/i.test(text)) return true
  return false
}

function resumeGaps(status: OperationStatusSummary, options: OperationResumeOptions = {}) {
  const gaps: string[] = []
  const operation = status.operation
  const staleAfter = options.staleAfterMinutes
  const now = new Date(options.now ?? Date.now())
  if (!operation) gaps.push("operation checkpoint is missing")
  if (!status.plans.operation) gaps.push("operation plan is missing")
  if (!status.graph) gaps.push("operation graph is missing")
  for (const lane of status.graph?.lanes.failed ?? []) gaps.push(`operation lane ${lane} is failed`)
  for (const lane of status.graph?.lanes.missingProofs ?? [])
    gaps.push(`operation lane ${lane} is missing completion proof`)
  for (const lane of status.graph?.lanes.invalidProofs ?? [])
    gaps.push(
      `operation lane ${lane} has invalid completion proof${formatInvalidProofReasons(status.graph?.lanes.invalidProofReasons?.[lane])}`,
    )
  if (!status.runtimeSummary) gaps.push("runtime summary is missing")
  gaps.push(...runtimeHealthGaps(status))
  if (operation?.status === "running" && staleAfter !== undefined) {
    const age = minutesSince(operation.time.updated, now)
    if (age !== undefined && age >= staleAfter) {
      gaps.push(`operation checkpoint is stale: last update was ${age} minutes ago`)
    }
  }
  if (operation?.status === "running" && operation.nextActions.length === 0) {
    gaps.push("running operation has no next actions")
  }
  if (operation?.status === "blocked" && operation.blockers.length === 0) {
    gaps.push("blocked operation has no blockers recorded")
  }
  if (
    operation?.stage === "handoff" &&
    operation.status === "complete" &&
    (!status.reports.html || !status.reports.pdf || !status.reports.manifest || !status.reports.readme)
  ) {
    gaps.push("complete handoff is missing final deliverables")
  }
  for (const task of status.runtime?.backgroundTasks ?? []) {
    if (task.status === "stale" && !nonBlockingCompletedHandoffRuntimeTask(status, task)) {
      gaps.push(`background task ${task.id} is stale`)
    }
  }
  return gaps
}

function resumeToolRecommendations(status: OperationStatusSummary, gaps: string[]) {
  const operation = status.operation
  const background = status.runtime?.backgroundTasks ?? []
  const tools = ["operation_status"]
  if (gaps.includes("operation plan is missing")) tools.push("operation_plan")
  if (
    gaps.includes("runtime summary is missing") ||
    gaps.some((gap) => gap.startsWith("runtime budget exhausted")) ||
    gaps.some((gap) => gap.startsWith("runtime usage blind spot recorded"))
  ) {
    tools.push("runtime_summary")
  }
  if (gaps.some((gap) => gap.startsWith("operation checkpoint is stale"))) tools.push("operation_checkpoint")
  if (operation?.activeTasks.length || background.length) tools.push("task_list", "task_status")
  if (background.some((task) => task.status === "stale" && task.restartArgs && !nonBlockingCompletedHandoffRuntimeTask(status, task))) {
    tools.push("operation_resume", "operation_recover", "task_restart")
  }
  if (operation?.stage === "validation") tools.push("evidence_record", "finding_record")
  if (operation?.stage === "reporting" || operation?.stage === "handoff") tools.push("report_lint")
  if (operation?.stage === "handoff" && (!status.reports.html || !status.reports.pdf)) tools.push("report_render")
  return unique(tools)
}

function resumeContinuationPrompt(status: OperationStatusSummary, recommendedTools: string[]) {
  const operation = status.operation
  const hasRestartableStaleTasks = (status.runtime?.backgroundTasks ?? []).some(
    (task) => task.status === "stale" && task.restartArgs,
  )
  const recovery = hasRestartableStaleTasks
    ? ` Restart restartable stale lanes first with operation_resume operationID=${status.operationID} recoverStaleTasks=true or operation_recover operationID=${status.operationID}; do not launch duplicate replacement lanes until recovery is checked.`
    : ""
  if (!operation) {
    return `Resume ULMCode operation ${status.operationID}. First recreate or inspect the missing operation checkpoint, then use ${recommendedTools.join(
      ", ",
    )}.${recovery}`
  }
  const nextActions = operation.nextActions.length ? operation.nextActions.join("; ") : "no next actions recorded"
  const blockers = operation.blockers.length ? ` Blockers: ${operation.blockers.join("; ")}.` : ""
  return `Resume ULMCode operation ${status.operationID} from ${operation.stage}/${operation.status}. First use ${recommendedTools[0]} to refresh disk state, then continue: ${nextActions}.${recovery}${blockers}`
}

export async function buildOperationResumeBrief(
  worktree: string,
  operationID: string,
  options: OperationResumeOptions = {},
): Promise<OperationResumeBrief> {
  const status = await readOperationStatus(worktree, operationID, { eventLimit: options.eventLimit ?? 10 })
  const gaps = resumeGaps(status, options)
  const recommendedTools = resumeToolRecommendations(status, gaps)
  return {
    operationID: status.operationID,
    root: status.root,
    generatedAt: new Date().toISOString(),
    checkpoint: status.operation
      ? {
          objective: status.operation.objective,
          stage: status.operation.stage,
          status: status.operation.status,
          summary: status.operation.summary,
          riskLevel: status.operation.riskLevel,
          nextActions: status.operation.nextActions,
          blockers: status.operation.blockers,
          activeTasks: status.operation.activeTasks,
          time: status.operation.time,
        }
      : undefined,
    health: {
      ready: gaps.length === 0,
      status: gaps.length === 0 ? "ready" : "attention_required",
      gaps,
    },
    artifacts: {
      ...status.plans,
      reports: status.reports,
      runtimeSummary: status.runtimeSummary,
      findings: status.findings.total,
      evidence: status.evidence.total,
    },
    runtime: status.runtime,
    recommendedTools,
    continuationPrompt: resumeContinuationPrompt(status, recommendedTools),
    lastEvents: status.lastEvents,
  }
}

export function formatOperationResumeBrief(brief: OperationResumeBrief) {
  const checkpoint = brief.checkpoint
  const background = brief.runtime?.backgroundTasks ?? []
  const statusForTaskFiltering: OperationStatusSummary = {
    operationID: brief.operationID,
    root: brief.root,
    operation: checkpoint
      ? {
          operationID: brief.operationID,
          objective: checkpoint.objective,
          stage: checkpoint.stage,
          status: checkpoint.status,
          summary: checkpoint.summary,
          nextActions: checkpoint.nextActions,
          blockers: checkpoint.blockers,
          riskLevel: checkpoint.riskLevel,
          activeTasks: checkpoint.activeTasks,
          evidence: [],
          time: checkpoint.time,
        }
      : undefined,
    plans: { operation: false, discoveryCharter: false },
    policies: { foregroundCommand: "unknown" },
    findings: { total: 0, byState: emptyFindingStateCounts(), bySeverity: emptySeverityCounts() },
    evidence: { total: 0, byKind: emptyEvidenceKindCounts() },
    reports: { outline: false, markdown: false, html: false, pdf: false, readme: false, manifest: false },
    runtimeSummary: false,
    evalScorecard: false,
    runtime: brief.runtime,
    lastEvents: [],
  }
  const visibleBackground = background.filter((task) => !nonBlockingCompletedHandoffRuntimeTask(statusForTaskFiltering, task))
  const suppressedBackgroundCount = background.length - visibleBackground.length
  const toolHints = [
    brief.recommendedTools.includes("operation_status")
      ? `operation_status operationID=${brief.operationID}`
      : undefined,
    brief.recommendedTools.includes("operation_resume")
      ? `operation_resume operationID=${brief.operationID} recoverStaleTasks=true`
      : undefined,
    brief.recommendedTools.includes("operation_recover")
      ? `operation_recover operationID=${brief.operationID}`
      : undefined,
    brief.recommendedTools.includes("task_list") ? `task_list operationID=${brief.operationID}` : undefined,
    ...visibleBackground.map((task) => `task_status task_id=${task.id}`),
    ...visibleBackground
      .filter((task) => task.status === "stale" && task.restartArgs)
      .map((task) => `task_restart task_id=${task.id}`),
  ].filter((item): item is string => item !== undefined)
  return [
    `# Resume ${brief.operationID}`,
    "",
    `health: ${brief.health.status}`,
    `root: ${brief.root}`,
    `stage: ${checkpoint?.stage ?? "unknown"}`,
    `status: ${checkpoint?.status ?? "unknown"}`,
    `risk: ${checkpoint?.riskLevel ?? "unknown"}`,
    `summary: ${checkpoint?.summary ?? "No checkpoint recorded."}`,
    checkpoint?.time.updated ? `updated: ${checkpoint.time.updated}` : undefined,
    "",
    "gaps:",
    ...listLines(brief.health.gaps, "none"),
    "",
    "recommended_tools:",
    ...listLines(brief.recommendedTools, "none"),
    "",
    "tool_hints:",
    ...listLines(toolHints, "none"),
    "",
    "next_actions:",
    ...listLines(checkpoint?.nextActions, "none recorded"),
    "",
    "blockers:",
    ...listLines(checkpoint?.blockers, "none recorded"),
    "",
    "active_tasks:",
    ...listLines(checkpoint?.activeTasks, "none recorded"),
    "",
    "background:",
    ...(visibleBackground.length || suppressedBackgroundCount
      ? [
          ...visibleBackground.map(
          (task) =>
            `- ${task.id} ${task.status}${task.agent ? ` (${task.agent})` : ""}${
              task.summary ? ` - ${task.summary}` : ""
            }${task.restartArgs ? `; restart_args: ${JSON.stringify(task.restartArgs)}` : ""}`,
          ),
          ...(suppressedBackgroundCount
            ? [`- suppressed ${suppressedBackgroundCount} nonblocking stale handoff task(s) already represented by completed/report artifacts`]
            : []),
        ]
      : ["- none recorded"]),
    "",
    "continuation_prompt:",
    brief.continuationPrompt,
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function backgroundTaskText(task: NonNullable<RuntimeSummaryRecord["backgroundTasks"]>[number]) {
  return [
    task.agent,
    task.summary,
    task.restartArgs?.description,
    task.restartArgs?.prompt,
    task.restartArgs?.subagent_type,
    task.restartArgs?.laneID,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
}

function staleTaskForResumeGap(brief: OperationResumeBrief, gap: string) {
  const staleTask = gap.match(/^background task (\S+) is stale$/)
  if (!staleTask?.[1]) return undefined
  return (brief.runtime?.backgroundTasks ?? []).find((task) => task.id === staleTask[1] && task.status === "stale")
}

function nonBlockingCompletedHandoffResumeGap(brief: OperationResumeBrief, gap: string) {
  if (brief.checkpoint?.stage !== "handoff") return false
  const reportWriterTaskIDs = new Set(
    (brief.runtime?.backgroundTasks ?? [])
      .filter((task) => {
        return task.status === "stale" && /\breport\b/i.test(backgroundTaskText(task))
      })
      .map((task) => task.id),
  )
  const staleTask = gap.match(/^background task (\S+) is stale$/)
  if (staleTask?.[1] && reportWriterTaskIDs.has(staleTask[1])) return true
  const staleBackgroundTask = staleTaskForResumeGap(brief, gap)
  if (staleBackgroundTask) {
    const completedNmapTaskExists = (brief.runtime?.backgroundTasks ?? []).some(
      (task) => task.status === "completed" && /\bnmap\b/i.test(backgroundTaskText(task)),
    )
    if (completedNmapTaskExists && /\bnmap\b/i.test(backgroundTaskText(staleBackgroundTask))) return true
    if (/\bnuclei\b/i.test(backgroundTaskText(staleBackgroundTask))) return true
  }
  const blindSpot = gap.match(/^runtime usage blind spot recorded: runtime blind spot: background task (\S+) \(([^)]+)\)/)
  return Boolean(blindSpot?.[1] && reportWriterTaskIDs.has(blindSpot[1]) && /\breport\b/i.test(blindSpot[2] ?? ""))
}

function statusMarkdown(record: OperationRecord) {
  return [
    `# ${record.operationID}`,
    "",
    `- objective: ${record.objective}`,
    `- stage: ${record.stage}`,
    `- status: ${record.status}`,
    `- risk: ${record.riskLevel}`,
    `- updated: ${record.time.updated}`,
    "",
    "## Summary",
    record.summary,
    "",
    "## Next Actions",
    ...(record.nextActions.length ? record.nextActions.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Blockers",
    ...(record.blockers.length ? record.blockers.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Active Tasks",
    ...(record.activeTasks.length ? record.activeTasks.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Evidence",
    ...(record.evidence.length
      ? record.evidence.map((item) => `- ${item.id}${item.path ? ` (${item.path})` : ""}: ${item.summary ?? ""}`)
      : ["- none recorded"]),
    "",
  ].join("\n")
}

function lintToolRecommendations(gaps: string[]) {
  const tools = ["report_lint"]
  if (gaps.some((gap) => gap.includes("plans/operation-plan.json") || gap.includes("operation plan"))) {
    tools.push("operation_plan")
  }
  if (gaps.some((gap) => gap.includes("deliverables/final/") || gap.includes("report is required"))) {
    tools.push("report_render")
  }
  if (gaps.some((gap) => gap.includes("runtime-summary.json"))) {
    tools.push("runtime_summary")
  }
  if (gaps.some((gap) => gap.includes("finding") || gap.includes("findings"))) {
    tools.push("finding_record")
  }
  if (gaps.some((gap) => gap.includes("evidence"))) {
    tools.push("evidence_record")
  }
  if (
    gaps.some(
      (gap) => gap.includes("outline budget") || gap.includes("report-outline.md") || gap.includes("outline section"),
    )
  ) {
    tools.push("report_outline")
  }
  return tools
}

export function formatOperationAudit(audit: OperationAuditResult) {
  const laneBlockers = audit.blockers.some(
    (blocker) => blocker.includes("operation lane ") || blocker.includes("coverage required lane "),
  )
  const nextStep =
    !audit.ok && laneBlockers && audit.recommendedTools.includes("operation_run")
      ? "next_step: Call operation_run before editing reports or plans."
      : undefined
  return [
    `# Operation Audit ${audit.operationID}`,
    "",
    `status: ${audit.ok ? "ready" : "attention_required"}`,
    `root: ${audit.root}`,
    `generated_at: ${audit.generatedAt}`,
    "",
    `resume: ${audit.checks.resume.status}`,
    ...listLines(audit.checks.resume.gaps, "none"),
    "",
    `final_handoff: ${audit.checks.finalHandoff.status}`,
    ...listLines(audit.checks.finalHandoff.gaps, "none"),
    "",
    `credential_handoff: ${audit.checks.credentialHandoff.status}`,
    ...listLines(audit.checks.credentialHandoff.gaps, "none"),
    "",
    `coverage: ${audit.checks.coverage.ok ? "ready" : "attention_required"} (${audit.checks.coverage.status})`,
    ...listLines(audit.checks.coverage.gaps, "none"),
    "",
    `credential_leak_audit: ${audit.checks.credentialLeakAudit.ok ? "ready" : "attention_required"}`,
    ...listLines(audit.checks.credentialLeakAudit.findings.map((finding) => `${finding.label}: ${finding.reason}`), "none"),
    "",
    "blockers:",
    ...listLines(audit.blockers, "none"),
    "",
    "recommended_tools:",
    ...listLines(audit.recommendedTools, "none"),
    ...(nextStep ? ["", nextStep] : []),
    "",
  ].join("\n")
}

export async function buildOperationAudit(
  worktree: string,
  operationID: string,
  options: OperationAuditOptions = {},
): Promise<OperationAuditResult> {
  const root = operationPath(worktree, operationID)
  const finalHandoffRequired = options.finalHandoff ?? true
  const plan = await readJson<OperationPlanRecord>(path.join(root, "plans", "operation-plan.json"))
  const finalHandoffOptions = { ...options, finalHandoff: finalHandoffRequired }
  const minOutlineTargetPages = finalHandoffMinOutlineTargetPages(plan, finalHandoffOptions)
  const minOutlineWordsPerPage = finalHandoffMinOutlineWordsPerPage(finalHandoffOptions)
  const minPdfPages = finalHandoffRequired
    ? Math.max(options.minPdfPages ?? 0, minOutlineTargetPages ?? 0) || undefined
    : options.minPdfPages
  if (finalHandoffRequired) await promoteCoverageContractIfStructurallyReady(worktree, operationID, "released")
  const resume = await buildOperationResumeBrief(worktree, operationID, {
    eventLimit: options.eventLimit,
    staleAfterMinutes: options.staleAfterMinutes,
    now: options.now,
  })
  const finalHandoff = await lintReport(worktree, operationID, {
    requireReport: options.requireReport,
    minWords: options.minWords,
    requireOutlineBudget: options.requireOutlineBudget,
    minOutlineTargetPages,
    minOutlineWordsPerPage,
    requireOutlineSections: options.requireOutlineSections,
    minOutlineSectionWords: options.minOutlineSectionWords,
    minOutlineSectionWordsPerPage: options.minOutlineSectionWordsPerPage,
    requireFindingSections: options.requireFindingSections,
    minFindingWords: options.minFindingWords,
    minPdfPages,
    finalHandoff: finalHandoffRequired,
    requireOperationPlan: options.requireOperationPlan,
    requireRenderedDeliverables: options.requireRenderedDeliverables,
    requireRuntimeSummary: options.requireRuntimeSummary,
  })
  const coverage = await evaluateCoverageReadiness(worktree, operationID)
  const credentialHandoff = await evaluateCredentialHandoff(root, plan)
  const credentialLeakAudit = await scanOperationArtifacts(worktree, operationID)
  const resumeGaps = resume.health.gaps.filter((gap) => !nonBlockingCompletedHandoffResumeGap(resume, gap))
  const resumeReady = resumeGaps.length === 0
  const generatedAt = new Date().toISOString()
  const files = {
    json: path.join(root, "deliverables", "operation-audit.json"),
    markdown: path.join(root, "deliverables", "operation-audit.md"),
  }
  const audit: OperationAuditResult = {
    operationID: slug(operationID, "operation"),
    root,
    generatedAt,
    ok: resumeReady && finalHandoff.ok && coverage.ok && credentialHandoff.ok && credentialLeakAudit.ok,
    checks: {
      resume: {
        ok: resumeReady,
        status: resumeReady ? "ready" : "attention_required",
        gaps: resumeGaps,
      },
      finalHandoff: {
        ok: finalHandoff.ok,
        status: finalHandoff.ok ? "ready" : "attention_required",
        gaps: finalHandoff.gaps,
        counts: finalHandoff.counts,
        gates: {
          minOutlineTargetPages,
          minPdfPages,
        },
      },
      coverage,
      credentialHandoff,
      credentialLeakAudit: {
        ok: credentialLeakAudit.ok,
        findings: credentialLeakAudit.findings,
      },
    },
    blockers: [
      ...resumeGaps.map((gap) => `resume: ${gap}`),
      ...coverage.gaps.map((gap) => `coverage: ${gap}`),
      ...credentialHandoff.gaps.map((gap) => `credential_handoff: ${gap}`),
      ...credentialLeakAudit.findings.map((finding) => `credential_leak_audit: ${finding.label}: ${finding.reason}`),
      ...finalHandoff.gaps.map((gap) => `final_handoff: ${gap}`),
    ],
    recommendedTools: unique([
      ...(coverage.ok ? [] : ["operation_run", "operation_supervise"]),
      ...resume.recommendedTools,
      ...(credentialHandoff.ok ? [] : ["operation_credentials"]),
      ...lintToolRecommendations(finalHandoff.gaps),
    ]),
    files,
  }
  await fs.mkdir(path.dirname(files.json), { recursive: true })
  await writeJson(files.json, audit)
  await fs.writeFile(files.markdown, formatOperationAudit(audit))
  await publishOperationUpdated(worktree, {
    operationID: audit.operationID,
    artifact: "operation_audit",
    path: files.json,
  })
  return audit
}

function stageRequiredArtifacts(stage: Stage) {
  const common = ["operation.json", "plans/operation-plan.json"]
  if (stage === "intake") return common
  if (stage === "recon") return [...common, "evidence/"]
  if (stage === "mapping") return [...common, "evidence/", "findings/"]
  if (stage === "validation") return [...common, "evidence/", "findings/"]
  if (stage === "reporting")
    return [...common, "findings/", "reports/report-outline.md", "reports/report.md or report.html"]
  return [...common, "deliverables/final/", "deliverables/runtime-summary.json", "deliverables/operation-audit.json"]
}

function stageGateToolRecommendations(stage: Stage, gaps: string[]) {
  const tools = ["operation_status"]
  if (gaps.some((gap) => gap.includes("checkpoint"))) tools.push("operation_checkpoint")
  if (gaps.some((gap) => gap.includes("plan"))) tools.push("operation_plan")
  if (gaps.some((gap) => gap.includes("evidence"))) tools.push("evidence_record")
  if (gaps.some((gap) => gap.includes("finding") || gap.includes("findings"))) tools.push("finding_record")
  if (gaps.some((gap) => gap.includes("outline"))) tools.push("report_outline")
  if (gaps.some((gap) => gap.includes("draft report") || gap.includes("report section"))) tools.push("report_lint")
  if (gaps.some((gap) => gap.includes("deliverables/final"))) tools.push("report_render")
  if (
    gaps.some(
      (gap) =>
        gap.includes("runtime-summary") ||
        gap.startsWith("runtime budget exhausted") ||
        gap.startsWith("runtime usage blind spot recorded"),
    )
  ) {
    tools.push("runtime_summary")
  }
  if (stage === "handoff") tools.push("operation_audit")
  return unique(tools)
}

async function stageGateGaps(
  worktree: string,
  status: OperationStatusSummary,
  stage: Stage,
  options: OperationStageGateOptions = {},
) {
  const gaps: string[] = []
  const reportableFindings = status.findings.byState.validated + status.findings.byState.report_ready
  const unresolvedFindings = status.findings.byState.candidate + status.findings.byState.needs_validation
  if (!status.operation) gaps.push("operation checkpoint is missing")
  if (!status.plans.operation) gaps.push("operation plan is missing")
  if (status.operation?.status === "blocked") {
    gaps.push(
      status.operation.blockers.length
        ? `operation is blocked: ${status.operation.blockers.join("; ")}`
        : "operation is blocked without recorded blockers",
    )
  }
  gaps.push(...runtimeHealthGaps(status))
  if (stage === "recon" && status.evidence.total === 0) gaps.push("recon has no recorded evidence")
  if (stage === "mapping") {
    if (status.evidence.total === 0) gaps.push("mapping has no recorded evidence")
    if (status.findings.total === 0) gaps.push("mapping has no candidate findings")
  }
  if (stage === "validation") {
    if (status.evidence.total === 0) gaps.push("validation has no recorded evidence")
    if (reportableFindings === 0) gaps.push("validation has no validated or report-ready findings")
    if (unresolvedFindings > 0) gaps.push("validation has unresolved candidate or needs-validation findings")
  }
  if (stage === "reporting") {
    if (reportableFindings === 0) gaps.push("reporting has no validated or report-ready findings")
    if (unresolvedFindings > 0) gaps.push("reporting has unresolved candidate or needs-validation findings")
    if (!status.reports.outline) gaps.push("reporting is missing report outline")
    if (!status.reports.markdown && !status.reports.html) gaps.push("reporting has no draft report")
  }
  if (stage === "handoff") {
    const finalHandoff = await lintReport(worktree, status.operationID, {
      requireReport: options.requireReport,
      minWords: options.minWords,
      requireOutlineBudget: options.requireOutlineBudget,
      minOutlineTargetPages: options.minOutlineTargetPages,
      minOutlineWordsPerPage: options.minOutlineWordsPerPage,
      requireOutlineSections: options.requireOutlineSections,
      minOutlineSectionWords: options.minOutlineSectionWords,
      minOutlineSectionWordsPerPage: options.minOutlineSectionWordsPerPage,
      requireFindingSections: options.requireFindingSections,
      minFindingWords: options.minFindingWords,
      minPdfPages: options.minPdfPages,
      finalHandoff: true,
    })
    gaps.push(...finalHandoff.gaps)
  }
  return gaps
}

export function formatOperationStageGate(gate: OperationStageGateResult) {
  return [
    `# Stage Gate ${gate.operationID}/${gate.stage}`,
    "",
    `status: ${gate.ok ? "ready" : "attention_required"}`,
    `root: ${gate.root}`,
    `generated_at: ${gate.generatedAt}`,
    "",
    "required_artifacts:",
    ...listLines(gate.requiredArtifacts, "none"),
    "",
    "gaps:",
    ...listLines(gate.gaps, "none"),
    "",
    "recommended_tools:",
    ...listLines(gate.recommendedTools, "none"),
    "",
  ].join("\n")
}

export async function buildOperationStageGate(
  worktree: string,
  operationID: string,
  options: OperationStageGateOptions = {},
): Promise<OperationStageGateResult> {
  const status = await readOperationStatus(worktree, operationID)
  const stage = options.stage ?? status.operation?.stage ?? "intake"
  const root = operationPath(worktree, operationID)
  if (stage === "validation") await promoteCoverageContractIfStructurallyReady(worktree, operationID, "met")
  if (stage === "handoff") await promoteCoverageContractIfStructurallyReady(worktree, operationID, "released")
  const gaps = await stageGateGaps(worktree, status, stage, options)
  const files = {
    json: path.join(root, "deliverables", "stage-gates", `${stage}.json`),
    markdown: path.join(root, "deliverables", "stage-gates", `${stage}.md`),
  }
  const gate: OperationStageGateResult = {
    operationID: slug(operationID, "operation"),
    root,
    generatedAt: new Date().toISOString(),
    stage,
    ok: gaps.length === 0,
    gaps,
    requiredArtifacts: stageRequiredArtifacts(stage),
    recommendedTools: stageGateToolRecommendations(stage, gaps),
    files,
  }
  await fs.mkdir(path.dirname(files.json), { recursive: true })
  await writeJson(files.json, gate)
  await fs.writeFile(files.markdown, formatOperationStageGate(gate))
  await publishOperationUpdated(worktree, { operationID: gate.operationID, artifact: "stage_gate", path: files.json })
  return gate
}

function runtimeSummaryMarkdown(record: RuntimeSummaryRecord) {
  const byModel = Object.entries(record.modelCalls?.byModel ?? {})
  const byAgent = Object.entries(record.usage?.byAgent ?? {})
  const tasks = record.backgroundTasks ?? []
  return [
    `# Runtime Summary: ${record.operationID}`,
    "",
    `- generated: ${record.generatedAt}`,
    `- stage: ${record.operation?.stage ?? "unknown"}`,
    `- status: ${record.operation?.status ?? "unknown"}`,
    `- model_calls_total: ${record.modelCalls?.total ?? 0}`,
    `- tokens_total: ${record.usage?.totalTokens ?? 0}`,
    `- cost_usd: ${record.usage?.costUSD ?? 0}`,
    `- budget_usd: ${record.usage?.budgetUSD ?? "not set"}`,
    `- remaining_usd: ${record.usage?.remainingUSD ?? "not set"}`,
    `- compactions: ${record.compaction?.count ?? 0}`,
    `- compaction_pressure: ${record.compaction?.pressure ?? "low"}`,
    `- fetches_total: ${record.fetches?.total ?? 0}`,
    "",
    "## Current Summary",
    record.operation?.summary ?? "No operation summary recorded.",
    "",
    "## Next Actions",
    ...(record.operation?.nextActions?.length
      ? record.operation.nextActions.map((item) => `- ${item}`)
      : ["- none recorded"]),
    "",
    "## Blockers",
    ...(record.operation?.blockers?.length
      ? record.operation.blockers.map((item) => `- ${item}`)
      : ["- none recorded"]),
    "",
    "## Background Tasks",
    ...(tasks.length
      ? tasks.map(
          (task) =>
            `- ${task.id}: ${task.status}${task.agent ? ` (${task.agent})` : ""} - ${task.summary ?? ""}${
              task.restartArgs ? `; restart_args: ${JSON.stringify(task.restartArgs)}` : ""
            }`,
        )
      : ["- none recorded"]),
    "",
    "## Model Split",
    ...(byModel.length ? byModel.map(([model, count]) => `- ${model}: ${count}`) : ["- none recorded"]),
    "",
    "## Token And Cost Split",
    `- input_tokens: ${record.usage?.inputTokens ?? 0}`,
    `- output_tokens: ${record.usage?.outputTokens ?? 0}`,
    `- reasoning_tokens: ${record.usage?.reasoningTokens ?? 0}`,
    `- cache_read_tokens: ${record.usage?.cacheReadTokens ?? 0}`,
    `- cache_write_tokens: ${record.usage?.cacheWriteTokens ?? 0}`,
    ...(byAgent.length
      ? byAgent.map(
          ([agent, usage]) =>
            `- ${agent}: ${usage.calls ?? 0} calls, ${usage.totalTokens ?? 0} tokens, $${usage.costUSD ?? 0}`,
        )
      : ["- agent split: none recorded"]),
    "",
    "## Repeated Fetch Targets",
    ...(record.fetches?.repeatedTargets?.length
      ? record.fetches.repeatedTargets.map((target) => `- ${target}`)
      : ["- none recorded"]),
    "",
    "## Notes",
    ...(record.notes?.length ? record.notes.map((note) => `- ${note}`) : ["- none recorded"]),
    "",
    "## Artifact Paths",
    `- status: ${record.artifacts.status}`,
    `- events: ${record.artifacts.events}`,
    `- findings: ${record.artifacts.findings}`,
    `- final: ${record.artifacts.final}`,
    "",
  ].join("\n")
}

function operationPlanMarkdown(record: OperationPlanRecord) {
  return [
    `# Operation Plan: ${record.operationID}`,
    "",
    `- written: ${record.writtenAt}`,
    `- objective: ${record.objective ?? "unknown"}`,
    `- template: ${record.templateName ?? "custom"}`,
    `- trust_level: ${record.trustLevel ?? "moderate"}`,
    `- scan_profile: ${record.scanProfile ?? "balanced"}`,
    `- scope_rules: ${record.scopeRules?.length ? record.scopeRules.join(" | ") : "none"}`,
    `- browser_evidence: ${record.browserEvidence ?? false}`,
    `- operation_memory: ${record.operationMemory ?? false}`,
    `- report_design_profile: ${record.reportDesignProfile ?? "standard"}`,
    `- credential_targets: ${record.credentialTargets?.length ? record.credentialTargets.join(", ") : "none"}`,
    record.planningApproval
      ? `- planning_approval: ${record.planningApproval.status}${record.planningApproval.approver ? ` by ${record.planningApproval.approver}` : ""}`
      : undefined,
    record.timeBudget ? `- target_hours: ${record.timeBudget.targetHours}` : undefined,
    record.timeBudget?.finalizationWindowHours
      ? `- finalization_window_hours: ${record.timeBudget.finalizationWindowHours}`
      : undefined,
    record.timeBudget?.durationFit ? `- duration_fit_confidence: ${record.timeBudget.durationFit.confidence}` : undefined,
    "",
    "## Assumptions",
    ...(record.assumptions?.length ? record.assumptions.map((item) => `- ${item}`) : ["- none recorded"]),
    ...(record.discoveryCharter
      ? [
          "",
          "## Discovery Charter Investment Strategy",
          "",
          record.discoveryCharter.purpose,
          "",
          "Research Questions:",
          ...record.discoveryCharter.researchQuestions.map((item) => `- ${item}`),
          "",
          "Recon Investments:",
          ...record.discoveryCharter.reconInvestments.map((item) => `- ${item}`),
          "",
          "Operator Questions:",
          ...record.discoveryCharter.operatorQuestions.map((item) => `- ${item}`),
          "",
          "Candidate Deep Work Lanes:",
          ...record.discoveryCharter.candidateDeepWorkLanes.map((item) => `- ${item}`),
          "",
          "Decision Criteria For Full Plan:",
          ...record.discoveryCharter.decisionCriteriaForFullPlan.map((item) => `- ${item}`),
        ]
      : []),
    ...(record.timeBudget
      ? [
          "",
          "## Time Budget",
          ...record.timeBudget.allocations.map((item) => `- ${item.stage}: ${item.hours}h - ${item.work}`),
          ...(record.timeBudget.executionBlocks?.length
            ? [
                "",
                "### Execution Blocks",
                "",
                ...record.timeBudget.executionBlocks.flatMap((block, index) => [
                  `#### ${block.id ?? `block-${index + 1}`}: ${block.title}`,
                  "",
                  `- stage: ${block.stage}`,
                  `- lane_id: ${block.laneID}`,
                  `- starts_at_minute: ${block.startMinute}`,
                  `- duration_minutes: ${block.durationMinutes}`,
                  `- objective: ${block.objective}`,
                  `- subagents: ${block.subagents.length ? block.subagents.join(", ") : "none"}`,
                  `- expected_artifacts: ${block.expectedArtifacts?.length ? block.expectedArtifacts.join(", ") : "none recorded"}`,
                  "- actions:",
                  ...block.actions.map((item) => `  - ${item}`),
                  "- success_criteria:",
                  ...block.successCriteria.map((item) => `  - ${item}`),
                  "- fallback_work:",
                  ...block.fallbackWork.map((item) => `  - ${item}`),
                  "",
                ]),
              ]
            : []),
          ...(record.timeBudget.durationFit
            ? [
                "",
                "Duration Fit Evidence:",
                ...record.timeBudget.durationFit.evidence.map((item) => `- ${item}`),
                "",
                "Overflow Backlog:",
                ...record.timeBudget.durationFit.overflowBacklog.map((item) => `- ${item}`),
              ]
            : []),
        ]
      : []),
    ...(record.coverageContract
      ? [
          "",
          "## Coverage Contract",
          `- status: ${record.coverageContract.status ?? "unmet"}`,
          "",
          "Goals:",
          ...record.coverageContract.goals.map((item) => `- ${item}`),
          "",
          "Minimum Evidence:",
          ...record.coverageContract.minimumEvidence.map((item) => `- ${item}`),
          "",
          "Required Lanes:",
          ...record.coverageContract.requiredLanes.map((item) => `- ${item}`),
          "",
          "Fallback Rules:",
          ...record.coverageContract.fallbackRules.map((item) => `- ${item}`),
          "",
          "Retry Rules:",
          ...record.coverageContract.retryRules.map((item) => `- ${item}`),
          "",
          "Subagent Opportunities:",
          ...record.coverageContract.subagentOpportunities.map((item) => `- ${item}`),
          "",
          "Report Gates:",
          ...record.coverageContract.reportGates.map((item) => `- ${item}`),
        ]
      : []),
    "",
    "## Execution Order",
    ...record.phases.flatMap((phase, index) => [
      "",
      `### ${index + 1}. ${phase.stage}`,
      "",
      phase.objective,
      "",
      "Actions:",
      ...phase.actions.map((item) => `- ${item}`),
      "",
      "Success Criteria:",
      ...phase.successCriteria.map((item) => `- ${item}`),
      "",
      "Subagents:",
      ...(phase.subagents.length ? phase.subagents.map((item) => `- ${item}`) : ["- none"]),
      "",
      "No Subagents:",
      ...(phase.noSubagents.length ? phase.noSubagents.map((item) => `- ${item}`) : ["- none recorded"]),
    ]),
    "",
    "## Reporting Closeout",
    ...record.reportingCloseout.map((item) => `- ${item}`),
    "",
  ].join("\n")
}

function operationDiscoveryCharterMarkdown(record: OperationPlanRecord) {
  const approval = record.planningApproval?.status ?? "pending"
  const nextStep =
    approval === "approved"
      ? "- Discovery Charter approved. Run bounded discovery, then write the full duration-aware operation_plan once duration-fit is defensible."
      : approval === "rejected"
        ? "- Discovery Charter rejected. Revise scope, safety, or investment strategy before any broad discovery."
        : "- Wait for explicit Discovery Charter approval before writing the full duration-aware operation_plan."
  return [
    `# Discovery Charter: ${record.operationID}`,
    "",
    `- written: ${record.writtenAt}`,
    `- objective: ${record.objective ?? "unknown"}`,
    `- template: ${record.templateName ?? "custom"}`,
    `- trust_level: ${record.trustLevel ?? "moderate"}`,
    `- scan_profile: ${record.scanProfile ?? "balanced"}`,
    `- browser_evidence: ${record.browserEvidence ?? false}`,
    `- operation_memory: ${record.operationMemory ?? false}`,
    `- report_design_profile: ${record.reportDesignProfile ?? "standard"}`,
    `- planning_approval: ${record.planningApproval?.status ?? "pending"}`,
    "",
    "## Assumptions",
    ...(record.assumptions?.length ? record.assumptions.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Investment Strategy",
    "",
    record.discoveryCharter?.purpose ?? "No purpose recorded.",
    "",
    "Research Questions:",
    ...(record.discoveryCharter?.researchQuestions ?? []).map((item) => `- ${item}`),
    "",
    "Recon Investments:",
    ...(record.discoveryCharter?.reconInvestments ?? []).map((item) => `- ${item}`),
    "",
    "Operator Questions:",
    ...(record.discoveryCharter?.operatorQuestions ?? []).map((item) => `- ${item}`),
    "",
    "Candidate Deep Work Lanes:",
    ...(record.discoveryCharter?.candidateDeepWorkLanes ?? []).map((item) => `- ${item}`),
    "",
    "Decision Criteria For Full Plan:",
    ...(record.discoveryCharter?.decisionCriteriaForFullPlan ?? []).map((item) => `- ${item}`),
    "",
    "## Next Step",
    nextStep,
    "",
  ].join("\n")
}

function districtProfileMarkdown(input: DistrictProfileInput) {
  return [
    `# District Profile: ${input.name}`,
    "",
    "## Domains",
    ...(input.domains?.length ? input.domains.map((domain) => `- ${domain}`) : ["- none recorded"]),
    "",
    "## Systems",
    ...(input.systems?.length
      ? input.systems.map(
          (system) =>
            `- ${system.name} (${system.category}) - source: ${system.source}${system.notes ? ` - ${system.notes}` : ""}`,
        )
      : ["- none recorded"]),
    "",
    "## Departments",
    ...(input.departments?.length
      ? input.departments.map(
          (department) =>
            `- ${department.name} - source: ${department.source}${department.notes ? ` - ${department.notes}` : ""}`,
        )
      : ["- none recorded"]),
    "",
    "## Notes",
    ...(input.notes?.length ? input.notes.map((note) => `- ${note}`) : ["- none recorded"]),
    "",
  ].join("\n")
}

function personProfileMarkdown(input: PersonProfileInput) {
  return [
    `# Person Profile: ${input.name}`,
    "",
    `- role: ${input.role}`,
    `- organization: ${input.organization ?? "unknown"}`,
    `- category: ${input.roleCategory}`,
    "",
    "## Pentest Relevance",
    input.whyTheyMatter,
    "",
    "## Likely Access Or Workflow Influence",
    ...(input.likelyAccess.length ? input.likelyAccess.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
    "## Public District Contacts",
    ...(input.publicContacts?.length
      ? input.publicContacts.map((contact) => `- ${contact.type}: ${contact.value} - source: ${contact.source}`)
      : ["- none recorded"]),
    "",
    "## Sources",
    ...input.sources.map(
      (source) =>
        `- ${source.title}${source.url ? ` (${source.url})` : source.path ? ` (${source.path})` : ""}: ${source.summary}`,
    ),
    "",
    "## Safe Validation Ideas",
    ...(input.validationIdeas?.length ? input.validationIdeas.map((idea) => `- ${idea}`) : ["- none recorded"]),
    "",
    "## Excluded Private/Irrelevant Information",
    ...(input.excludedPrivateInfo?.length ? input.excludedPrivateInfo.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
  ].join("\n")
}

function identityGraphMarkdown(input: IdentityGraphInput) {
  return [
    "# Identity Graph",
    "",
    "## Nodes",
    ...input.nodes.map(
      (node) => `- ${node.id} [${node.kind}]: ${node.label}${node.source ? ` - source: ${node.source}` : ""}`,
    ),
    "",
    "## Edges",
    ...input.edges.map(
      (edge) =>
        `- ${edge.from} -> ${edge.to}: ${edge.relationship}${edge.confidence ? ` (${edge.confidence})` : ""}${edge.evidence?.length ? ` - evidence: ${edge.evidence.join(", ")}` : ""}`,
    ),
    "",
    "## Notes",
    ...(input.notes?.length ? input.notes.map((note) => `- ${note}`) : ["- none recorded"]),
    "",
  ].join("\n")
}

function containsPrivateDossierDetail(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsPrivateDossierDetail(item))
  if (typeof value === "string") {
    return value.split(/\r?\n/).some((line) => {
      if (isSafetyBoundaryLanguage(line)) return false
      return /\b(home address|personal phone|spouse|children|private life|family information|unrelated personal social media|social media gossip)\b/i.test(
        line,
      )
    })
  }
  if (!value || typeof value !== "object") return false
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (key === "excludedPrivateInfo") return false
    return containsPrivateDossierDetail(entry)
  })
}

function isSafetyBoundaryLanguage(value: string) {
  return /\b(?:do not|don't|did not|does not|must not|should not|avoid|without|stop condition|non-destructive|never|no destructive|no live|no student records|no restricted|no sensitive|no raw|no secret|no persistence|not about|not claim|not performed|not execute|not accessed|not used|was not|were not|does not include|boundary|excluded|excludes|absent|synthetic|lab-only|lab evidence|supplied evidence|could|would|may|risk|remediation|affected assets)\b/i.test(
    value,
  )
}

function containsDestructiveExploitClaim(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsDestructiveExploitClaim(item))
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .some((line) => {
        if (isSafetyBoundaryLanguage(line)) return false
        return (
          /(?:ran the exploit against production|triggered account takeover|changed grades|modified grades|destructive exploit|drop table|delete records|wipe|ransomware)/i.test(
            line,
          ) ||
          /(?:dumped|downloaded|exfiltrated|exported|copied)[\s\S]{0,140}(?:student records|guardian data|sis database|gradebook|payroll|iep|504 records|bulk roster)(?:[\s\S]{0,140}(?:to prove impact|for proof|as proof|into the report|deliverables\/final))?/i.test(
            line,
          ) ||
          /(?:dump|download|exfiltrate|export|copy)[\s\S]{0,140}(?:student records|guardian data|sis database|gradebook|payroll|iep|504 records|bulk roster)[\s\S]{0,140}(?:to prove impact|for proof|as proof|into the report|deliverables\/final)/i.test(
            line,
          ) ||
          /(?:created|added|installed|uploaded|dropped|left)[\s\S]{0,120}(?:backdoor|persistence|web shell|reverse shell|new admin user|ssh key|cron persistence|startup item)/i.test(
            line,
          )
        )
      })
  }
  if (!value || typeof value !== "object") return false
  return Object.values(value as Record<string, unknown>).some((entry) => containsDestructiveExploitClaim(entry))
}

function containsUnprofessionalReportTone(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsUnprofessionalReportTone(item))
  if (typeof value === "string") {
    return value.split(/\r?\n/).some((line) => {
      return /\b(?:vibes|cursed timeline|gross|boo,|the whole damn point|fluorescent lighting and bad coffee|shopping cart|raccoon in a trench coat)\b/i.test(
        line,
      )
    })
  }
  if (!value || typeof value !== "object") return false
  return Object.values(value as Record<string, unknown>).some((entry) => containsUnprofessionalReportTone(entry))
}

function containsReportPaddingPlaceholder(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsReportPaddingPlaceholder(item))
  if (typeof value === "string") {
    return value.split(/\r?\n/).some((line) => {
      return (
        /\breserved\s+(?:render|board packet)\s+page\b/i.test(line) ||
        /\bsynthetic rehearsal placeholder\b/i.test(line) ||
        /\breserved for future authorized evidence expansion\b/i.test(line) ||
        /<div\b[^>]*\bmin-height\s*:\s*10in[^>]*\bpage-break-after\s*:/i.test(line)
      )
    })
  }
  if (!value || typeof value !== "object") return false
  return Object.values(value as Record<string, unknown>).some((entry) => containsReportPaddingPlaceholder(entry))
}

function assertFinalReportArtifactSafe(label: string, value: unknown) {
  if (containsRawCredentialSecret(value)) throw new Error(`${label} contains raw credential secrets`)
  if (containsPrivateDossierDetail(value)) throw new Error(`${label} contains private-life dossier details`)
  if (containsDestructiveExploitClaim(value)) {
    throw new Error(`${label} contains destructive exploit execution claims`)
  }
}

function finalReportArtifactSafetyReasons(value: unknown) {
  const reasons: string[] = []
  if (containsRawCredentialSecret(value)) reasons.push("raw credential secrets")
  if (containsPrivateDossierDetail(value)) reasons.push("private-life dossier details")
  if (containsDestructiveExploitClaim(value)) reasons.push("destructive exploit execution claims")
  return reasons
}

function sanitizedFinalArtifact(label: string, value: unknown, entries: InternalReviewEntry[], location = label): unknown {
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line, index) => {
        const reasons = finalReportArtifactSafetyReasons(line)
        if (!reasons.length) return line
        entries.push({ artifact: label, location: `${location}:${index + 1}`, reasons, content: line })
        return "[withheld for ULMCode internal CEH review]"
      })
      .join("\n")
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizedFinalArtifact(label, item, entries, `${location}[${index}]`))
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizedFinalArtifact(label, entry, entries, `${location}.${key}`),
      ]),
    )
  }
  return value
}

function internalSensitiveReviewMarkdown(operationID: string, entries: InternalReviewEntry[]) {
  if (!entries.length) {
    return [
      "# ULMCode Internal CEH Sensitive Review",
      "",
      `Operation: ${operationID}`,
      "",
      "No final-report content required internal quarantine during the latest render.",
      "",
    ].join("\n")
  }
  return [
    "# ULMCode Internal CEH Sensitive Review",
    "",
    `Operation: ${operationID}`,
    "",
    "This file is internal-only. It preserves lines withheld from final stakeholder deliverables so CEH reviewers can evaluate leads, credential references, and unsafe claims without leaking them into the final report package.",
    "",
    ...entries.flatMap((entry, index) => [
      `## ${index + 1}. ${entry.artifact}`,
      "",
      `- location: ${entry.location}`,
      `- reasons: ${entry.reasons.join(", ")}`,
      "",
      "```text",
      entry.content,
      "```",
      "",
    ]),
  ].join("\n")
}

function finalReportArtifactSafetyGaps(label: string, value: unknown) {
  const gaps: string[] = []
  if (containsRawCredentialSecret(value)) gaps.push(`${label} contains raw credential secrets`)
  if (containsPrivateDossierDetail(value)) gaps.push(`${label} contains private-life dossier details`)
  if (containsDestructiveExploitClaim(value)) gaps.push(`${label} contains destructive exploit execution claims`)
  return gaps
}

export function validateOperationPlan(input: OperationPlanInput) {
  const gaps: string[] = []
  if (input.phases.length === 0) gaps.push("operation plan requires at least one phase")
  input.phases.forEach((phase, index) => {
    const label = `phase ${index + 1}`
    if (phase.actions.length === 0) gaps.push(`${label} requires at least one action`)
    if (phase.successCriteria.length === 0) gaps.push(`${label} requires at least one success criterion`)
    if (phase.subagents.length === 0 && phase.noSubagents.length === 0) {
      gaps.push(`${label} must state subagent use or no-subagent policy`)
    }
  })
  const closeout = input.reportingCloseout.join("\n")
  if (!closeout) gaps.push("operation plan requires reporting closeout steps")
  for (const required of ["report_lint", "report_render", "runtime_summary"]) {
    if (!closeout.includes(required)) gaps.push(`reporting closeout must include ${required}`)
  }
  const targetHours = input.timeBudget?.targetHours
  if (targetHours !== undefined) {
    if (!Number.isFinite(targetHours) || targetHours <= 0) gaps.push("timeBudget.targetHours must be a positive number")
    for (const allocation of input.timeBudget?.allocations ?? []) {
      if (!Number.isFinite(allocation.hours) || allocation.hours <= 0) {
        gaps.push(`${allocation.stage}: time budget allocation hours must be positive`)
      }
      if (!allocation.work.trim()) gaps.push(`${allocation.stage}: time budget allocation work is required`)
    }
  }
  if ((targetHours ?? 0) >= 2) {
    if (input.planningApproval?.status !== "approved") {
      gaps.push("2h+ operation plan requires planningApproval.status=approved")
    }
    if (!input.planningApproval?.discoveryCharterPath) gaps.push("2h+ operation plan requires planningApproval.discoveryCharterPath")
    const discoveryCharter = input.discoveryCharter
    if (!discoveryCharter) {
      gaps.push("2h+ operation plan requires discoveryCharter investment strategy")
    } else {
      if (!discoveryCharter.purpose.trim()) gaps.push("2h+ operation plan requires discoveryCharter.purpose")
      if (!discoveryCharter.researchQuestions.length) gaps.push("2h+ operation plan requires discoveryCharter.researchQuestions")
      if (!discoveryCharter.reconInvestments.length) gaps.push("2h+ operation plan requires discoveryCharter.reconInvestments")
      if (!discoveryCharter.operatorQuestions.length) gaps.push("2h+ operation plan requires discoveryCharter.operatorQuestions")
      if (!discoveryCharter.candidateDeepWorkLanes.length) gaps.push("2h+ operation plan requires discoveryCharter.candidateDeepWorkLanes")
      if (!discoveryCharter.decisionCriteriaForFullPlan.length) gaps.push("2h+ operation plan requires discoveryCharter.decisionCriteriaForFullPlan")
    }
    if (!input.timeBudget?.allocations.length) gaps.push("2h+ operation plan requires timeBudget.allocations")
    if (!input.timeBudget?.finalizationWindowHours) gaps.push("2h+ operation plan requires timeBudget.finalizationWindowHours")
    const finalizationHours = input.timeBudget?.finalizationWindowHours ?? 0
    const plannedExecutionHours = Math.max(0, (targetHours ?? 0) - finalizationHours)
    const allocationHours = input.timeBudget?.allocations.reduce((sum, allocation) => sum + allocation.hours, 0) ?? 0
    if (Number.isFinite(targetHours) && allocationHours + 0.05 < plannedExecutionHours) {
      gaps.push("2h+ operation plan timeBudget.allocations must cover non-finalization targetHours")
    }
    if (input.timeBudget?.durationFit?.confidence !== "duration_sized") {
      gaps.push("2h+ operation plan requires timeBudget.durationFit.confidence=duration_sized")
    }
    if ((input.timeBudget?.durationFit?.evidence.length ?? 0) < 1) {
      gaps.push("2h+ operation plan requires timeBudget.durationFit.evidence")
    }
    if ((input.timeBudget?.durationFit?.overflowBacklog.length ?? 0) < 1) {
      gaps.push("2h+ operation plan requires timeBudget.durationFit.overflowBacklog")
    }
    const coverage = input.coverageContract
    if (!coverage) {
      gaps.push("2h+ operation plan requires coverageContract")
    } else {
      if (!coverage.goals.length) gaps.push("coverageContract.goals required")
      if (!coverage.minimumEvidence.length) gaps.push("coverageContract.minimumEvidence required")
      if (!coverage.requiredLanes.length) gaps.push("coverageContract.requiredLanes required")
      if (!coverage.fallbackRules.length) gaps.push("coverageContract.fallbackRules required")
      if (!coverage.retryRules.length) gaps.push("coverageContract.retryRules required")
      if (!coverage.subagentOpportunities.length) gaps.push("coverageContract.subagentOpportunities required")
      if (!coverage.reportGates.length) gaps.push("coverageContract.reportGates required")
    }
    const hasReportingAllocation = input.timeBudget?.allocations.some(
      (allocation) => allocation.stage === "reporting" || allocation.stage === "handoff",
    )
    if (!hasReportingAllocation) gaps.push("2h+ operation plan requires reporting or handoff finalization allocation")
    const executionBlocks = input.timeBudget?.executionBlocks ?? []
    if (!executionBlocks.length) {
      gaps.push("2h+ operation plan requires timeBudget.executionBlocks")
    } else {
      const executionWindowMinutes = Math.max(0, Math.round(((targetHours ?? 0) - finalizationHours) * 60))
      const maxBlockMinutes = (targetHours ?? 0) >= 8 ? 60 : 30
      const minBlockMinutes = 15
      const requiredBlocks = Math.max(1, Math.ceil(executionWindowMinutes / maxBlockMinutes))
      const totalBlockMinutes = executionBlocks.reduce((sum, block) => sum + block.durationMinutes, 0)
      if (executionBlocks.length < requiredBlocks) {
        gaps.push(`2h+ operation plan requires at least ${requiredBlocks} execution blocks for the target duration`)
      }
      if (totalBlockMinutes < executionWindowMinutes) {
        gaps.push("2h+ operation plan executionBlocks must cover the non-finalization time budget")
      }
      executionBlocks.forEach((block, index) => {
        const label = block.id?.trim() || `execution block ${index + 1}`
        if (!block.laneID.trim()) gaps.push(`${label}: laneID is required`)
        if (!block.title.trim()) gaps.push(`${label}: title is required`)
        if (!Number.isFinite(block.startMinute) || block.startMinute < 0) gaps.push(`${label}: startMinute must be non-negative`)
        if (
          !Number.isFinite(block.durationMinutes) ||
          block.durationMinutes < minBlockMinutes ||
          block.durationMinutes > maxBlockMinutes
        ) {
          gaps.push(`${label}: durationMinutes must be between ${minBlockMinutes} and ${maxBlockMinutes}`)
        }
        if (!block.objective.trim()) gaps.push(`${label}: objective is required`)
        if (!block.actions.some((action) => action.trim())) gaps.push(`${label}: actions are required`)
        if (!block.successCriteria.some((criterion) => criterion.trim())) gaps.push(`${label}: successCriteria are required`)
        if (!block.fallbackWork.some((fallback) => fallback.trim())) gaps.push(`${label}: fallbackWork is required`)
      })
    }
  }
  return gaps
}

function coverageContractMarkdown(record: CoverageContractRecord) {
  return [
    `# Coverage Contract: ${record.operationID}`,
    "",
    `- written: ${record.writtenAt}`,
    `- status: ${record.status}`,
    "",
    "## Goals",
    ...record.goals.map((item) => `- ${item}`),
    "",
    "## Minimum Evidence",
    ...record.minimumEvidence.map((item) => `- ${item}`),
    "",
    "## Required Lanes",
    ...record.requiredLanes.map((item) => `- ${item}`),
    "",
    "## Allowed Skipped Lanes",
    ...(record.allowedSkippedLanes.length ? record.allowedSkippedLanes.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Fallback Rules",
    ...record.fallbackRules.map((item) => `- ${item}`),
    "",
    "## Retry Rules",
    ...record.retryRules.map((item) => `- ${item}`),
    "",
    "## Subagent Opportunities",
    ...record.subagentOpportunities.map((item) => `- ${item}`),
    "",
    "## Report Gates",
    ...record.reportGates.map((item) => `- ${item}`),
    "",
    "## Release Notes",
    ...(record.releaseNotes?.length ? record.releaseNotes.map((item) => `- ${item}`) : ["- none recorded"]),
    "",
  ].join("\n")
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function pdfText(input: string) {
  return input.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?")
}

function escapePdfString(input: string) {
  return pdfText(input).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
}

function wrapPdfLine(input: string, width = 86) {
  const words = pdfText(input).trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
  }
  if (line) lines.push(line)
  return lines.length ? lines : [""]
}

function decodeHtmlText(input: string) {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

function htmlToPdfLines(input: string) {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(input)?.[1] ?? input
  return decodeHtmlText(
    body
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<\/(h1|h2|h3|p|tr|table|section)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " "),
  )
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+\|\s*$/g, ""))
    .filter(Boolean)
}

type PdfBlock = {
  kind: "h1" | "h2" | "h3" | "p" | "li" | "table"
  text: string
}

function htmlToPdfBlocks(input: string) {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(input)?.[1] ?? input
  const prepared = body
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<h1[^>]*>/gi, "\n@@h1@@")
    .replace(/<h2[^>]*>/gi, "\n@@h2@@")
    .replace(/<h3[^>]*>/gi, "\n@@h3@@")
    .replace(/<p[^>]*>/gi, "\n@@p@@")
    .replace(/<li[^>]*>/gi, "\n@@li@@- ")
    .replace(/<tr[^>]*>/gi, "\n@@table@@")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(h1|h2|h3|p|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
  return prepared
    .split(/\r?\n/)
    .map((line): PdfBlock | undefined => {
      const match = /^@@(h1|h2|h3|p|li|table)@@(.*)$/.exec(line.trim())
      const kind = (match?.[1] ?? "p") as PdfBlock["kind"]
      const text = decodeHtmlText((match?.[2] ?? line).trim().replace(/\s+\|\s*$/g, ""))
      if (!text) return undefined
      return { kind, text }
    })
    .filter((block): block is PdfBlock => block !== undefined)
}

function pdfColor(kind: PdfBlock["kind"]) {
  if (kind === "h1") return "0.07 0.08 0.1 rg"
  if (kind === "h2" || kind === "h3") return "0.13 0.17 0.23 rg"
  if (kind === "table") return "0.20 0.22 0.28 rg"
  return "0.11 0.12 0.15 rg"
}

function pdfFont(kind: PdfBlock["kind"]) {
  if (kind === "h1") return { name: "F2", size: 24, width: 42, leading: 28, before: 18, after: 10 }
  if (kind === "h2") return { name: "F2", size: 15, width: 64, leading: 18, before: 18, after: 6 }
  if (kind === "h3") return { name: "F2", size: 12, width: 72, leading: 15, before: 12, after: 4 }
  if (kind === "li") return { name: "F1", size: 10, width: 82, leading: 13, before: 2, after: 2 }
  if (kind === "table") return { name: "F1", size: 8.5, width: 96, leading: 11, before: 3, after: 3 }
  return { name: "F1", size: 10.2, width: 86, leading: 13.5, before: 4, after: 5 }
}

function drawTextLine(input: { text: string; x: number; y: number; font: string; size: number; color: string }) {
  return [
    "BT",
    input.color,
    `/${input.font} ${input.size} Tf`,
    `${input.x} ${input.y.toFixed(2)} Td`,
    `(${escapePdfString(input.text)}) Tj`,
    "ET",
  ].join("\n")
}

function buildStyledPdf(input: {
  title: string
  operationID: string
  operation?: OperationRecord
  reportHtml: string
  minPages?: number
}) {
  const blocks = htmlToPdfBlocks(input.reportHtml)
  const pages: string[][] = [[]]
  const marginX = 54
  const pageTop = 744
  const pageBottom = 58
  let y = pageTop

  function current() {
    return pages[pages.length - 1]!
  }

  function newPage() {
    pages.push([])
    y = pageTop
  }

  function ensure(space: number) {
    if (y - space < pageBottom) newPage()
  }

  function drawHeader() {
    current().push("0.61 0.38 0.11 rg", `0 764 612 28 re f`, "0.98 0.97 0.94 rg", `54 772 504 8 re f`)
  }

  drawHeader()
  current().push(
    drawTextLine({
      text: input.title,
      x: marginX,
      y,
      font: "F2",
      size: 22,
      color: "0.07 0.08 0.1 rg",
    }),
  )
  y -= 30
  current().push(
    drawTextLine({
      text: `Operation ${input.operationID} | ${input.operation?.stage ?? "unknown"} / ${input.operation?.status ?? "unknown"}`,
      x: marginX,
      y,
      font: "F1",
      size: 10,
      color: "0.34 0.38 0.44 rg",
    }),
  )
  y -= 26

  for (const block of blocks) {
    const font = pdfFont(block.kind)
    const lines = wrapPdfLine(block.text, font.width)
    ensure(font.before + font.after + lines.length * font.leading + (block.kind === "h2" ? 10 : 0))
    y -= font.before
    if (block.kind === "h2") {
      current().push(
        "0.85 0.87 0.90 RG",
        `54 ${Math.max(pageBottom, y + 6).toFixed(2)} m 558 ${Math.max(pageBottom, y + 6).toFixed(2)} l S`,
      )
      y -= 8
    }
    if (block.kind === "table") {
      current().push(
        "0.96 0.91 0.84 rg",
        `54 ${(y - lines.length * font.leading - 2).toFixed(2)} 504 ${(lines.length * font.leading + 8).toFixed(2)} re f`,
      )
    }
    for (const line of lines) {
      current().push(
        drawTextLine({
          text: line,
          x: block.kind === "li" ? marginX + 10 : marginX,
          y,
          font: font.name,
          size: font.size,
          color: pdfColor(block.kind),
        }),
      )
      y -= font.leading
      ensure(font.leading + pageBottom)
      if (y === pageTop) drawHeader()
    }
    y -= font.after
  }

  while (input.minPages && pages.length < input.minPages) {
    newPage()
    drawHeader()
    current().push(
      drawTextLine({
        text: `${input.title} - continued`,
        x: marginX,
        y,
        font: "F2",
        size: 18,
        color: "0.07 0.08 0.1 rg",
      }),
    )
    y -= 30
    current().push(
      drawTextLine({
        text: "This page is reserved for audience-specific notes, approvals, and remediation tracking during handoff.",
        x: marginX,
        y,
        font: "F1",
        size: 11,
        color: "0.34 0.38 0.44 rg",
      }),
    )
  }

  const objects: string[] = []
  const pageIDs = pages.map((_, index) => 5 + index * 2)
  const contentIDs = pages.map((_, index) => 6 + index * 2)
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
  objects[2] = `<< /Type /Pages /Kids [${pageIDs.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  for (let index = 0; index < pages.length; index++) {
    const content = pages[index]!.join("\n")
    objects[pageIDs[index]!] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentIDs[index]} 0 R >>`
    objects[contentIDs[index]!] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  }

  let pdf = "%PDF-1.4\n% /ULMCodeRenderer (styled-html)\n"
  const offsets = [0]
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf)
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

function findingCounts(findings: FindingRecord[]) {
  return Object.fromEntries(
    FINDING_STATES.map((state) => [state, findings.filter((item) => item.state === state).length]),
  ) as Record<FindingState, number>
}

function buildPdf(input: {
  title: string
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
  reportHtml?: string
}) {
  const sourceLines = input.reportHtml
    ? htmlToPdfLines(input.reportHtml)
    : [
        input.title,
        `Operation: ${input.operationID}`,
        `Stage: ${input.operation?.stage ?? "unknown"} | Status: ${input.operation?.status ?? "unknown"}`,
        "",
        "Executive Summary",
        input.operation?.summary ?? "No operation summary has been recorded.",
        "",
        "Scope And Methodology",
        input.operation?.objective ?? "No objective has been recorded.",
        "",
        "Findings",
        ...(input.reportable.length
          ? input.reportable.flatMap((finding) => [
              `${finding.severity.toUpperCase()}: ${finding.title}`,
              `ID: ${finding.findingID} | State: ${finding.state} | Confidence: ${finding.confidence}`,
              `Affected Assets: ${finding.affectedAssets.join(", ")}`,
              `Description: ${finding.description}`,
              `Impact: ${finding.impact ?? "Not recorded."}`,
              `Remediation: ${finding.remediation ?? "Not recorded."}`,
              `Evidence: ${finding.evidence.map((item) => item.path ?? item.id).join(", ")}`,
              "",
            ])
          : ["No validated or report-ready findings were recorded."]),
        "",
        "Evidence Index",
        ...(input.evidence.length
          ? input.evidence.flatMap((item) => [
              `${item.evidenceID}: ${item.title}`,
              `Kind: ${item.kind} | Path: ${item.path ?? "not recorded"}`,
              `Summary: ${item.summary}`,
              "",
            ])
          : ["No evidence records were recorded."]),
        "",
        "Non-Reportable Findings",
        ...(input.nonReportable.length
          ? input.nonReportable.flatMap((finding) => [
              `${finding.findingID}: ${finding.title}`,
              `State: ${finding.state} | Severity: ${finding.severity} | Confidence: ${finding.confidence}`,
              `Reason retained: not promoted to validated/report-ready state at handoff.`,
              "",
            ])
          : ["No rejected, candidate, or needs-validation findings were recorded."]),
      ]
  const lines = sourceLines.flatMap((line) => wrapPdfLine(line))

  const pages = Array.from({ length: Math.max(1, Math.ceil(lines.length / 44)) }, (_, index) =>
    lines.slice(index * 44, index * 44 + 44),
  )
  const pageIDs = pages.map((_, index) => 4 + index * 2)
  const contentIDs = pages.map((_, index) => 5 + index * 2)
  const objects: string[] = []
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"
  objects[2] = `<< /Type /Pages /Kids [${pageIDs.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

  for (let index = 0; index < pages.length; index++) {
    const pageID = pageIDs[index]!
    const contentID = contentIDs[index]!
    const content = [
      "BT",
      "/F1 10 Tf",
      "14 TL",
      "72 740 Td",
      ...pages[index]!.flatMap((line) => (line ? [`(${escapePdfString(line)}) Tj`, "T*"] : ["T*"])),
      "ET",
    ].join("\n")
    objects[pageID] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentID} 0 R >>`
    objects[contentID] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  }

  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf)
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

function finalReadme(input: {
  title: string
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
}) {
  return [
    `# ${input.title}`,
    "",
    `Operation: ${input.operationID}`,
    `Stage: ${input.operation?.stage ?? "unknown"}`,
    `Status: ${input.operation?.status ?? "unknown"}`,
    "",
    "## Files",
    "",
    "- `report.html`: browser-readable final report.",
    "- `report.pdf`: print-ready PDF report.",
    "- `findings.json`: machine-readable reportable and retained finding ledger.",
    "- `evidence-index.json`: machine-readable evidence map for claim review.",
    "- `operator-review.md`: operator handoff notes and unresolved review items.",
    "- `executive-summary.md`: board/client-ready executive summary.",
    "- `technical-appendix.md`: detailed evidence and validation appendix.",
    "- `board-report.md` / `board-report.pdf`: board-facing narrative and decision package.",
    "- `ceh-technical-report.md` / `ceh-technical-report.pdf`: technical report for CEH/security review.",
    "- `ulm-team-report.md` / `ulm-team-report.pdf`: internal ULMCode runbook, lessons, and harness notes.",
    "- `runtime-summary.md`: summarized runtime, budget, and background job state.",
    "- `manifest.json`: machine-readable artifact map and counts.",
    "- `README.md`: this handoff note.",
    "",
    "## Findings",
    "",
    ...(input.reportable.length
      ? input.reportable.map((finding) => `- ${finding.findingID}: ${finding.title} (${finding.severity})`)
      : ["- No validated or report-ready findings were recorded."]),
    "",
    "## Evidence",
    "",
    ...(input.evidence.length
      ? input.evidence.map((item) => `- ${item.evidenceID}: ${item.title}${item.path ? ` (${item.path})` : ""}`)
      : ["- No evidence records were recorded."]),
    "",
    "## Non-Reportable Findings",
    "",
    ...(input.nonReportable.length
      ? input.nonReportable.map((finding) => `- ${finding.findingID}: ${finding.title} (${finding.state})`)
      : ["- No rejected, candidate, or needs-validation findings were recorded."]),
    "",
    "## Source Artifacts",
    "",
    "See the parent operation folder for status, plans, evidence records, report outline, and runtime summary.",
    "",
  ].join("\n")
}

function finalFindingsJson(input: {
  operationID: string
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  counts: Record<FindingState, number>
}) {
  return {
    operationID: input.operationID,
    generatedAt: new Date().toISOString(),
    counts: input.counts,
    reportable: input.reportable,
    retained: input.nonReportable,
  }
}

function finalEvidenceIndexJson(input: { operationID: string; evidence: EvidenceRecord[]; findings: FindingRecord[] }) {
  return {
    operationID: input.operationID,
    generatedAt: new Date().toISOString(),
    evidence: input.evidence.map((item) => ({
      id: item.evidenceID,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      path: item.path,
      source: item.source,
      command: item.command,
      referencedBy: input.findings
        .filter((finding) =>
          finding.evidence.some((ref) => ref.id === item.evidenceID || (ref.path && ref.path === item.path)),
        )
        .map((finding) => finding.findingID),
    })),
  }
}

function executiveSummaryMarkdown(input: {
  title: string
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  evidence: EvidenceRecord[]
  counts: Record<FindingState, number>
}) {
  const highImpact = input.reportable.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high",
  )
  return [
    `# Executive Summary`,
    "",
    `Report: ${input.title}`,
    `Operation: ${input.operationID}`,
    `Stage: ${input.operation?.stage ?? "unknown"}`,
    `Status: ${input.operation?.status ?? "unknown"}`,
    "",
    "## Overview",
    "",
    input.operation?.summary ?? "No operation summary was recorded.",
    "",
    "## Key Numbers",
    "",
    `- reportable findings: ${input.reportable.length}`,
    `- critical/high findings: ${highImpact.length}`,
    `- evidence records: ${input.evidence.length}`,
    `- retained non-reportable findings: ${input.counts.candidate + input.counts.needs_validation + input.counts.rejected}`,
    "",
    "## Priority Items",
    "",
    ...(highImpact.length
      ? highImpact.map((finding) => `- ${finding.findingID}: ${finding.title} (${finding.severity})`)
      : ["- No critical or high report-ready findings were recorded."]),
    "",
  ].join("\n")
}

function technicalAppendixMarkdown(input: {
  operationID: string
  operation?: OperationRecord
  plan?: OperationPlanRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
}) {
  return [
    "# Technical Appendix",
    "",
    `Operation: ${input.operationID}`,
    "",
    "## Scope And Methodology",
    "",
    input.operation?.objective ?? "No operation objective was recorded.",
    "",
    "## Assumptions",
    "",
    ...(input.plan?.assumptions?.length
      ? input.plan.assumptions.map((item) => `- ${item}`)
      : ["- No assumptions recorded."]),
    "",
    "## Reportable Findings",
    "",
    ...(input.reportable.length
      ? input.reportable.flatMap((finding) => [
          `### ${finding.findingID}: ${finding.title}`,
          "",
          `- severity: ${finding.severity}`,
          `- confidence: ${finding.confidence}`,
          `- affected assets: ${finding.affectedAssets.join(", ")}`,
          `- evidence: ${finding.evidence.map((item) => item.path ?? item.id).join(", ")}`,
          "",
          finding.description,
          "",
        ])
      : ["No validated or report-ready findings were recorded.", ""]),
    "## Retained Non-Reportable Findings",
    "",
    ...(input.nonReportable.length
      ? input.nonReportable.map((finding) => `- ${finding.findingID}: ${finding.title} (${finding.state})`)
      : ["- None recorded."]),
    "",
    "## Evidence Index",
    "",
    ...(input.evidence.length
      ? input.evidence.map(
          (item) => `- ${item.evidenceID}: ${item.title} (${item.kind})${item.path ? ` - ${item.path}` : ""}`,
        )
      : ["- No evidence records were recorded."]),
    "",
  ].join("\n")
}

function boardReportMarkdown(input: {
  title: string
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  evidence: EvidenceRecord[]
  counts: Record<FindingState, number>
}) {
  const highImpact = input.reportable.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high",
  )
  return [
    "# Board Report",
    "",
    `Report: ${input.title}`,
    `Operation: ${input.operationID}`,
    "",
    "## Executive Decision Summary",
    "",
    input.operation?.summary ?? "No operation summary was recorded.",
    "",
    `The assessment produced ${input.reportable.length} validated/report-ready findings from ${input.evidence.length} evidence records. ${highImpact.length} findings are critical or high priority.`,
    "",
    "## Priority Risks",
    "",
    ...(highImpact.length
      ? highImpact.map((finding) => `- ${finding.title} (${finding.severity}): ${finding.impact ?? finding.description}`)
      : ["- No critical or high report-ready findings were recorded."]),
    "",
    "## Recommended Board Actions",
    "",
    "- Assign an accountable owner for each high-priority remediation item.",
    "- Require a dated remediation plan for privileged access, identity governance, vendor integrations, and audit gaps.",
    "- Track retest status against the evidence-backed findings rather than informal status updates.",
    "- Preserve the CEH technical report and evidence index for validation and remediation teams.",
    "",
    "## Current Finding State",
    "",
    `- candidate: ${input.counts.candidate}`,
    `- needs validation: ${input.counts.needs_validation}`,
    `- validated: ${input.counts.validated}`,
    `- report ready: ${input.counts.report_ready}`,
    `- rejected: ${input.counts.rejected}`,
    "",
  ].join("\n")
}

function cehTechnicalReportMarkdown(input: {
  operationID: string
  operation?: OperationRecord
  plan?: OperationPlanRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
}) {
  return [
    "# CEH Technical Report",
    "",
    `Operation: ${input.operationID}`,
    "",
    "## Scope And Methodology",
    "",
    input.operation?.objective ?? "No operation objective was recorded.",
    "",
    "## Plan And Assumptions",
    "",
    ...(input.plan?.assumptions?.length
      ? input.plan.assumptions.map((item) => `- ${item}`)
      : ["- No assumptions recorded."]),
    "",
    "## Validated Findings",
    "",
    ...(input.reportable.length
      ? input.reportable.flatMap((finding) => [
          `### ${finding.findingID}: ${finding.title}`,
          "",
          `- severity: ${finding.severity}`,
          `- confidence: ${finding.confidence}`,
          `- affected assets: ${finding.affectedAssets.join(", ")}`,
          `- evidence: ${finding.evidence.map((item) => item.path ?? item.id).join(", ")}`,
          "",
          finding.description,
          "",
          `Impact: ${finding.impact ?? "Not recorded."}`,
          "",
          `Remediation: ${finding.remediation ?? "Not recorded."}`,
          "",
        ])
      : ["No validated or report-ready findings were recorded.", ""]),
    "## Retained Leads And Rejections",
    "",
    ...(input.nonReportable.length
      ? input.nonReportable.map((finding) => `- ${finding.findingID}: ${finding.title} (${finding.state})`)
      : ["- None recorded."]),
    "",
    "## Evidence Map",
    "",
    ...(input.evidence.length
      ? input.evidence.map(
          (item) => `- ${item.evidenceID}: ${item.title} (${item.kind})${item.path ? ` - ${item.path}` : ""}`,
        )
      : ["- No evidence records were recorded."]),
    "",
  ].join("\n")
}

function ulmTeamReportMarkdown(input: {
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
  runtimeSummaryExists: boolean
  supervisorIncidents?: string[]
}) {
  return [
    "# ULMCode Team Report",
    "",
    `Operation: ${input.operationID}`,
    "",
    "## Harness Run State",
    "",
    `- stage: ${input.operation?.stage ?? "unknown"}`,
    `- status: ${input.operation?.status ?? "unknown"}`,
    `- reportable findings: ${input.reportable.length}`,
    `- retained non-reportable findings: ${input.nonReportable.length}`,
    `- evidence records: ${input.evidence.length}`,
    `- runtime summary present: ${input.runtimeSummaryExists ? "yes" : "no"}`,
    "",
    "## What To Review Internally",
    "",
    "- Confirm background lanes, command supervision, and report agents produced durable artifacts.",
    "- Compare model behavior against behavior-watch scenarios for broad search, secret hygiene, dossier scope, and report gates.",
    "- Preserve failed or skipped leads as harness feedback instead of hiding them from the run record.",
    "- Use this report with runtime-summary.md and operation-audit.md to improve the next unattended run.",
    "",
    "## Supervisor Incidents",
    "",
    ...(input.supervisorIncidents?.length ? input.supervisorIncidents.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
    "## Residual Harness Risks",
    "",
    ...(input.operation?.blockers?.length || input.supervisorIncidents?.length
      ? [...(input.operation?.blockers ?? []), ...(input.supervisorIncidents ?? [])].map((item) => `- ${item}`)
      : ["- None recorded."]),
    "",
  ].join("\n")
}

async function supervisorIncidentSummaries(root: string) {
  const dir = path.join(root, "supervisor")
  const entries = await fs.readdir(dir).catch(() => [])
  const incidents: string[] = []
  for (const entry of entries.filter((item) => item.startsWith("supervisor-review-") && item.endsWith(".json"))) {
    const review = await readJson<{ generatedAt?: string; reviewKind?: string; decisions?: Array<{ action?: string; reason?: string }> }>(
      path.join(dir, entry),
    )
    if (!review) continue
    for (const decision of review?.decisions ?? []) {
      if (!decision.action || decision.action === "continue" || decision.action === "handoff_ready" || decision.action === "release_handoff")
        continue
      incidents.push(`${review.generatedAt ?? "unknown"} ${review.reviewKind ?? "review"} ${decision.action}: ${decision.reason ?? "no reason"}`)
    }
  }
  return [...new Set(incidents)].slice(0, 50)
}

function audienceReportHtml(input: { title: string; markdown: string }) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title></head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  ${markdownReportToHtml(input.markdown)}
</body>
</html>`
}

function operatorReviewMarkdown(input: {
  operationID: string
  operation?: OperationRecord
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
  runtimeSummaryExists: boolean
}) {
  const needsReview = input.nonReportable.filter(
    (finding) => finding.state === "candidate" || finding.state === "needs_validation",
  )
  return [
    "# Operator Review",
    "",
    `Operation: ${input.operationID}`,
    "",
    "## Handoff State",
    "",
    `- stage: ${input.operation?.stage ?? "unknown"}`,
    `- status: ${input.operation?.status ?? "unknown"}`,
    `- reportable findings: ${input.reportable.length}`,
    `- evidence records: ${input.evidence.length}`,
    `- runtime summary present: ${input.runtimeSummaryExists ? "yes" : "no"}`,
    "",
    "## Blockers",
    "",
    ...(input.operation?.blockers?.length ? input.operation.blockers.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
    "## Review Before Client Delivery",
    "",
    ...(needsReview.length
      ? needsReview.map((finding) => `- ${finding.findingID}: ${finding.title} remains ${finding.state}`)
      : ["- No candidate or needs-validation findings remain."]),
    "",
    "## Next Actions",
    "",
    ...(input.operation?.nextActions?.length
      ? input.operation.nextActions.map((item) => `- ${item}`)
      : ["- None recorded."]),
    "",
  ].join("\n")
}

export async function writeOperationCheckpoint(worktree: string, input: OperationCheckpointInput) {
  if (containsRawCredentialSecret(input)) throw new Error("operation checkpoints must not contain raw credential secrets")
  const now = new Date().toISOString()
  const operationID = makeOperationID(input)
  const root = operationPath(worktree, operationID)
  const current = normalizeOperationRecord(await readJson<OperationRecord>(path.join(root, "operation.json")))
  const objective = input.objective ?? current?.objective ?? (await readOperationObjective(worktree, operationID))
  if (!objective) throw new Error("objective is required for a new operation checkpoint")
  const record: OperationRecord = {
    operationID,
    objective,
    stage: input.stage,
    status: input.status,
    summary: input.summary,
    nextActions: input.nextActions ?? [],
    blockers: input.blockers ?? [],
    riskLevel: input.riskLevel ?? "medium",
    activeTasks: input.activeTasks ?? [],
    evidence: input.evidence ?? [],
    notes: input.notes,
    time: {
      created: current?.time.created ?? now,
      updated: now,
    },
  }
  await writeJson(path.join(root, "operation.json"), record)
  await appendJsonl(path.join(root, "events.jsonl"), { type: "checkpoint", ...record })
  await fs.writeFile(path.join(root, "status.md"), statusMarkdown(record))
  await fs.mkdir(path.join(root, "evidence"), { recursive: true })
  await fs.mkdir(path.join(root, "findings"), { recursive: true })
  await fs.mkdir(path.join(root, "reports"), { recursive: true })
  await publishOperationUpdated(worktree, {
    operationID,
    artifact: "checkpoint",
    path: path.join(root, "operation.json"),
  })
  return { root, record }
}

export function validateFinding(input: FindingInput) {
  const gaps: string[] = []
  if (input.confidence < 0 || input.confidence > 1) gaps.push("confidence must be between 0 and 1")
  if (!input.affectedAssets.length) gaps.push("affectedAssets must contain at least one asset")
  if (["validated", "report_ready"].includes(input.state) && input.evidence.length === 0) {
    gaps.push(`${input.state} findings require at least one evidence reference`)
  }
  if (input.state === "report_ready" && !input.impact) gaps.push("report_ready findings require impact")
  if (input.state === "report_ready" && !input.remediation) gaps.push("report_ready findings require remediation")
  return gaps
}

const FINDING_OVERLAP_STOP_WORDS = new Set([
  "about",
  "across",
  "after",
  "also",
  "and",
  "are",
  "can",
  "could",
  "create",
  "creates",
  "from",
  "has",
  "have",
  "into",
  "not",
  "only",
  "risk",
  "risks",
  "that",
  "the",
  "this",
  "through",
  "with",
])

function findingTokenSet(value: string | undefined) {
  return new Set(
    (value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .map((token) => token.replace(/s$/, ""))
      .filter((token) => token.length >= 3 && !FINDING_OVERLAP_STOP_WORDS.has(token)),
  )
}

function normalizeFindingComparableID(value: string) {
  const lowered = value.toLowerCase().trim()
  const normalizedEvidence = lowered.match(/^normalized-text-(ev-[a-z0-9-]+)-txt$/)
  if (normalizedEvidence) return normalizedEvidence[1]!
  const evidenceFile = lowered.match(/(?:^|[/_-])(ev-[a-z0-9-]+)(?:\.(?:json|txt|md)|$)/)
  if (evidenceFile) return evidenceFile[1]!
  return lowered
    .replace(/^(?:app|application)[:/-]/, "application-")
    .replace(/^person[:/-]/, "person-")
    .replace(/^group[:/-]/, "group-")
    .replace(/^role[:/-]/, "role-")
    .replace(/^vendor[:/-]/, "vendor-")
    .replace(/^data[:/-]/, "data-")
    .replace(/^device[:/-]/, "device-")
    .replace(/^asset[:/-]/, "asset-")
    .replace(/^web[:/-]/, "web-")
    .replace(/^network[:/-]/, "network-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizedFindingSet(items: string[]) {
  return new Set(items.map(normalizeFindingComparableID).filter(Boolean))
}

function findingEvidenceSet(finding: FindingRecord) {
  return normalizedFindingSet(finding.evidence.flatMap((item) => [item.id, item.path ?? ""]))
}

function setJaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0
  const intersection = [...left].filter((item) => right.has(item)).length
  const union = new Set([...left, ...right]).size
  return union ? intersection / union : 0
}

function findingContentTokens(finding: FindingRecord) {
  return findingTokenSet(
    [
      finding.title,
      finding.description,
      finding.impact,
      finding.remediation,
      ...finding.affectedAssets,
      ...finding.evidence.map((item) => item.id),
    ]
      .filter(Boolean)
      .join(" "),
  )
}

function overlappingFindingGaps(findings: FindingRecord[]) {
  const reportable = findings.filter((item) => item.state === "report_ready" || item.state === "validated")
  const gaps: string[] = []
  for (let i = 0; i < reportable.length; i++) {
    for (let j = i + 1; j < reportable.length; j++) {
      const left = reportable[i]!
      const right = reportable[j]!
      const titleScore = setJaccard(findingTokenSet(left.title), findingTokenSet(right.title))
      const contentScore = setJaccard(findingContentTokens(left), findingContentTokens(right))
      const assetScore = setJaccard(normalizedFindingSet(left.affectedAssets), normalizedFindingSet(right.affectedAssets))
      const evidenceScore = setJaccard(findingEvidenceSet(left), findingEvidenceSet(right))
      const sameEvidenceAndAssets = evidenceScore >= 0.35 && assetScore >= 0.35 && contentScore >= 0.32
      const sameEvidenceAndTitle = evidenceScore >= 0.3 && titleScore >= 0.3 && contentScore >= 0.22
      if (sameEvidenceAndAssets || sameEvidenceAndTitle) {
        gaps.push(
          `${left.findingID} and ${right.findingID} appear overlapping; merge them or split the evidence, affected assets, and remediation into clearly separate report findings`,
        )
      }
    }
  }
  return gaps
}

export async function writeFinding(worktree: string, input: FindingInput) {
  if (containsRawCredentialSecret(input)) throw new Error("finding records must not contain raw credential secrets")
  const gaps = validateFinding(input)
  if (gaps.length) throw new Error(gaps.join("; "))

  const now = new Date().toISOString()
  const root = operationPath(worktree, input.operationID)
  const findingID = makeFindingID(input)
  const file = path.join(root, "findings", `${findingID}.json`)
  const current = await readJson<FindingRecord>(file)
  const record: FindingRecord = {
    ...input,
    findingID,
    time: {
      created: current?.time.created ?? now,
      updated: now,
    },
  }
  await writeJson(file, record)
  await appendJsonl(path.join(root, "findings.jsonl"), { type: "finding", ...record })
  await publishOperationUpdated(worktree, { operationID: input.operationID, artifact: "finding", path: file })
  return { root, record }
}

export async function readFindings(root: string) {
  let findings: FindingRecord[] = []
  try {
    const files = await fs.readdir(path.join(root, "findings"))
    findings = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map((file) => readJson<FindingRecord>(path.join(root, "findings", file))),
      )
    ).filter((item): item is FindingRecord => Boolean(item))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return findings
}

export async function readEvidenceRecords(root: string) {
  let records: EvidenceRecord[] = []
  try {
    const files = await fs.readdir(path.join(root, "evidence"))
    records = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map((file) => readJson<EvidenceRecord>(path.join(root, "evidence", file))),
      )
    ).filter((item): item is EvidenceRecord => Boolean(item))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return records
}

export async function writeEvidence(worktree: string, input: EvidenceInput): Promise<EvidenceWriteResult> {
  if (containsRawCredentialSecret(input)) throw new Error("evidence records must not contain raw credential secrets")
  const now = new Date().toISOString()
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const evidenceID = makeEvidenceID(input)
  const json = path.join(root, "evidence", `${evidenceID}.json`)
  const current = await readJson<EvidenceRecord>(json)
  const rawRelativePath = input.content === undefined ? undefined : path.join("evidence", "raw", `${evidenceID}.txt`)
  const rawPath = rawRelativePath ? path.join(root, rawRelativePath) : undefined
  const record: EvidenceRecord = {
    operationID,
    evidenceID,
    title: input.title,
    kind: input.kind,
    summary: input.summary,
    source: input.source,
    command: input.command,
    path: input.path ?? rawRelativePath,
    time: {
      created: current?.time.created ?? now,
      updated: now,
    },
  }
  if (rawPath) {
    await fs.mkdir(path.dirname(rawPath), { recursive: true })
    await fs.writeFile(rawPath, input.content ?? "")
  }
  await writeJson(json, record)
  await appendJsonl(path.join(root, "evidence.jsonl"), { type: "evidence", ...record })
  await publishOperationUpdated(worktree, { operationID, artifact: "evidence", path: json })
  return { operationID, evidenceID, json, rawPath, record }
}

async function readReportText(root: string) {
  for (const candidate of [
    path.join("reports", "report.md"),
    path.join("reports", "report.html"),
    path.join("deliverables", "final", "report.html"),
  ]) {
    try {
      return await fs.readFile(path.join(root, candidate), "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return undefined
}

async function readAuthoredReport(root: string) {
  for (const candidate of [
    { path: path.join("reports", "report.html"), format: "html" as const },
    { path: path.join("reports", "report.md"), format: "markdown" as const },
  ]) {
    try {
      return {
        format: candidate.format,
        content: await fs.readFile(path.join(root, candidate.path), "utf8"),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return undefined
}

function markdownInline(input: string) {
  return escapeHtml(input)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
}

function authoredSectionClass(title: string) {
  const normalized = normalizeSectionTitle(title)
  if (normalized.includes("executive summary")) return "authored-executive-summary"
  if (normalized.includes("methodology") || normalized.includes("scope")) return "authored-methodology"
  if (normalized.includes("environment")) return "authored-environment"
  if (normalized.includes("attack path")) return "authored-attack-path"
  if (normalized.includes("finding")) return "authored-findings-detail"
  if (normalized.includes("roadmap") || normalized.includes("risk register")) return "authored-roadmap"
  if (normalized.includes("coverage") || normalized.includes("testing limits")) return "authored-coverage"
  if (normalized.includes("validation") || normalized.includes("known unknowns")) return "authored-validation-limits"
  if (normalized.includes("evidence")) return "authored-evidence-map"
  if (normalized.includes("handoff")) return "authored-handoff"
  if (normalized.includes("appendix")) return "authored-appendix"
  return "authored-general"
}

function authoredCardForSection(sectionTitle: string) {
  const normalized = normalizeSectionTitle(sectionTitle)
  if (normalized.includes("finding")) return { open: '<section class="finding authored-finding">', close: "</section>" }
  if (normalized.includes("roadmap") || normalized.includes("risk register")) {
    return { open: '<article class="roadmap-card authored-roadmap-card">', close: "</article>" }
  }
  if (normalized.includes("validation") || normalized.includes("known unknowns")) {
    return { open: '<article class="validation-card authored-validation-card">', close: "</article>" }
  }
  if (normalized.includes("evidence") || normalized.includes("appendix")) {
    return { open: '<article class="evidence-card authored-evidence-card">', close: "</article>" }
  }
  return undefined
}

function markdownReportToHtml(input: string) {
  const blocks: string[] = []
  let paragraph: string[] = []
  let sectionOpen = false
  let sectionTitle = ""
  let cardClose: string | undefined
  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(`<p>${markdownInline(paragraph.join(" "))}</p>`)
    paragraph = []
  }
  const closeCard = () => {
    if (!cardClose) return
    blocks.push(cardClose)
    cardClose = undefined
  }
  const closeSection = () => {
    closeCard()
    if (!sectionOpen) return
    blocks.push("</section>")
    sectionOpen = false
    sectionTitle = ""
  }
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      const level = Math.min(3, heading[1]!.length)
      const title = heading[2]!
      if (level === 1) {
        closeSection()
        blocks.push(`<h1>${markdownInline(title)}</h1>`)
        continue
      }
      if (level === 2) {
        closeSection()
        sectionOpen = true
        sectionTitle = title
        blocks.push(`<section class="report-section authored-section ${authoredSectionClass(title)}">`)
        blocks.push(`<h2>${markdownInline(title)}</h2>`)
        continue
      }
      const card = authoredCardForSection(sectionTitle)
      if (card) {
        closeCard()
        blocks.push(card.open)
        blocks.push(`<h3>${markdownInline(title)}</h3>`)
        cardClose = card.close
        continue
      }
      blocks.push(`<h${level}>${markdownInline(title)}</h${level}>`)
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  closeSection()
  return blocks.join("\n")
}

function authoredReportBody(input: { format: "html" | "markdown"; content: string }) {
  if (input.format === "markdown") return markdownReportToHtml(input.content)
  return /<body[^>]*>([\s\S]*?)<\/body>/i.exec(input.content)?.[1] ?? input.content
}

function markdownHeadingPattern(value: string) {
  return new RegExp(`^#{1,6}\\s+.*${escapeRegExp(value)}.*$`, "im")
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function plainReportText(report: string) {
  return report
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function reportSectionForFinding(report: string, finding: FindingRecord) {
  const heading =
    markdownHeadingPattern(finding.findingID).exec(report) ?? markdownHeadingPattern(finding.title).exec(report)
  if (heading?.index !== undefined) {
    const bodyStart = heading.index + heading[0].length
    const rest = report.slice(bodyStart)
    const nextHeading = /\n#{1,6}\s+\S/.exec(rest)
    return plainReportText(nextHeading ? rest.slice(0, nextHeading.index) : rest)
  }

  const lower = report.toLowerCase()
  const titleIndex = lower.indexOf(finding.title.toLowerCase())
  const idIndex = lower.indexOf(finding.findingID.toLowerCase())
  const anchors = [titleIndex, idIndex].filter((index) => index >= 0)
  if (!anchors.length) return undefined
  return plainReportText(report.slice(Math.min(...anchors)))
}

function outlineTargetPages(outline: string | undefined) {
  if (!outline) return undefined
  const match = outline.match(/^- target_pages:\s*(\d+)/m)
  if (!match?.[1]) return undefined
  const pages = Number.parseInt(match[1], 10)
  return Number.isFinite(pages) && pages > 0 ? pages : undefined
}

function defaultMinOutlineTargetPages(plan: OperationPlanRecord | undefined, options: ReportLintOptions) {
  return finalHandoffMinOutlineTargetPages(plan, options)
}

function finalHandoffMinOutlineTargetPages(plan: OperationPlanRecord | undefined, options: ReportLintOptions) {
  const configured = options.minOutlineTargetPages
  const schoolLaptopTemplate = plan?.templateName === "school-laptop-48h"
  const floor = options.finalHandoff
    ? schoolLaptopTemplate
      ? 75
      : (plan?.timeBudget?.targetHours ?? 0) >= 20
        ? 50
        : undefined
    : undefined
  if (configured === undefined) return floor
  if (floor === undefined) return configured
  return Math.max(configured, floor)
}

function reportOutlineTargetFloor(plan: OperationPlanRecord | undefined) {
  return finalHandoffMinOutlineTargetPages(plan, { finalHandoff: true })
}

function finalHandoffMinOutlineWordsPerPage(options: ReportLintOptions) {
  if (!options.finalHandoff) return options.minOutlineWordsPerPage
  return Math.max(options.minOutlineWordsPerPage ?? 300, 300)
}

type OutlineSectionBudget = {
  title: string
  pages: number
}

function normalizeSectionTitle(value: string) {
  return plainReportText(value)
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function outlineSectionBudgets(outline: string | undefined): OutlineSectionBudget[] {
  if (!outline) return []
  const pageBudgetHeading = /^##\s+Page Budget\s*$/im.exec(outline)
  if (pageBudgetHeading?.index === undefined) return []
  const pageBudgetStart = pageBudgetHeading.index + pageBudgetHeading[0].length
  const rest = outline.slice(pageBudgetStart)
  const nextHeading = /^##\s+/im.exec(rest)
  const pageBudget = nextHeading ? rest.slice(0, nextHeading.index) : rest
  if (!pageBudget) return []
  const sections: OutlineSectionBudget[] = []
  for (const match of pageBudget.matchAll(/^\s*-\s+(.+):\s*(\d+)\s+pages?\b/gim)) {
    const title = match[1]?.trim()
    const pages = Number.parseInt(match[2] ?? "", 10)
    if (title && Number.isFinite(pages) && pages > 0) sections.push({ title, pages })
  }
  return sections
}

function reportSectionForOutlineTitle(report: string, title: string) {
  const target = normalizeSectionTitle(title)
  if (!target) return undefined
  const headings: Array<{ index: number; end: number; level: number; text: string }> = []

  for (const match of report.matchAll(/^#{1,6}\s+(.+)$/gim)) {
    if (match.index === undefined) continue
    headings.push({
      index: match.index,
      end: match.index + match[0].length,
      level: match[0].match(/^#+/)?.[0].length ?? 6,
      text: match[1] ?? "",
    })
  }
  for (const match of report.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gim)) {
    if (match.index === undefined) continue
    headings.push({
      index: match.index,
      end: match.index + match[0].length,
      level: Number.parseInt(match[1] ?? "6", 10),
      text: match[2] ?? "",
    })
  }

  headings.sort((left, right) => left.index - right.index)
  const headingIndex = headings.findIndex((heading) => normalizeSectionTitle(heading.text).includes(target))
  if (headingIndex < 0) return undefined
  const heading = headings[headingIndex]!
  const next = headings.find(
    (candidate, index) => index > headingIndex && candidate.index > heading.index && candidate.level <= heading.level,
  )
  return plainReportText(report.slice(heading.end, next?.index ?? report.length))
}

export async function writeReportOutline(worktree: string, input: ReportOutlineInput) {
  if (containsRawCredentialSecret(input)) throw new Error("report outlines must not contain raw credential secrets")
  const root = operationPath(worktree, input.operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const operationID = operation?.operationID ?? slug(input.operationID, "operation")
  const objective = operation?.objective ?? (await readOperationObjective(worktree, operationID))
  const findings = await readFindings(root)
  const reportReady = findings.filter((item) => item.state === "report_ready" || item.state === "validated")
  const plan = await readJson<OperationPlanRecord>(path.join(root, "plans", "operation-plan.json"))
  const targetPages = Math.max(input.targetPages ?? 50, reportOutlineTargetFloor(plan) ?? 0)
  const audience = input.audience ?? "mixed"
  const appendix = input.includeAppendix ?? true
  const includeCoverage = input.includeCoverageSection ?? true
  const includeHandoff = input.includeHandoffChecklist ?? true
  const hasDistrictProfile = await exists(path.join(root, "profiles", "district-profile.json"))
  const hasPeopleProfiles = await exists(path.join(root, "profiles", "people"))
  const hasIdentityGraph = await exists(path.join(root, "profiles", "identity-graph.json"))
  const sections: Array<[string, number]> = [
    ["Executive Summary", 4],
    ["Scope, Authorization, and Methodology", 3],
    [hasDistrictProfile ? "District Profile and Environment Overview" : "Environment Overview", 5],
    ...(hasPeopleProfiles || hasIdentityGraph
      ? ([["People, Roles, and Identity Graph", 5]] as Array<[string, number]>)
      : []),
    ["Attack Path Narrative", 5],
    ["Findings Detail", Math.max(12, reportReady.length * 4)],
    ["Risk Register and Prioritized Roadmap", 5],
    ...(includeCoverage ? ([["Coverage, Browser Evidence, and Testing Limits", 4]] as Array<[string, number]>) : []),
    ["Validation Limits and Known Unknowns", 3],
    ["Evidence Map", 3],
    ...(includeHandoff ? ([["Operator Handoff Checklist", 3]] as Array<[string, number]>) : []),
    ...(appendix ? [["Appendix: Raw Evidence Index", 8] as [string, number]] : []),
  ]
  const allocated = sections.reduce((sum, [, pages]) => sum + pages, 0)
  const multiplier = targetPages / allocated
  const body = [
    `# Report Outline: ${operationID}`,
    "",
    `- audience: ${audience}`,
    `- target_pages: ${targetPages}`,
    `- design_profile: ${input.designProfile ?? "premium"}`,
    `- objective: ${objective ?? "unknown"}`,
    `- reportable_findings: ${reportReady.length}`,
    "",
    "## Page Budget",
    ...sections.map(([title, pages]) => `- ${title}: ${Math.max(1, Math.round(pages * multiplier))} pages`),
    "",
    "## Required Finding Coverage",
    ...(reportReady.length
      ? reportReady.map(
          (finding) =>
            `- ${finding.findingID}: ${finding.title} (${finding.severity}) - evidence: ${finding.evidence
              .map((item) => item.id)
              .join(", ")}`,
        )
      : ["- No validated/report-ready findings yet. Report writer must not invent them."]),
    "",
    "## Report Writer Contract",
    "- Every finding section must include affected assets, evidence, impact, remediation, confidence, and validation limits.",
    "- Every evidence claim must cite a stored evidence id or path.",
    "- People, role, and identity claims should cite `profiles/` artifacts or evidence records.",
    "- The rendered report must have a cover, table of contents, metric cards, finding sections, remediation roadmap cards, and evidence cards.",
    "- Tables are for compact comparable data only; do not use them as the default layout for findings, evidence maps, validation limits, or executive summaries.",
    "- Long reports should pass evidence indexing, technical review, executive review, report_lint, report_render, runtime_summary, operation_audit, and handoff gates before delivery.",
    "- Sparse sections should be expanded with methodology, observations, validation detail, and remediation sequencing, not filler.",
    "- Known unknowns and rejected findings belong in the report when they affect decision-making.",
    "",
  ].join("\n")
  const file = path.join(root, "reports", "report-outline.md")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
  await publishOperationUpdated(worktree, {
    operationID: slug(input.operationID, "operation"),
    artifact: "report_outline",
    path: file,
  })
  return { root, file, targetPages, reportReady: reportReady.length }
}

export async function readOperationStatus(
  worktree: string,
  operationID: string,
  options: { eventLimit?: number } = {},
): Promise<OperationStatusSummary> {
  const id = slug(operationID, "operation")
  const root = operationPath(worktree, id)
  const findings = await readFindings(root)
  const evidence = await readEvidenceRecords(root)
  const byState = Object.fromEntries(FINDING_STATES.map((state) => [state, 0])) as Record<FindingState, number>
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>
  const byKind = Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, 0])) as Record<EvidenceKind, number>
  const runtime = await readJson<RuntimeSummaryRecord>(path.join(root, "deliverables", "runtime-summary.json"))
  for (const finding of findings) {
    byState[finding.state]++
    bySeverity[finding.severity]++
  }
  for (const item of evidence) byKind[item.kind]++
  return {
    operationID: id,
    root,
    sessions: await readOperationSessionBindings(worktree, id),
    operation: normalizeOperationRecord(await readJson<OperationRecord>(path.join(root, "operation.json"))),
    goal: await readJson<OperationGoalStatusRecord>(path.join(root, "goals", "operation-goal.json")).then((goal) =>
      goal?.status && goal.objective
        ? {
            status: goal.status,
            objective: goal.objective,
            targetDurationHours: goal.targetDurationHours,
            updatedAt: goal.updatedAt,
            completedAt: goal.completedAt,
          }
        : undefined,
    ),
    supervisor: await readLatestSupervisorStatus(root),
    toolInventory: await readToolInventoryStatus(root),
    policies: {
      foregroundCommand:
        "Commands expected to exceed two minutes must run through command_supervise, task background=true, runtime_scheduler, or runtime_daemon.",
    },
    plans: {
      operation: await exists(path.join(root, "plans", "operation-plan.json")),
      discoveryCharter: await exists(path.join(root, "plans", "discovery-charter.json")),
      discoveryCharterApproval: await readJson<OperationPlanStatusRecord>(
        path.join(root, "plans", "discovery-charter.json"),
      ).then((plan) => plan?.planningApproval?.status),
    },
    findings: {
      total: findings.length,
      byState,
      bySeverity,
    },
    evidence: {
      total: evidence.length,
      byKind,
    },
    reports: {
      outline: await exists(path.join(root, "reports", "report-outline.md")),
      markdown: await exists(path.join(root, "reports", "report.md")),
      html:
        (await exists(path.join(root, "reports", "report.html"))) ||
        (await exists(path.join(root, "deliverables", "final", "report.html"))),
      pdf: await exists(path.join(root, "deliverables", "final", "report.pdf")),
      readme: await exists(path.join(root, "deliverables", "final", "README.md")),
      manifest: await exists(path.join(root, "deliverables", "final", "manifest.json")),
    },
    runtimeSummary: !!runtime,
    evalScorecard: await exists(path.join(root, "deliverables", "eval-scorecard.json")),
    graph: await readGraphStatus(root, id),
    runtime: runtime
      ? {
          generatedAt: runtime.generatedAt,
          modelCalls: runtime.modelCalls,
          usage: runtime.usage,
          compaction: runtime.compaction,
          fetches: runtime.fetches,
          backgroundTasks: runtime.backgroundTasks,
          notes: runtime.notes,
        }
      : undefined,
    lastEvents: await readJsonlTail(path.join(root, "events.jsonl"), options.eventLimit ?? 5),
  }
}

function evalScorecardMarkdown(record: EvalScorecardRecord) {
  return [
    "# ULM Eval Scorecard",
    "",
    `- Operation: ${record.operationID}`,
    `- Target: ${record.target}`,
    `- Sandbox: ${record.sandbox ?? "unspecified"}`,
    `- Status: ${record.metrics.passed ? "passed" : "failed"}`,
    `- Generated: ${record.generatedAt}`,
    record.budget?.maxHours === undefined ? undefined : `- Budget hours: ${record.budget.maxHours}`,
    record.budget?.maxUSD === undefined ? undefined : `- Budget USD: ${record.budget.maxUSD}`,
    "",
    "## Success Criteria",
    "",
    ...record.successCriteria.map((item) => `- ${item}`),
    "",
    "## Metrics",
    "",
    `- Time to first signal: ${record.metrics.timeToFirstSignalMs ?? "unknown"}ms`,
    `- Validated findings: ${record.metrics.validatedFindings}`,
    `- False positives: ${record.metrics.falsePositives}`,
    `- Tool failures: ${record.metrics.toolFailures}`,
    `- Retries: ${record.metrics.retries}`,
    `- Cost USD: ${record.metrics.costUSD ?? "unknown"}`,
    `- Report quality: ${record.metrics.reportQuality}`,
    "",
    record.allowedProfiles?.length
      ? `## Allowed Profiles\n\n${record.allowedProfiles.map((item) => `- ${item}`).join("\n")}\n`
      : undefined,
    record.artifactRequirements?.length
      ? `## Artifact Requirements\n\n${record.artifactRequirements.map((item) => `- ${item}`).join("\n")}\n`
      : undefined,
    record.mitreTags?.length
      ? `## MITRE Tags\n\n${record.mitreTags.map((item) => `- ${item}`).join("\n")}\n`
      : undefined,
    record.notes?.length ? `## Notes\n\n${record.notes.map((item) => `- ${item}`).join("\n")}\n` : undefined,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
    .trimEnd()
    .concat("\n")
}

export async function writeEvalScorecard(worktree: string, input: EvalScorecardInput): Promise<EvalScorecardResult> {
  if (containsRawCredentialSecret(input)) throw new Error("eval scorecards must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const record: EvalScorecardRecord = {
    ...input,
    operationID,
    generatedAt: new Date().toISOString(),
  }
  const json = path.join(root, "deliverables", "eval-scorecard.json")
  const markdown = path.join(root, "deliverables", "eval-scorecard.md")
  await writeJson(json, record)
  await fs.writeFile(markdown, evalScorecardMarkdown(record))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "eval_scorecard",
    operationID,
    passed: record.metrics.passed,
    validatedFindings: record.metrics.validatedFindings,
    falsePositives: record.metrics.falsePositives,
    generatedAt: record.generatedAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "eval_scorecard", path: json })
  return { operationID, json, markdown }
}

export async function listOperationStatuses(
  worktree: string,
  options: { eventLimit?: number } = {},
): Promise<OperationStatusSummary[]> {
  const root = operationsRoot(worktree)
  if (!(await exists(root))) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const operationIDs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
  return Promise.all(operationIDs.map((operationID) => readOperationStatus(worktree, operationID, options)))
}

export async function closeOperationStatuses(worktree: string, input: { operationIDs?: readonly string[] } = {}) {
  const operations = await listOperationStatuses(worktree, { eventLimit: 0 })
  const allowed = input.operationIDs ? new Set(input.operationIDs.map((id) => slug(id, "operation"))) : undefined
  const targets = operations.filter(
    (item) =>
      item.operation &&
      item.operation.status !== "complete" &&
      item.operation.status !== "paused" &&
      (!allowed || allowed.has(item.operationID)),
  )
  const now = new Date().toISOString()
  await Promise.all(
    targets.map(async (item) => {
      const root = operationPath(worktree, item.operationID)
      const record: OperationRecord = {
        ...item.operation!,
        status: "paused",
        activeTasks: [],
        summary: item.operation!.summary || "Closed from ULMCode Desktop.",
        time: {
          created: item.operation!.time.created,
          updated: now,
        },
      }
      await writeJson(path.join(root, "operation.json"), record)
      await appendJsonl(path.join(root, "events.jsonl"), { type: "desktop_pause", ...record })
      await fs.writeFile(path.join(root, "status.md"), statusMarkdown(record))
      await publishOperationUpdated(worktree, {
        operationID: item.operationID,
        artifact: "checkpoint",
        path: path.join(root, "operation.json"),
      })
    }),
  )
  return {
    closed: targets.map((item) => item.operationID),
    remaining: operations.length - targets.length,
  }
}

export async function writeRuntimeSummary(worktree: string, input: RuntimeSummaryInput): Promise<RuntimeSummaryResult> {
  const operationID = slug(input.operationID, "operation")
  const resolvedInput = await redactOperationCredentialValues(operationID, mergeRuntimeUsage(input))
  if (containsRawCredentialSecret(resolvedInput)) throw new Error("runtime summaries must not contain raw credential secrets")
  const root = operationPath(worktree, operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const finalDir = path.join(root, "deliverables")
  const record: RuntimeSummaryRecord = {
    ...resolvedInput,
    sessionMessages: undefined,
    operationID,
    generatedAt: new Date().toISOString(),
    operation: operation
      ? {
          stage: operation.stage,
          status: operation.status,
          summary: operation.summary,
          nextActions: operation.nextActions,
          blockers: operation.blockers,
          activeTasks: operation.activeTasks,
        }
      : undefined,
    artifacts: {
      root,
      status: path.join(root, "status.md"),
      events: path.join(root, "events.jsonl"),
      findings: path.join(root, "findings"),
      final: path.join(root, "deliverables", "final"),
    },
  }
  assertOperationArtifactSafe(operationID, "runtime-summary", record)
  const json = path.join(finalDir, "runtime-summary.json")
  const markdown = path.join(finalDir, "runtime-summary.md")
  const finalRuntimeMarkdown = path.join(finalDir, "final", "runtime-summary.md")
  await writeJson(json, record)
  const markdownText = runtimeSummaryMarkdown(record)
  await fs.writeFile(markdown, markdownText)
  if (await exists(finalRuntimeMarkdown)) await fs.writeFile(finalRuntimeMarkdown, markdownText)
  await publishOperationUpdated(worktree, { operationID, artifact: "runtime_summary", path: json })
  return { operationID, json, markdown, finalDir }
}

export async function writeOperationPlan(worktree: string, input: OperationPlanInput): Promise<OperationPlanResult> {
  if (containsRawCredentialSecret(input)) throw new Error("operation plans must not contain raw credential secrets")
  const gaps = validateOperationPlan(input)
  if (gaps.length) throw new Error(gaps.join("; "))

  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const record: OperationPlanRecord = {
    ...input,
    operationID,
    writtenAt: new Date().toISOString(),
    objective: await readOperationObjective(worktree, operationID),
  }
  const json = path.join(root, "plans", "operation-plan.json")
  const markdown = path.join(root, "plans", "operation-plan.md")
  await writeJson(json, record)
  await fs.writeFile(markdown, operationPlanMarkdown(record))
  if (record.coverageContract) {
    await writeCoverageContract(worktree, {
      ...record.coverageContract,
      operationID,
      status: record.coverageContract.status ?? "unmet",
    })
  }
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "operation_plan",
    operationID,
    phases: record.phases.length,
    writtenAt: record.writtenAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "operation_plan", path: json })
  return { operationID, json, markdown, phases: record.phases.length }
}

export async function writeOperationDiscoveryCharter(
  worktree: string,
  input: OperationDiscoveryCharterInput,
): Promise<OperationPlanResult> {
  if (containsRawCredentialSecret(input)) throw new Error("operation discovery charters must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const record: OperationPlanRecord = {
    ...input,
    operationID,
    planningApproval: input.planningApproval ?? { status: "pending", discoveryCharterPath: "plans/discovery-charter.md" },
    phases: [],
    reportingCloseout: [],
    writtenAt: new Date().toISOString(),
    objective: await readOperationObjective(worktree, operationID),
  }
  const json = path.join(root, "plans", "discovery-charter.json")
  const markdown = path.join(root, "plans", "discovery-charter.md")
  await writeJson(json, record)
  await fs.writeFile(markdown, operationDiscoveryCharterMarkdown(record))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "discovery_charter",
    operationID,
    writtenAt: record.writtenAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "operation_plan", path: json })
  return { operationID, json, markdown, phases: 0 }
}

export async function approveOperationDiscoveryCharter(
  worktree: string,
  input: { operationID: string; approver?: string; notes?: string[]; approvedAt?: string },
): Promise<OperationPlanResult | undefined> {
  if (containsRawCredentialSecret(input)) throw new Error("operation discovery charter approvals must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const json = path.join(root, "plans", "discovery-charter.json")
  const markdown = path.join(root, "plans", "discovery-charter.md")
  const record = await readJson<OperationPlanRecord>(json)
  if (!record) return undefined
  const existing = record.planningApproval
  const notes = [
    ...(existing?.notes ?? []),
    ...(input.notes ?? ["Approved through operator question response."]),
  ].filter(Boolean)
  const updated: OperationPlanRecord = {
    ...record,
    planningApproval: {
      ...existing,
      status: "approved",
      discoveryCharterPath: existing?.discoveryCharterPath ?? "plans/discovery-charter.md",
      approvedAt: input.approvedAt ?? existing?.approvedAt ?? new Date().toISOString(),
      approver: input.approver ?? existing?.approver ?? "operator",
      notes,
    },
  }
  await writeJson(json, updated)
  await fs.writeFile(markdown, operationDiscoveryCharterMarkdown(updated))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "discovery_charter_approval",
    operationID,
    approvedAt: updated.planningApproval?.approvedAt,
    approver: updated.planningApproval?.approver,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "operation_plan", path: json })
  return { operationID, json, markdown, phases: 0 }
}

export async function writeCoverageContract(
  worktree: string,
  input: CoverageContractInput,
): Promise<{ operationID: string; json: string; markdown: string }> {
  if (containsRawCredentialSecret(input)) throw new Error("coverage contracts must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const record: CoverageContractRecord = {
    ...input,
    operationID,
    status: input.status ?? "unmet",
    writtenAt: new Date().toISOString(),
  }
  const json = path.join(root, "plans", "coverage-contract.json")
  const markdown = path.join(root, "plans", "coverage-contract.md")
  await writeJson(json, record)
  await fs.writeFile(markdown, coverageContractMarkdown(record))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "coverage_contract",
    operationID,
    status: record.status,
    writtenAt: record.writtenAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "operation_plan", path: json })
  return { operationID, json, markdown }
}

export async function readCoverageContract(worktree: string, operationID: string) {
  return readJson<CoverageContractRecord>(
    path.join(operationPath(worktree, slug(operationID, "operation")), "plans", "coverage-contract.json"),
  )
}

export async function evaluateCoverageReadiness(
  worktree: string,
  operationIDInput: string,
): Promise<CoverageReadiness> {
  const operationID = slug(operationIDInput, "operation")
  const root = operationPath(worktree, operationID)
  const contract = await readJson<CoverageContractRecord>(path.join(root, "plans", "coverage-contract.json"))
  if (!contract) return { ok: false, status: "missing", gaps: ["coverage contract is missing"] }

  const gaps: string[] = []
  const graph = await readJson<OperationGraphStatusRecord>(path.join(root, "plans", "operation-graph.json"))
  const lanes = graph?.lanes ?? []
  const byID = new Map(lanes.map((lane) => [lane.id ?? "unknown", lane]))
  const allowedSkipped = new Set(contract.allowedSkippedLanes)
  for (const laneID of contract.requiredLanes) {
    const lane = byID.get(laneID)
    if (!lane) {
      gaps.push(`coverage required lane ${laneID} is missing from operation graph`)
      continue
    }
    if (lane.status === "complete") continue
    if ((lane.status === "skipped" || lane.status === "blocked") && allowedSkipped.has(laneID) && !lane.releaseRequired) {
      continue
    }
    gaps.push(`coverage required lane ${laneID} is ${lane.status ?? "unknown"}`)
  }
  for (const lane of lanes) {
    const id = lane.id ?? "unknown"
    if (
      (lane.status === "skipped" || lane.status === "blocked" || lane.terminalState === "skipped" || lane.terminalState === "blocked") &&
      (lane.releaseRequired || lane.coverageImpact === "blocks_release") &&
      !allowedSkipped.has(id)
    ) {
      gaps.push(`lane ${id} is ${lane.terminalState ?? lane.status} and blocks release`)
    }
  }
  if (contract.status !== "met" && contract.status !== "released") {
    gaps.push(`coverage contract status is ${contract.status}`)
  }
  return { ok: gaps.length === 0, status: contract.status, gaps }
}

async function coverageReadinessGapsIgnoringStatus(worktree: string, operationIDInput: string) {
  const operationID = slug(operationIDInput, "operation")
  const root = operationPath(worktree, operationID)
  const contract = await readJson<CoverageContractRecord>(path.join(root, "plans", "coverage-contract.json"))
  if (!contract) return { contract: undefined, gaps: ["coverage contract is missing"] }

  const gaps: string[] = []
  const graph = await readJson<OperationGraphStatusRecord>(path.join(root, "plans", "operation-graph.json"))
  const lanes = graph?.lanes ?? []
  const byID = new Map(lanes.map((lane) => [lane.id ?? "unknown", lane]))
  const allowedSkipped = new Set(contract.allowedSkippedLanes)
  for (const laneID of contract.requiredLanes) {
    const lane = byID.get(laneID)
    if (!lane) {
      gaps.push(`coverage required lane ${laneID} is missing from operation graph`)
      continue
    }
    if (lane.status === "complete") continue
    if ((lane.status === "skipped" || lane.status === "blocked") && allowedSkipped.has(laneID) && !lane.releaseRequired) {
      continue
    }
    gaps.push(`coverage required lane ${laneID} is ${lane.status ?? "unknown"}`)
  }
  for (const lane of lanes) {
    const id = lane.id ?? "unknown"
    if (
      (lane.status === "skipped" || lane.status === "blocked" || lane.terminalState === "skipped" || lane.terminalState === "blocked") &&
      (lane.releaseRequired || lane.coverageImpact === "blocks_release") &&
      !allowedSkipped.has(id)
    ) {
      gaps.push(`lane ${id} is ${lane.terminalState ?? lane.status} and blocks release`)
    }
  }
  return { contract, gaps }
}

async function promoteCoverageContractIfStructurallyReady(
  worktree: string,
  operationIDInput: string,
  status: "met" | "released",
) {
  const operationID = slug(operationIDInput, "operation")
  const root = operationPath(worktree, operationID)
  const result = await coverageReadinessGapsIgnoringStatus(worktree, operationID)
  if (!result.contract || result.gaps.length) return false
  if (result.contract.status === "released" || (status === "met" && result.contract.status === "met")) return false
  const updated: CoverageContractRecord = {
    ...result.contract,
    operationID,
    status,
    releaseNotes: [
      ...(result.contract.releaseNotes ?? []),
      `Coverage contract auto-marked ${status} after required lanes had valid completion state.`,
    ],
    writtenAt: new Date().toISOString(),
  }
  const json = path.join(root, "plans", "coverage-contract.json")
  const markdown = path.join(root, "plans", "coverage-contract.md")
  await writeJson(json, updated)
  await fs.writeFile(markdown, coverageContractMarkdown(updated))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "coverage_contract",
    operationID,
    status,
    writtenAt: updated.writtenAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "operation_plan", path: json })
  return true
}

export async function writeDistrictProfile(worktree: string, input: DistrictProfileInput): Promise<ProfileWriteResult> {
  if (containsRawCredentialSecret(input)) throw new Error("district profiles must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const json = path.join(root, "profiles", "district-profile.json")
  const markdown = path.join(root, "profiles", "district-profile.md")
  const record = { ...input, operationID, updatedAt: new Date().toISOString() }
  await writeJson(json, record)
  await fs.mkdir(path.dirname(markdown), { recursive: true })
  await fs.writeFile(markdown, districtProfileMarkdown(record))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "district_profile",
    operationID,
    updatedAt: record.updatedAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "checkpoint", path: json })
  return { operationID, json, markdown }
}

export async function writePersonProfile(worktree: string, input: PersonProfileInput): Promise<ProfileWriteResult> {
  if (containsRawCredentialSecret(input)) throw new Error("person profiles must not contain raw credential secrets")
  if (containsPrivateDossierDetail(input)) throw new Error("person profiles must not contain private-life dossier details")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const personID = makePersonProfileID(input)
  const json = path.join(root, "profiles", "people", `${personID}.json`)
  const markdown = path.join(root, "profiles", "people", `${personID}.md`)
  const record = { ...input, operationID, personID, updatedAt: new Date().toISOString() }
  await writeJson(json, record)
  await fs.mkdir(path.dirname(markdown), { recursive: true })
  await fs.writeFile(markdown, personProfileMarkdown(record))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "person_profile",
    operationID,
    personID,
    updatedAt: record.updatedAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "checkpoint", path: json })
  return { operationID, json, markdown }
}

export async function writeIdentityGraph(worktree: string, input: IdentityGraphInput): Promise<ProfileWriteResult> {
  if (containsRawCredentialSecret(input)) throw new Error("identity graphs must not contain raw credential secrets")
  if (containsPrivateDossierDetail(input)) throw new Error("identity graphs must not contain private-life dossier details")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const json = path.join(root, "profiles", "identity-graph.json")
  const markdown = path.join(root, "profiles", "identity-graph.md")
  const record = { ...input, operationID, updatedAt: new Date().toISOString() }
  await writeJson(json, record)
  await fs.mkdir(path.dirname(markdown), { recursive: true })
  await fs.writeFile(markdown, identityGraphMarkdown(record))
  await appendJsonl(path.join(root, "events.jsonl"), {
    type: "identity_graph",
    operationID,
    nodes: record.nodes.length,
    edges: record.edges.length,
    updatedAt: record.updatedAt,
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "checkpoint", path: json })
  return { operationID, json, markdown }
}

export async function lintReport(
  worktree: string,
  operationID: string,
  options: ReportLintOptions = {},
): Promise<ReportLintResult> {
  const root = operationPath(worktree, operationID)
  const gaps: string[] = []
  const requireOperationPlan = options.finalHandoff || options.requireOperationPlan
  const requireRenderedDeliverables = options.finalHandoff || options.requireRenderedDeliverables
  const requireRuntimeSummary = Boolean(options.finalHandoff || options.requireRuntimeSummary)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  if (!operation) gaps.push("operation.json is missing")
  if (operation && operation.status !== "complete" && operation.stage === "handoff") {
    gaps.push("handoff stage must be marked complete before final report handoff")
  }
  if (options.finalHandoff && operation) {
    if (operation.stage !== "handoff") gaps.push("operation stage must be handoff for final handoff")
    if (operation.status !== "complete") gaps.push("operation status must be complete for final handoff")
  }
  const plan = await readJson<OperationPlanRecord>(path.join(root, "plans", "operation-plan.json"))

  const findings = await readFindings(root)
  const evidenceRecords = await readEvidenceRecords(root)
  const evidenceIDs = new Set(evidenceRecords.map((item) => item.evidenceID))
  const evidencePaths = new Set(evidenceRecords.flatMap((item) => (item.path ? [item.path] : [])))

  for (const finding of findings) {
    for (const gap of validateFinding(finding)) gaps.push(`${finding.findingID}: ${gap}`)
    if (finding.state === "candidate") gaps.push(`${finding.findingID}: candidate finding is not reportable`)
    if (finding.state === "needs_validation") gaps.push(`${finding.findingID}: finding still needs validation`)
    if (finding.state === "validated" || finding.state === "report_ready") {
      for (const ref of finding.evidence) {
        if (!evidenceIDs.has(ref.id) && (!ref.path || !evidencePaths.has(ref.path))) {
          gaps.push(`${finding.findingID}: evidence reference ${ref.id} is not recorded`)
        }
      }
    }
  }
  gaps.push(...overlappingFindingGaps(findings))

  const counts = {
    findings: findings.length,
    reportReady: findings.filter((item) => item.state === "report_ready").length,
    validated: findings.filter((item) => item.state === "validated").length,
    candidates: findings.filter((item) => item.state === "candidate" || item.state === "needs_validation").length,
    rejected: findings.filter((item) => item.state === "rejected").length,
  }
  if (counts.findings === 0) gaps.push("no findings were recorded")
  if (counts.reportReady === 0 && counts.validated === 0) gaps.push("no validated or report-ready findings exist")

  const report = await readReportText(root)
  if (options.requireReport && !report) gaps.push("reports/report.md or reports/report.html is required")
  if (report && containsRawCredentialSecret(report)) gaps.push("report contains raw credential secrets")
  if (report && containsPrivateDossierDetail(report)) gaps.push("report contains private-life dossier details")
  if (report && containsDestructiveExploitClaim(report)) gaps.push("report contains destructive exploit execution claims")
  if (report && containsUnprofessionalReportTone(report)) gaps.push("report contains unprofessional stakeholder tone")
  if (report && containsReportPaddingPlaceholder(report)) gaps.push("report contains placeholder or reserved-page padding")
  if (report && options.minWords) {
    const words = wordCount(plainReportText(report))
    if (words < options.minWords)
      gaps.push(`report is too sparse: ${words} words, expected at least ${options.minWords}`)
  }
  const minOutlineTargetPages = defaultMinOutlineTargetPages(plan, options)
  const minPdfPages = options.minPdfPages
  const requireOutlineBudget = options.requireOutlineBudget || minOutlineTargetPages || options.minOutlineWordsPerPage
  const requireOutlineSections =
    options.requireOutlineSections || options.minOutlineSectionWords || options.minOutlineSectionWordsPerPage
  if (requireOutlineBudget || requireOutlineSections) {
    const outline = await readText(path.join(root, "reports", "report-outline.md"))
    if (requireOutlineBudget) {
      const targetPages = outlineTargetPages(outline)
      const sections = outlineSectionBudgets(outline)
      if (!targetPages) gaps.push("reports/report-outline.md with target_pages is required for outline budget lint")
      if (targetPages && minOutlineTargetPages && targetPages < minOutlineTargetPages) {
        gaps.push(
          `reports/report-outline.md target_pages is too small: ${targetPages}, expected at least ${minOutlineTargetPages}`,
        )
      }
      if (targetPages && sections.length) {
        const sectionPages = sections.reduce((sum, section) => sum + section.pages, 0)
        if (sectionPages > targetPages * 1.25) {
          gaps.push(
            `reports/report-outline.md Page Budget totals ${sectionPages} pages but target_pages is ${targetPages}`,
          )
        }
      }
      if (!report) gaps.push("report is required for outline budget lint")
      if (report && targetPages) {
        const words = wordCount(plainReportText(report))
        const wordsPerPage = finalHandoffMinOutlineWordsPerPage(options) ?? 300
        const expected = targetPages * wordsPerPage
        if (words < expected) {
          gaps.push(
            `report misses outline budget: ${words} words, expected at least ${expected} for ${targetPages} target pages`,
          )
        }
      }
    }
    if (requireOutlineSections) {
      const sections = outlineSectionBudgets(outline)
      if (!sections.length) gaps.push("reports/report-outline.md Page Budget sections are required for section lint")
      if (!report) gaps.push("report is required for outline section lint")
      if (report) {
        for (const section of sections) {
          const reportSection = reportSectionForOutlineTitle(report, section.title)
          if (!reportSection) {
            gaps.push(`${section.title}: outline section is missing`)
            continue
          }
          const words = wordCount(reportSection)
          const expected =
            options.minOutlineSectionWords ?? section.pages * (options.minOutlineSectionWordsPerPage ?? 120)
          if (words < expected) {
            gaps.push(`${section.title}: outline section is too sparse: ${words} words, expected at least ${expected}`)
          }
        }
      }
    }
  }
  if (report && (options.requireFindingSections || options.minFindingWords)) {
    for (const finding of findings.filter((item) => item.state === "report_ready" || item.state === "validated")) {
      const section = reportSectionForFinding(report, finding)
      if (!section) {
        gaps.push(`${finding.findingID}: report section is missing`)
        continue
      }
      if (options.minFindingWords) {
        const words = wordCount(section)
        if (words < options.minFindingWords) {
          gaps.push(
            `${finding.findingID}: report section is too sparse: ${words} words, expected at least ${options.minFindingWords}`,
          )
        }
      }
    }
  }
  if (requireOperationPlan && !(await exists(path.join(root, "plans", "operation-plan.json")))) {
    gaps.push("plans/operation-plan.json is required")
  }
  if (requireRenderedDeliverables) {
    if (!(await exists(path.join(root, "deliverables", "final", "README.md")))) {
      gaps.push("deliverables/final/README.md is required")
    }
    for (const file of FINAL_PACKAGE_FILES) {
      if (!(await exists(path.join(root, "deliverables", "final", file)))) {
        gaps.push(`deliverables/final/${file} is required`)
      }
    }
    gaps.push(...(await finalPackageIntegrityGaps(root, { requireRuntimeSummary, minPdfPages, requireStakeholderMinimumPages: Boolean(options.finalHandoff) })))
  }
  if (requireRuntimeSummary && !(await exists(path.join(root, "deliverables", "runtime-summary.json")))) {
    gaps.push("deliverables/runtime-summary.json is required")
  }
  if (options.finalHandoff) {
    const coverage = await evaluateCoverageReadiness(worktree, operationID)
    if (!coverage.ok) {
      for (const gap of coverage.gaps) gaps.push(`coverage: ${gap}`)
    }
    const graph = await readGraphStatus(root, slug(operationID, "operation"))
    if (!graph) gaps.push("plans/operation-graph.json is required")
    for (const lane of graph?.lanes.incomplete ?? []) gaps.push(`operation lane ${lane} is not complete`)
    for (const lane of graph?.lanes.failed ?? []) gaps.push(`operation lane ${lane} is failed`)
    for (const lane of graph?.lanes.missingProofs ?? []) gaps.push(`operation lane ${lane} is missing completion proof`)
    for (const lane of graph?.lanes.invalidProofs ?? [])
      gaps.push(
        `operation lane ${lane} has invalid completion proof${formatInvalidProofReasons(graph?.lanes.invalidProofReasons?.[lane])}`,
      )
  }

  return {
    operationID: slug(operationID, "operation"),
    ok: gaps.length === 0,
    checkedAt: new Date().toISOString(),
    gaps,
    repairHints: reportLintRepairHints(gaps),
    counts,
  }
}

function reportLintRepairHints(gaps: string[]) {
  const hints = new Set<string>()
  let finalPackageOutOfSync = false
  for (const gap of gaps) {
    if (
      gap.startsWith("deliverables/final/manifest.json ") ||
      gap.startsWith("deliverables/final/findings.json ") ||
      gap.startsWith("deliverables/final/evidence-index.json ") ||
      gap.startsWith("deliverables/final/identity-graph.json ") ||
      gap.includes(" operationID does not match operation") ||
      gap === "deliverables/final/runtime-summary.md does not match deliverables/runtime-summary.md"
    ) {
      finalPackageOutOfSync = true
    }

    const pageCount = gap.match(/^deliverables\/final\/report\.pdf has (\d+) pages, expected at least (\d+)/)
    if (pageCount) {
      const current = Number(pageCount[1])
      const expected = Number(pageCount[2])
      const missing = Number.isFinite(current) && Number.isFinite(expected) ? Math.max(1, expected - current) : 1
      hints.add(
        `Main PDF is ${missing} page${missing === 1 ? "" : "s"} short. Add at least ${missing * 450} words of substantive stakeholder-useful appendix, remediation, validation, or operator-handoff content to reports/report.md, then run report_render and rerun report_lint with the same gates. Do not add blank, reserved, placeholder, or render-padding pages.`,
      )
      continue
    }

    const sparseReport = gap.match(/^report is too sparse: (\d+) words, expected at least (\d+)$/)
    if (sparseReport) {
      const current = Number(sparseReport[1])
      const expected = Number(sparseReport[2])
      const missing = Number.isFinite(current) && Number.isFinite(expected) ? Math.max(1, expected - current) : 1
      const buffer = Number.isFinite(expected) ? Math.max(150, Math.ceil(expected * 0.02)) : 150
      hints.add(
        `Report text is ${missing} words short of the minimum. Add at least ${missing + buffer} additional substantive, evidence-backed words to reports/report.md before rerunning report_lint; do not make tiny incremental edits.`,
      )
      continue
    }

    const sparseOutline = gap.match(/^(.+): outline section is too sparse: (\d+) words, expected at least (\d+)/)
    if (sparseOutline) {
      const current = Number(sparseOutline[2])
      const expected = Number(sparseOutline[3])
      const missing = Number.isFinite(current) && Number.isFinite(expected) ? Math.max(1, expected - current) : 1
      const buffer = Number.isFinite(expected) ? Math.max(100, Math.ceil(expected * 0.4)) : 100
      hints.add(
        `Expand the "${sparseOutline[1]}" section in reports/report.md by at least ${missing + buffer} additional evidence-backed words, then rerun report_lint; do not make tiny incremental edits.`,
      )
      continue
    }

    const missingOutline = gap.match(/^(.+): outline section is missing$/)
    if (missingOutline) {
      hints.add(
        `Add a matching "${missingOutline[1]}" heading and section to reports/report.md, then rerun report_lint.`,
      )
      continue
    }

    const budget = gap.match(/^report misses outline budget: (\d+) words, expected at least (\d+) for (\d+) target pages$/)
    if (budget) {
      const current = Number(budget[1])
      const expected = Number(budget[2])
      const missing = Number.isFinite(current) && Number.isFinite(expected) ? Math.max(1, expected - current) : 1
      const buffer = Number.isFinite(expected) ? Math.max(150, Math.ceil(expected * 0.02)) : 150
      const scaleGuidance =
        missing >= 3000
          ? " For a deficit this large, rewrite or delegate a report-expansion task in one bulk pass; patching a few paragraphs at a time will fail this gate."
          : ""
      hints.add(
        `Report text is ${missing} words short of the outline budget. Add at least ${missing + buffer} additional substantive, evidence-backed words to reports/report.md before rendering again; do not make tiny incremental edits.${scaleGuidance}`,
      )
      continue
    }

    const findingSparse = gap.match(/^(.+): report section is too sparse: (\d+) words, expected at least (\d+)/)
    if (findingSparse) {
      const current = Number(findingSparse[2])
      const expected = Number(findingSparse[3])
      const missing = Number.isFinite(current) && Number.isFinite(expected) ? Math.max(1, expected - current) : 1
      const buffer = Number.isFinite(expected) ? Math.max(100, Math.ceil(expected * 0.4)) : 100
      hints.add(
        `Expand the finding section for ${findingSparse[1]} by at least ${missing + buffer} additional evidence-backed words, preserving evidence references; do not make tiny incremental edits.`,
      )
      continue
    }

    if (gap.includes(" appear overlapping; merge them or split the evidence")) {
      hints.add(
        "Merge overlapping findings or rewrite them with distinct evidence, affected assets, impact, and remediation before rendering the final package.",
      )
    }
    if (gap === "report contains raw credential secrets") {
      hints.add(
        "Remove secret-shaped values from reports/report.md. Final reports may cite redacted credential handles such as cred-*-redacted, but raw passwords, tokens, cookies, API keys, or generated placeholder secrets belong only in internal review quarantine artifacts.",
      )
    }
    if (gap === "report contains unprofessional stakeholder tone") {
      hints.add(
        "Rewrite casual, meme-like, profane, or jokey language in reports/report.md into board-ready professional wording, then rerun report_lint.",
      )
    }
    if (gap === "report contains placeholder or reserved-page padding") {
      hints.add(
        "Remove reserved-page, placeholder, or render-padding sections from reports/report.md. Long reports must grow through substantive, evidence-backed analysis, worksheets, appendices, remediation plans, and validation guidance, not blank or reserved pages.",
      )
    }
  }
  if (finalPackageOutOfSync) {
    hints.add(
      "Rendered final package artifacts are out of sync. Do not hand-edit deliverables/final generated files; fix source artifacts if needed, run report_render, then run runtime_summary and report_lint again.",
    )
  }
  return [...hints]
}

function reportOutlineTitles(outline: string | undefined) {
  const titles = outlineSectionBudgets(outline).map((section) => section.title)
  return titles.length
    ? titles
    : [
        "Executive Summary",
        "Scope, Authorization, and Methodology",
        "District Profile and Environment Overview",
        "People, Roles, and Identity Graph",
        "Findings Detail",
        "Risk Register and Prioritized Roadmap",
        "Validation Limits and Known Unknowns",
        "Evidence Map",
      ]
}

function renderEvidenceRows(evidence: EvidenceRecord[]) {
  return evidence.length
    ? evidence
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.evidenceID)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(
              item.title,
            )}</td><td>${escapeHtml(item.path ?? "")}</td><td>${escapeHtml(item.summary)}</td></tr>`,
        )
        .join("\n")
    : '<tr><td colspan="5">No evidence records were recorded.</td></tr>'
}

function renderFindingRows(reportable: FindingRecord[]) {
  return reportable.length
    ? reportable
        .map(
          (finding) =>
            `<tr><td>${escapeHtml(finding.findingID)}</td><td>${escapeHtml(finding.severity)}</td><td>${escapeHtml(
              finding.title,
            )}</td><td>${escapeHtml(finding.state)}</td><td>${escapeHtml(
              finding.evidence.map((item) => item.path ?? item.id).join(", "),
            )}</td></tr>`,
        )
        .join("\n")
    : '<tr><td colspan="5">No validated or report-ready findings were recorded.</td></tr>'
}

function renderMetricCard(label: string, value: string, detail: string) {
  return `<div class="metric-card">
    <div class="metric-value">${escapeHtml(value)}</div>
    <div class="metric-label">${escapeHtml(label)}</div>
    <p>${escapeHtml(detail)}</p>
  </div>`
}

function renderFindingRoadmapCards(reportable: FindingRecord[]) {
  return reportable.length
    ? reportable
        .map(
          (finding) => `<article class="roadmap-card severity-${escapeHtml(finding.severity)}">
    <div class="card-kicker">${escapeHtml(finding.findingID)} / ${escapeHtml(finding.severity)} / ${escapeHtml(finding.state)}</div>
    <h3>${escapeHtml(finding.title)}</h3>
    <p>${escapeHtml(finding.impact ?? finding.description)}</p>
    <p><strong>Next owner action:</strong> ${escapeHtml(finding.remediation ?? "Assign an accountable owner and define a retest plan.")}</p>
    <p><strong>Evidence:</strong> ${escapeHtml(finding.evidence.map((item) => item.path ?? item.id).join(", ") || "not recorded")}</p>
  </article>`,
        )
        .join("\n")
    : '<article class="roadmap-card empty"><h3>No validated or report-ready findings</h3><p>The report must not invent risks to fill the roadmap.</p></article>'
}

function renderNonReportableCards(nonReportable: FindingRecord[]) {
  return nonReportable.length
    ? nonReportable
        .map(
          (finding) => `<article class="validation-card">
    <div class="card-kicker">${escapeHtml(finding.findingID)} / ${escapeHtml(finding.state)} / ${escapeHtml(finding.severity)}</div>
    <h3>${escapeHtml(finding.title)}</h3>
    <p>Retained for reviewer awareness, but not promoted to report-ready status at handoff.</p>
    <p>${escapeHtml(finding.description)}</p>
  </article>`,
        )
        .join("\n")
    : '<article class="validation-card empty"><h3>No retained validation limits</h3><p>No rejected, candidate, or needs-validation findings were recorded.</p></article>'
}

function renderEvidenceCards(evidence: EvidenceRecord[]) {
  return evidence.length
    ? evidence
        .map(
          (item) => `<article class="evidence-card">
    <div class="card-kicker">${escapeHtml(item.evidenceID)} / ${escapeHtml(item.kind)}</div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.summary)}</p>
    <p><strong>Path:</strong> ${escapeHtml(item.path ?? "not recorded")}</p>
  </article>`,
        )
        .join("\n")
    : '<article class="evidence-card empty"><h3>No evidence records</h3><p>No evidence records were recorded.</p></article>'
}

function renderFindingSections(reportable: FindingRecord[]) {
  return reportable.length
    ? reportable
        .map(
          (finding) => `<section class="finding severity-${escapeHtml(finding.severity)}">
    <div class="finding-header">
      <div>
        <div class="card-kicker">${escapeHtml(finding.findingID)} / ${escapeHtml(finding.state)}</div>
        <h3>${escapeHtml(finding.title)}</h3>
      </div>
      <div class="severity-pill">${escapeHtml(finding.severity)}</div>
    </div>
    <div class="finding-meta">
      <span>confidence ${finding.confidence}</span>
      <span>${escapeHtml(finding.affectedAssets.join(", ") || "no affected assets recorded")}</span>
    </div>
    <p><strong>What was found:</strong> ${escapeHtml(finding.description)}</p>
    <p><strong>Operational impact:</strong> ${escapeHtml(finding.impact ?? "Not recorded.")}</p>
    <p><strong>Remediation path:</strong> ${escapeHtml(finding.remediation ?? "Not recorded.")}</p>
    <p><strong>Evidence trail:</strong> ${escapeHtml(finding.evidence.map((item) => item.path ?? item.id).join(", ") || "not recorded")}</p>
  </section>`,
        )
        .join("\n")
    : "<p>No validated or report-ready findings were recorded.</p>"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function manifestPathValue(finalDir: string, value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined
  return path.resolve(path.isAbsolute(value) ? value : path.join(finalDir, value))
}

function comparableManifestPath(value: string) {
  return path.resolve(value).replace(/^\/private\/var\//, "/var/")
}

function arrayIDs(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item : isRecord(item) ? item.id ?? item.findingID ?? item.evidenceID : undefined))
        .filter((item): item is string => typeof item === "string")
        .sort((left, right) => left.localeCompare(right))
    : []
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

async function parseRequiredJson(file: string, gapLabel: string, gaps: string[]) {
  try {
    JSON.parse(await fs.readFile(file, "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    gaps.push(`${gapLabel} is not valid JSON`)
  }
}

function pdfPageCount(pdf: string | undefined) {
  const match = pdf?.match(/\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)/)
  const pages = Number.parseInt(match?.[1] ?? "", 10)
  return Number.isFinite(pages) && pages > 0 ? pages : undefined
}

async function finalPackageIntegrityGaps(
  root: string,
  input: { requireRuntimeSummary: boolean; minPdfPages?: number; requireStakeholderMinimumPages?: boolean },
) {
  const gaps: string[] = []
  const expectedOperationID = path.basename(root)
  const finalDir = path.join(root, "deliverables", "final")
  const manifestPath = path.join(finalDir, "manifest.json")
  const expectedArtifacts: Record<string, string> = {
    html: path.join(finalDir, "report.html"),
    pdf: path.join(finalDir, "report.pdf"),
    readme: path.join(finalDir, "README.md"),
    findingsJson: path.join(finalDir, "findings.json"),
    evidenceIndex: path.join(finalDir, "evidence-index.json"),
    peopleProfiles: path.join(finalDir, "people-profiles.md"),
    identityGraph: path.join(finalDir, "identity-graph.json"),
    operatorReview: path.join(finalDir, "operator-review.md"),
    executiveSummary: path.join(finalDir, "executive-summary.md"),
    technicalAppendix: path.join(finalDir, "technical-appendix.md"),
    boardReport: path.join(finalDir, "board-report.md"),
    boardReportPdf: path.join(finalDir, "board-report.pdf"),
    cehTechnicalReport: path.join(finalDir, "ceh-technical-report.md"),
    cehTechnicalReportPdf: path.join(finalDir, "ceh-technical-report.pdf"),
    ulmTeamReport: path.join(finalDir, "ulm-team-report.md"),
    ulmTeamReportPdf: path.join(finalDir, "ulm-team-report.pdf"),
    runtimeSummaryMarkdown: path.join(finalDir, "runtime-summary.md"),
  }
  const finalTextArtifacts = [
    "report.html",
    "README.md",
    "findings.json",
    "evidence-index.json",
    "people-profiles.md",
    "identity-graph.json",
    "operator-review.md",
    "executive-summary.md",
    "technical-appendix.md",
    "board-report.md",
    "ceh-technical-report.md",
    "ulm-team-report.md",
    "runtime-summary.md",
  ]
  const finalTextArtifactTerms: Record<string, string[]> = {
    "README.md": ["## Files", "## Findings", "## Evidence"],
    "operator-review.md": ["## Handoff State", "## Review Before Client Delivery"],
    "executive-summary.md": ["## Overview", "## Priority Items"],
    "technical-appendix.md": ["## Scope And Methodology", "## Evidence Index"],
    "board-report.md": ["## Executive Decision Summary", "## Recommended Board Actions"],
    "ceh-technical-report.md": ["## Scope And Methodology", "## Validated Findings", "## Evidence Map"],
    "ulm-team-report.md": ["## Harness Run State", "## Supervisor Incidents", "## Residual Harness Risks"],
    "runtime-summary.md": ["# Runtime Summary"],
  }
  const finalOperationTextArtifacts = new Set([
    "README.md",
    "operator-review.md",
    "executive-summary.md",
    "technical-appendix.md",
    "board-report.md",
    "ceh-technical-report.md",
    "ulm-team-report.md",
  ])
  let manifest: Record<string, unknown> | undefined
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    if (isRecord(parsed)) manifest = parsed
    else gaps.push("deliverables/final/manifest.json is not a JSON object")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      gaps.push("deliverables/final/manifest.json is not valid JSON")
    }
  }

  const artifacts = isRecord(manifest?.artifacts) ? manifest.artifacts : undefined
  if (manifest && !artifacts) gaps.push("deliverables/final/manifest.json missing artifacts object")
  for (const [key, expected] of Object.entries(expectedArtifacts)) {
    if (artifacts && !(key in artifacts)) {
      gaps.push(`deliverables/final/manifest.json missing artifact path: ${key}`)
    } else if (artifacts) {
      const actual = manifestPathValue(finalDir, artifacts[key])
      if (!actual || comparableManifestPath(actual) !== comparableManifestPath(expected)) {
        gaps.push(`deliverables/final/manifest.json artifact ${key} does not match ${path.basename(expected)}`)
      }
    }
    const size = await fileSize(expected)
    if (size === 0) gaps.push(`deliverables/final/${path.basename(expected)} is empty`)
  }
  for (const file of finalTextArtifacts) {
    const body = await readText(path.join(finalDir, file))
    if (body !== undefined) {
      gaps.push(...finalReportArtifactSafetyGaps(`deliverables/final/${file}`, body))
      for (const term of finalTextArtifactTerms[file] ?? []) {
        if (!body.includes(term)) gaps.push(`deliverables/final/${file} is missing required section: ${term}`)
      }
      if (finalOperationTextArtifacts.has(file) && !body.includes(`Operation: ${expectedOperationID}`)) {
        gaps.push(`deliverables/final/${file} operationID does not match operation`)
      }
      if (
        file === "ulm-team-report.md" &&
        /## Supervisor Incidents[\s\S]*?-\s+(?!None recorded\.)/i.test(body) &&
        /## Residual Harness Risks[\s\S]*?-\s+No residual harness risks/i.test(body)
      ) {
        gaps.push("deliverables/final/ulm-team-report.md claims no residual harness risks while supervisor incidents exist")
      }
    }
  }

  if (input.requireRuntimeSummary) {
    const runtimeSummary = path.join(root, "deliverables", "runtime-summary.json")
    if (artifacts) {
      const actual = manifestPathValue(finalDir, artifacts.runtimeSummary)
      if (!actual) gaps.push("deliverables/final/manifest.json missing artifact path: runtimeSummary")
      else if (comparableManifestPath(actual) !== comparableManifestPath(runtimeSummary)) {
        gaps.push("deliverables/final/manifest.json artifact runtimeSummary does not match runtime-summary.json")
      }
    }
    if (!(await exists(runtimeSummary))) gaps.push("deliverables/runtime-summary.json is required")
  }

  const pdf = await readText(path.join(finalDir, "report.pdf"))
  if (pdf !== undefined && !pdf.startsWith("%PDF-")) gaps.push("deliverables/final/report.pdf is not a readable PDF")
  if (pdf !== undefined && pdf.startsWith("%PDF-") && !pdf.includes("/ULMCodeRenderer (styled-html)")) {
    gaps.push("deliverables/final/report.pdf missing styled HTML renderer metadata")
  }
  if (pdf !== undefined && pdf.includes("/BaseFont /Helvetica") && !pdf.includes("/ULMCodeRenderer (styled-html)")) {
    gaps.push("deliverables/final/report.pdf was rendered by the legacy text-only renderer")
  }
  if (pdf !== undefined && input.minPdfPages) {
    const pages = pdfPageCount(pdf)
    if (!pages) gaps.push("deliverables/final/report.pdf page count could not be read")
    else if (pages < input.minPdfPages) {
      gaps.push(`deliverables/final/report.pdf has ${pages} pages, expected at least ${input.minPdfPages}`)
    }
  }
  const stakeholderPdfMinimumPages: Record<string, number> = input.requireStakeholderMinimumPages
    ? {
        "board-report.pdf": 2,
        "ceh-technical-report.pdf": 3,
        "ulm-team-report.pdf": 2,
      }
    : {}
  for (const file of ["board-report.pdf", "ceh-technical-report.pdf", "ulm-team-report.pdf"]) {
    const audiencePdf = await readText(path.join(finalDir, file))
    if (audiencePdf !== undefined && !audiencePdf.startsWith("%PDF-")) {
      gaps.push(`deliverables/final/${file} is not a readable PDF`)
    }
    if (audiencePdf !== undefined && audiencePdf.startsWith("%PDF-") && !audiencePdf.includes("/ULMCodeRenderer (styled-html)")) {
      gaps.push(`deliverables/final/${file} missing styled HTML renderer metadata`)
    }
    if (audiencePdf !== undefined && input.minPdfPages) {
      const pages = pdfPageCount(audiencePdf)
      if (!pages) gaps.push(`deliverables/final/${file} page count could not be read`)
    }
    const minimumPages = stakeholderPdfMinimumPages[file]
    if (audiencePdf !== undefined && minimumPages) {
      const pages = pdfPageCount(audiencePdf)
      if (!pages) gaps.push(`deliverables/final/${file} page count could not be read`)
      else if (pages < minimumPages) {
        gaps.push(`deliverables/final/${file} has ${pages} pages, expected at least ${minimumPages}`)
      }
    }
  }
  const html = await readText(path.join(finalDir, "report.html"))
  if (html !== undefined) {
    const lowerHtml = html.toLowerCase()
    if (!lowerHtml.includes("<!doctype html") || !lowerHtml.includes("<html")) {
      gaps.push("deliverables/final/report.html is not readable HTML")
    }
    for (const term of [expectedOperationID, "Finding State Counts"]) {
      if (!html.includes(term)) gaps.push(`deliverables/final/report.html is missing required content: ${term}`)
    }
  }
  await parseRequiredJson(path.join(finalDir, "findings.json"), "deliverables/final/findings.json", gaps)
  await parseRequiredJson(path.join(finalDir, "evidence-index.json"), "deliverables/final/evidence-index.json", gaps)
  await parseRequiredJson(path.join(finalDir, "identity-graph.json"), "deliverables/final/identity-graph.json", gaps)
  const finalFindings = await readJson<Record<string, unknown>>(path.join(finalDir, "findings.json"))
  const finalEvidenceIndex = await readJson<Record<string, unknown>>(path.join(finalDir, "evidence-index.json"))
  const finalIdentityGraph = await readJson<Record<string, unknown>>(path.join(finalDir, "identity-graph.json"))
  if (manifest?.operationID !== undefined && manifest.operationID !== expectedOperationID) {
    gaps.push("deliverables/final/manifest.json operationID does not match operation")
  }
  if (finalFindings?.operationID !== undefined && finalFindings.operationID !== expectedOperationID) {
    gaps.push("deliverables/final/findings.json operationID does not match operation")
  }
  if (finalEvidenceIndex?.operationID !== undefined && finalEvidenceIndex.operationID !== expectedOperationID) {
    gaps.push("deliverables/final/evidence-index.json operationID does not match operation")
  }
  if (finalIdentityGraph?.operationID !== undefined && finalIdentityGraph.operationID !== expectedOperationID) {
    gaps.push("deliverables/final/identity-graph.json operationID does not match operation")
  }
  if (manifest && finalFindings && finalEvidenceIndex) {
    const reportable = Array.isArray(finalFindings.reportable) ? finalFindings.reportable : []
    const retained = Array.isArray(finalFindings.retained) ? finalFindings.retained : []
    const evidence = Array.isArray(finalEvidenceIndex.evidence) ? finalEvidenceIndex.evidence : []
    const manifestCounts = isRecord(manifest.counts) ? manifest.counts : undefined
    if (!manifestCounts) {
      gaps.push("deliverables/final/manifest.json missing counts object")
    } else {
      const byState = isRecord(finalFindings.counts) ? finalFindings.counts : undefined
      if (manifestCounts.findings !== reportable.length + retained.length) {
        gaps.push("deliverables/final/manifest.json findings count does not match findings.json")
      }
      if (manifestCounts.reportableFindings !== reportable.length) {
        gaps.push("deliverables/final/manifest.json reportableFindings count does not match findings.json")
      }
      if (manifestCounts.nonReportableFindings !== retained.length) {
        gaps.push("deliverables/final/manifest.json nonReportableFindings count does not match findings.json")
      }
      if (manifestCounts.evidence !== evidence.length) {
        gaps.push("deliverables/final/manifest.json evidence count does not match evidence-index.json")
      }
      if (byState && JSON.stringify(manifestCounts.byState ?? {}) !== JSON.stringify(byState)) {
        gaps.push("deliverables/final/manifest.json byState counts do not match findings.json")
      }
    }
    const reportableIDs = arrayIDs(finalFindings.reportable)
    const retainedIDs = arrayIDs(finalFindings.retained)
    const evidenceIDs = arrayIDs(finalEvidenceIndex.evidence)
    const evidenceIDSet = new Set(evidenceIDs)
    if (!sameStringArray(arrayIDs(manifest.findings), reportableIDs)) {
      gaps.push("deliverables/final/manifest.json findings list does not match findings.json")
    }
    if (!sameStringArray(arrayIDs(manifest.nonReportableFindings), retainedIDs)) {
      gaps.push("deliverables/final/manifest.json nonReportableFindings list does not match findings.json")
    }
    if (!sameStringArray(arrayIDs(manifest.evidence), evidenceIDs)) {
      gaps.push("deliverables/final/manifest.json evidence list does not match evidence-index.json")
    }
    const evidenceIDsByPath = new Map<string, string[]>()
    for (const item of evidence) {
      if (!isRecord(item)) continue
      const id = typeof item.id === "string" ? item.id : undefined
      const itemPath = typeof item.path === "string" ? item.path : undefined
      if (!id || !itemPath) continue
      evidenceIDsByPath.set(itemPath, [...(evidenceIDsByPath.get(itemPath) ?? []), id])
    }
    const referencedBy = new Map<string, string[]>()
    for (const finding of [...reportable, ...retained]) {
      if (!isRecord(finding)) continue
      const findingID = typeof finding.findingID === "string" ? finding.findingID : "unknown-finding"
      const refs = Array.isArray(finding.evidence) ? finding.evidence : []
      for (const ref of refs) {
        if (!isRecord(ref)) continue
        const id = typeof ref.id === "string" ? ref.id : undefined
        const refPath = typeof ref.path === "string" ? ref.path : undefined
        const matchedIDs = [
          ...(id && evidenceIDSet.has(id) ? [id] : []),
          ...(refPath ? (evidenceIDsByPath.get(refPath) ?? []) : []),
        ].filter((value, index, values) => values.indexOf(value) === index)
        if (id && !matchedIDs.length) {
          gaps.push(`deliverables/final/findings.json ${findingID} references missing evidence ${id}`)
        }
        for (const matchedID of matchedIDs) {
          referencedBy.set(
            matchedID,
            [...(referencedBy.get(matchedID) ?? []), findingID].sort((left, right) => left.localeCompare(right)),
          )
        }
      }
    }
    for (const item of evidence) {
      if (!isRecord(item)) continue
      const id = typeof item.id === "string" ? item.id : undefined
      if (!id) continue
      const actual = arrayIDs(item.referencedBy)
      const expected = referencedBy.get(id) ?? []
      if (!sameStringArray(actual, expected)) {
        gaps.push(`deliverables/final/evidence-index.json ${id} referencedBy does not match findings.json`)
      }
    }
  }

  const sourceRuntimeMarkdown = await readText(path.join(root, "deliverables", "runtime-summary.md"))
  const finalRuntimeMarkdown = await readText(path.join(finalDir, "runtime-summary.md"))
  if (
    sourceRuntimeMarkdown !== undefined &&
    finalRuntimeMarkdown !== undefined &&
    sourceRuntimeMarkdown !== finalRuntimeMarkdown
  ) {
    gaps.push("deliverables/final/runtime-summary.md does not match deliverables/runtime-summary.md")
  }
  return gaps
}

function renderReportSections(input: {
  outline: string | undefined
  operation: OperationRecord | undefined
  plan: OperationPlanRecord | undefined
  reportable: FindingRecord[]
  nonReportable: FindingRecord[]
  evidence: EvidenceRecord[]
  counts: Record<FindingState, number>
}) {
  const assets = [...new Set(input.reportable.flatMap((finding) => finding.affectedAssets))].sort()
  const evidenceKinds = [...new Set(input.evidence.map((item) => item.kind))].sort()
  return reportOutlineTitles(input.outline)
    .map((title) => {
      const normalized = normalizeSectionTitle(title)
      if (normalized.includes("executive summary")) {
        return `<section class="report-section executive-summary">
  <h2>${escapeHtml(title)}</h2>
  <p class="lede">${escapeHtml(input.operation?.summary ?? "No operation summary has been recorded.")}</p>
  <div class="metric-grid">
    ${renderMetricCard("Report-Ready Findings", String(input.reportable.length), "validated findings ready for stakeholder review")}
    ${renderMetricCard("Evidence Records", String(input.evidence.length), "stored references behind report claims")}
    ${renderMetricCard("Retained Leads", String(input.nonReportable.length), "candidate, rejected, or unresolved observations preserved for review")}
    ${renderMetricCard("Current Risk", input.operation?.riskLevel ?? "unknown", "operation-level risk posture from the ledger")}
  </div>
  <p>This handoff separates confirmed risk from unresolved observations so board members, staff, and CEH reviewers can make decisions without mistaking raw lead volume for validated exposure.</p>
</section>`
      }
      if (normalized.includes("scope") && normalized.includes("methodology")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>${escapeHtml(input.operation?.objective ?? "No objective has been recorded.")}</p>
  <p>Testing followed the recorded operation plan, preserved raw support through evidence records, promoted only evidence-backed findings, and used stage, lint, render, runtime, and audit gates before handoff.</p>
  <p>Assumptions: ${escapeHtml(input.plan?.assumptions?.join("; ") || "No explicit assumptions were recorded.")}</p>
</section>`
      }
      if (normalized.includes("environment overview")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>Recorded affected assets include ${escapeHtml(assets.join(", ") || "none recorded")}. Evidence kinds represented in the ledger include ${escapeHtml(evidenceKinds.join(", ") || "none recorded")}.</p>
  <p>District and public system context should be read from profiles/district-profile.md when present. The environment overview is intentionally limited to operation artifacts and synthetic evidence available at render time, so unverified systems are not invented in the client deliverable.</p>
</section>`
      }
      if (normalized.includes("people") || normalized.includes("identity graph")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>People, role, application, group, and data-system relationships are tracked in profiles/people/ and profiles/identity-graph.json so authority and workflow risk can be reviewed separately from network exposure.</p>
  <p>Public role inferences should be treated as hypotheses until validated with authorized identity exports, SaaS role review, or authenticated workflow testing.</p>
</section>`
      }
      if (normalized.includes("attack path")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>The confirmed attack narrative is derived from report-ready findings only: ${escapeHtml(
    input.reportable.map((finding) => `${finding.findingID}: ${finding.description}`).join(" ") ||
      "no report-ready attack path was recorded",
  )}</p>
  <p>Rejected and candidate observations are retained separately so the report does not overstate exploitability or imply validation that did not happen.</p>
</section>`
      }
      if (normalized.includes("findings detail")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>Each detailed finding below includes severity, confidence, affected assets, description, impact, remediation, and evidence references from the durable operation ledger.</p>
  ${renderFindingSections(input.reportable)}
</section>`
      }
      if (normalized.includes("risk register") || normalized.includes("roadmap")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>The prioritized remediation roadmap should start with critical and high severity report-ready findings, then address medium and low items based on affected assets, exploitability, and operational owner availability.</p>
  <div class="roadmap-list">${renderFindingRoadmapCards(input.reportable)}</div>
</section>`
      }
      if (normalized.includes("validation limits") || normalized.includes("known unknowns")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>Validation limits are represented by unresolved or rejected findings, recorded blockers, and missing evidence. Current blockers: ${escapeHtml(
    input.operation?.blockers?.join("; ") || "No blockers recorded.",
  )}</p>
  <div class="validation-list">${renderNonReportableCards(input.nonReportable)}</div>
</section>`
      }
      if (
        normalized.includes("coverage") ||
        normalized.includes("browser evidence") ||
        normalized.includes("testing limits")
      ) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>This section summarizes what the operation actually touched, where browser evidence exists, and where confidence is limited by scope, time, authentication, tooling, or unresolved blockers.</p>
  <p>Current affected assets from validated/report-ready findings: ${escapeHtml(assets.join(", ") || "none recorded")}.</p>
  <p>Browser evidence should be reviewed under browser/ and evidence/ when present. Missing browser artifacts are a testing limitation, not proof of absence.</p>
</section>`
      }
      if (normalized.includes("evidence map")) {
        return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>The Evidence Index maps report claims back to stored evidence identifiers and paths, keeping the handoff reviewable after context compaction or process restart.</p>
  <div class="evidence-grid">${renderEvidenceCards(input.evidence)}</div>
</section>`
      }
      if (normalized.includes("operator handoff")) {
        return `<section class="report-section handoff-checklist">
  <h2>${escapeHtml(title)}</h2>
  <ul>
    <li>Review report-ready findings and their evidence paths before sending externally.</li>
    <li>Review candidate, needs-validation, and rejected findings so known unknowns are not lost.</li>
    <li>Confirm runtime_summary and operation_audit exist for unattended-run accountability.</li>
    <li>Run report_lint with finalHandoff=true after any manual report edits.</li>
    <li>Use the operation memory file for internal continuation notes only; do not include it in customer deliverables.</li>
  </ul>
</section>`
      }
      if (normalized.includes("appendix") || normalized.includes("raw evidence")) {
        return `<section class="report-section appendix">
  <h2>${escapeHtml(title)}</h2>
  <p>The raw evidence appendix preserves command outputs, HTTP responses, files, screenshots, notes, and logs that support the report. Reviewers should use these paths to verify each claim before remediation planning.</p>
  <div class="evidence-grid compact">${renderEvidenceCards(input.evidence)}</div>
</section>`
      }
      return `<section class="report-section">
  <h2>${escapeHtml(title)}</h2>
  <p>This section is reserved by the report outline. The current render uses available operation summary, findings, evidence, blockers, and runtime artifacts to avoid inventing details beyond the durable ledger.</p>
</section>`
    })
    .join("\n")
}

async function peopleProfilesMarkdown(root: string) {
  const peopleDir = path.join(root, "profiles", "people")
  try {
    const files = (await fs.readdir(peopleDir))
      .filter((file) => file.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b))
    if (!files.length) return "# People Profiles\n\nNo person profiles were recorded.\n"
    const bodies = await Promise.all(
      files.map(async (file) =>
        (await fs.readFile(path.join(peopleDir, file), "utf8")).replace(
          /\n## Excluded Private\/Irrelevant Information\n[\s\S]*?(?=\n## |\n?$)/g,
          "\n",
        ),
      ),
    )
    return ["# People Profiles", "", ...bodies].join("\n")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return "# People Profiles\n\nNo person profiles were recorded.\n"
    throw error
  }
}

export async function renderReport(worktree: string, input: ReportRenderInput): Promise<ReportRenderResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const operation = await readJson<OperationRecord>(path.join(root, "operation.json"))
  const plan = await readJson<OperationPlanRecord>(path.join(root, "plans", "operation-plan.json"))
  const outline = await readText(path.join(root, "reports", "report-outline.md"))
  const findings = await readFindings(root)
  const evidence = await readEvidenceRecords(root)
  const authoredReport = await readAuthoredReport(root)
  const reportable = findings.filter((finding) => finding.state === "report_ready" || finding.state === "validated")
  const nonReportable = findings.filter((finding) => finding.state !== "report_ready" && finding.state !== "validated")
  const counts = findingCounts(findings)
  const runtimeSummaryMarkdownSource = await readText(path.join(root, "deliverables", "runtime-summary.md"))
  const runtimeSummaryExists = Boolean(runtimeSummaryMarkdownSource)
  const supervisorIncidents = await supervisorIncidentSummaries(root)
  const title = input.title ?? operation?.objective ?? `ULMCode Operation ${operationID}`
  const sectionTitles = reportOutlineTitles(outline)
  const finalDir = path.join(root, "deliverables", "final")
  const reportBody = authoredReport
    ? authoredReportBody(authoredReport)
    : renderReportSections({ outline, operation, plan, reportable, nonReportable, evidence, counts })
  const internalReviewEntries: InternalReviewEntry[] = []
  const finalReportBody = sanitizedFinalArtifact("deliverables/final/report.html", reportBody, internalReviewEntries) as string
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --ink: #111318;
      --muted: #5c6573;
      --rule: #d9dde5;
      --paper: #f6f1e8;
      --panel: #fffefa;
      --panel-strong: #171a20;
      --accent: #9b611d;
      --accent-deep: #633b10;
      --accent-soft: #f1dfc7;
      --blue: #204d72;
      --green: #28705b;
      --red: #9b2f27;
    }
    * { box-sizing: border-box; }
    html { background: var(--paper); }
    body {
      font-family: "Avenir Next", "Helvetica Neue", Arial, sans-serif;
      color: var(--ink);
      background: linear-gradient(90deg, rgba(155,97,29,0.08), transparent 22rem), var(--paper);
      margin: 0;
      line-height: 1.58;
    }
    main { max-width: 1040px; margin: 0 auto; padding: 46px; }
    h1, h2, h3 { line-height: 1.12; letter-spacing: 0; }
    h1 { font-size: 46px; margin: 0 0 14px; max-width: 860px; }
    h2 { border-top: 2px solid var(--ink); padding-top: 18px; margin-top: 42px; font-size: 25px; }
    h3 { font-size: 18px; margin: 0 0 10px; }
    p { max-width: 920px; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0 24px; background: var(--panel); }
    th, td { border: 1px solid var(--rule); padding: 9px 10px; text-align: left; vertical-align: top; }
    th { background: var(--accent-soft); color: var(--ink); font-size: 12px; text-transform: uppercase; letter-spacing: 0; }
    ul { padding-left: 22px; }
    .report-cover {
      min-height: 540px;
      display: grid;
      align-content: space-between;
      border-bottom: 1px solid rgba(17,19,24,0.22);
      padding-bottom: 34px;
      position: relative;
    }
    .report-cover::before {
      content: "";
      position: absolute;
      inset: 0 auto auto -46px;
      width: 10px;
      height: 100%;
      background: linear-gradient(var(--accent), var(--blue));
    }
    .cover-kicker, .card-kicker {
      color: var(--accent-deep);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .meta {
      color: var(--muted);
      border-left: 4px solid var(--accent);
      padding-left: 12px;
      margin-bottom: 28px;
      max-width: 760px;
    }
    .lede { font-size: 20px; line-height: 1.42; max-width: 820px; }
    .toc {
      background: var(--panel);
      border: 1px solid rgba(17,19,24,0.18);
      padding: 22px;
      margin: 34px 0 10px;
    }
    .toc ol { columns: 2; margin: 0; padding-left: 20px; }
    .toc li { break-inside: avoid; margin: 0 0 8px; color: var(--muted); }
    .metric-grid, .evidence-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
      margin: 18px 0 28px;
    }
    .metric-card, .evidence-card, .roadmap-card, .validation-card, .finding {
      background: var(--panel);
      border: 1px solid rgba(17,19,24,0.16);
      box-shadow: 0 10px 24px rgba(17,19,24,0.06);
      page-break-inside: avoid;
    }
    .metric-card { padding: 18px; }
    .metric-value { font-size: 30px; font-weight: 800; color: var(--panel-strong); }
    .metric-label { font-weight: 800; margin-top: 2px; }
    .metric-card p, .evidence-card p, .roadmap-card p, .validation-card p { margin-bottom: 0; }
    .report-section { margin: 34px 0; }
    .finding, .roadmap-card, .validation-card, .evidence-card { padding: 18px; margin: 16px 0; }
    .finding-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      border-bottom: 1px solid var(--rule);
      padding-bottom: 12px;
      margin-bottom: 12px;
    }
    .severity-pill {
      background: var(--panel-strong);
      color: #fff;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .severity-critical .severity-pill, .severity-critical { border-color: rgba(155,47,39,0.5); }
    .severity-high .severity-pill { background: var(--red); }
    .severity-medium .severity-pill { background: var(--accent-deep); }
    .severity-low .severity-pill { background: var(--green); }
    .finding-meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; }
    .finding-meta span {
      background: var(--accent-soft);
      border: 1px solid rgba(99,59,16,0.18);
      padding: 5px 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .roadmap-list, .validation-list { display: grid; gap: 12px; }
    .appendix .evidence-grid.compact { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
    @page { margin: 0.62in; }
    @media print {
      body { background: white; }
      main { max-width: none; padding: 0; }
      .report-cover { min-height: 8.6in; page-break-after: always; }
      .toc { page-break-after: always; }
      .metric-card, .evidence-card, .roadmap-card, .validation-card, .finding { box-shadow: none; }
    }
  </style>
</head>
<body>
  <main>
    <section class="report-cover">
      <div>
        <div class="cover-kicker">ULMCode final security report</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="meta">Operation: ${escapeHtml(operationID)} | Stage: ${escapeHtml(operation?.stage ?? "unknown")} | Status: ${escapeHtml(operation?.status ?? "unknown")}</p>
      </div>
      <div class="metric-grid">
        ${renderMetricCard("Validated + Report Ready", String(counts.validated + counts.report_ready), "findings promoted beyond raw candidate state")}
        ${renderMetricCard("Candidate / Needs Validation", String(counts.candidate + counts.needs_validation), "items still requiring reviewer judgment")}
        ${renderMetricCard("Rejected", String(counts.rejected), "leads retained but excluded from the client risk narrative")}
      </div>
    </section>
    <nav class="toc" role="doc-toc" aria-label="Table of contents">
      <h2>Table Of Contents</h2>
      <ol>
        <li>Finding State Counts</li>
        ${sectionTitles.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n        ")}
      </ol>
    </nav>
    <section class="report-section finding-state-counts">
      <h2>Finding State Counts</h2>
      <div class="metric-grid">
        ${renderMetricCard("Candidate", String(counts.candidate), "raw observations not ready for stakeholder action")}
        ${renderMetricCard("Needs Validation", String(counts.needs_validation), "items that need more evidence before promotion")}
        ${renderMetricCard("Validated", String(counts.validated), "confirmed issues awaiting final report polish")}
        ${renderMetricCard("Report Ready", String(counts.report_ready), "validated findings ready for distribution")}
        ${renderMetricCard("Rejected", String(counts.rejected), "discarded or out-of-scope observations")}
      </div>
    </section>
    ${finalReportBody}
  </main>
</body>
</html>
`
  await fs.mkdir(finalDir, { recursive: true })
  const internalReviewDir = path.join(root, "deliverables", "internal-review")
  const htmlPath = path.join(finalDir, "report.html")
  const pdfPath = path.join(finalDir, "report.pdf")
  const readmePath = path.join(finalDir, "README.md")
  const manifestPath = path.join(finalDir, "manifest.json")
  const internalReviewMarkdownPath = path.join(internalReviewDir, "sensitive-leads.md")
  const internalReviewJsonPath = path.join(internalReviewDir, "sensitive-leads.json")
  const findingsJsonPath = path.join(finalDir, "findings.json")
  const evidenceIndexPath = path.join(finalDir, "evidence-index.json")
  const peopleProfilesPath = path.join(finalDir, "people-profiles.md")
  const identityGraphPath = path.join(finalDir, "identity-graph.json")
  const operatorReviewPath = path.join(finalDir, "operator-review.md")
  const executiveSummaryPath = path.join(finalDir, "executive-summary.md")
  const technicalAppendixPath = path.join(finalDir, "technical-appendix.md")
  const boardReportPath = path.join(finalDir, "board-report.md")
  const boardReportPdfPath = path.join(finalDir, "board-report.pdf")
  const cehTechnicalReportPath = path.join(finalDir, "ceh-technical-report.md")
  const cehTechnicalReportPdfPath = path.join(finalDir, "ceh-technical-report.pdf")
  const ulmTeamReportPath = path.join(finalDir, "ulm-team-report.md")
  const ulmTeamReportPdfPath = path.join(finalDir, "ulm-team-report.pdf")
  const runtimeSummaryMarkdownPath = path.join(finalDir, "runtime-summary.md")
  const readme = finalReadme({ title, operationID, operation, reportable, nonReportable, evidence })
  const finalFindings = finalFindingsJson({ operationID, reportable, nonReportable, counts })
  const evidenceIndex = finalEvidenceIndexJson({ operationID, evidence, findings })
  const peopleProfiles = await peopleProfilesMarkdown(root)
  const fallbackIdentityGraph = {
    operationID,
    nodes: [],
    edges: [],
    notes: ["No identity graph was recorded before report rendering."],
  }
  const identityGraphSource = await readText(path.join(root, "profiles", "identity-graph.json"))
  const identityGraph = identityGraphSource ? JSON.parse(identityGraphSource) : fallbackIdentityGraph
  const operatorReview = operatorReviewMarkdown({
    operationID,
    operation,
    reportable,
    nonReportable,
    evidence,
    runtimeSummaryExists,
  })
  const executiveSummary = executiveSummaryMarkdown({ title, operationID, operation, reportable, evidence, counts })
  const technicalAppendix = technicalAppendixMarkdown({ operationID, operation, plan, reportable, nonReportable, evidence })
  const boardReport = boardReportMarkdown({ title, operationID, operation, reportable, evidence, counts })
  const cehTechnicalReport = cehTechnicalReportMarkdown({
    operationID,
    operation,
    plan,
    reportable,
    nonReportable,
    evidence,
  })
  const ulmTeamReport = ulmTeamReportMarkdown({
    operationID,
    operation,
    reportable,
    nonReportable,
    evidence,
    runtimeSummaryExists,
    supervisorIncidents,
  })
  const finalRuntimeSummary =
    runtimeSummaryMarkdownSource ?? "# Runtime Summary\n\nNo runtime summary was recorded before report rendering.\n"
  const finalArtifacts: Array<[string, unknown]> = [
    ["deliverables/final/report.html", html],
    ["deliverables/final/README.md", readme],
    ["deliverables/final/findings.json", finalFindings],
    ["deliverables/final/evidence-index.json", evidenceIndex],
    ["deliverables/final/people-profiles.md", peopleProfiles],
    ["deliverables/final/identity-graph.json", identityGraph],
    ["deliverables/final/operator-review.md", operatorReview],
    ["deliverables/final/executive-summary.md", executiveSummary],
    ["deliverables/final/technical-appendix.md", technicalAppendix],
    ["deliverables/final/board-report.md", boardReport],
    ["deliverables/final/ceh-technical-report.md", cehTechnicalReport],
    ["deliverables/final/ulm-team-report.md", ulmTeamReport],
    ["deliverables/final/runtime-summary.md", finalRuntimeSummary],
  ]
  const sanitizedFinalArtifacts = finalArtifacts.map(
    ([label, value]) => [label, sanitizedFinalArtifact(label, value, internalReviewEntries)] as const,
  )
  for (const [label, value] of sanitizedFinalArtifacts) {
    assertFinalReportArtifactSafe(label, value)
    assertOperationArtifactSafe(operationID, label, value)
  }
  const finalArtifactMap = new Map(sanitizedFinalArtifacts)
  const sanitizedHtml = finalArtifactMap.get("deliverables/final/report.html") as string
  const sanitizedReadme = finalArtifactMap.get("deliverables/final/README.md") as string
  const sanitizedFindingsJson = finalArtifactMap.get("deliverables/final/findings.json")
  const sanitizedEvidenceIndex = finalArtifactMap.get("deliverables/final/evidence-index.json")
  const sanitizedPeopleProfiles = finalArtifactMap.get("deliverables/final/people-profiles.md") as string
  const sanitizedIdentityGraph = finalArtifactMap.get("deliverables/final/identity-graph.json")
  const sanitizedOperatorReview = finalArtifactMap.get("deliverables/final/operator-review.md") as string
  const sanitizedExecutiveSummary = finalArtifactMap.get("deliverables/final/executive-summary.md") as string
  const sanitizedTechnicalAppendix = finalArtifactMap.get("deliverables/final/technical-appendix.md") as string
  const sanitizedBoardReport = finalArtifactMap.get("deliverables/final/board-report.md") as string
  const sanitizedCehTechnicalReport = finalArtifactMap.get("deliverables/final/ceh-technical-report.md") as string
  const sanitizedUlmTeamReport = finalArtifactMap.get("deliverables/final/ulm-team-report.md") as string
  const sanitizedRuntimeSummary = finalArtifactMap.get("deliverables/final/runtime-summary.md") as string

  await fs.mkdir(internalReviewDir, { recursive: true })
  await fs.writeFile(htmlPath, sanitizedHtml)
  await fs.writeFile(pdfPath, buildStyledPdf({ title, operationID, operation, reportHtml: sanitizedHtml }))
  await fs.writeFile(readmePath, sanitizedReadme)
  await writeJson(findingsJsonPath, sanitizedFindingsJson)
  await writeJson(evidenceIndexPath, sanitizedEvidenceIndex)
  await fs.writeFile(peopleProfilesPath, sanitizedPeopleProfiles)
  await writeJson(identityGraphPath, sanitizedIdentityGraph)
  await fs.writeFile(operatorReviewPath, sanitizedOperatorReview)
  await fs.writeFile(executiveSummaryPath, sanitizedExecutiveSummary)
  await fs.writeFile(technicalAppendixPath, sanitizedTechnicalAppendix)
  await fs.writeFile(boardReportPath, sanitizedBoardReport)
  await fs.writeFile(
    boardReportPdfPath,
    buildStyledPdf({
      title: "Board Report",
      operationID,
      operation,
      reportHtml: audienceReportHtml({ title: "Board Report", markdown: sanitizedBoardReport }),
      minPages: 2,
    }),
  )
  await fs.writeFile(cehTechnicalReportPath, sanitizedCehTechnicalReport)
  await fs.writeFile(
    cehTechnicalReportPdfPath,
    buildStyledPdf({
      title: "CEH Technical Report",
      operationID,
      operation,
      reportHtml: audienceReportHtml({ title: "CEH Technical Report", markdown: sanitizedCehTechnicalReport }),
      minPages: 3,
    }),
  )
  await fs.writeFile(ulmTeamReportPath, sanitizedUlmTeamReport)
  await fs.writeFile(
    ulmTeamReportPdfPath,
    buildStyledPdf({
      title: "ULMCode Team Report",
      operationID,
      operation,
      reportHtml: audienceReportHtml({ title: "ULMCode Team Report", markdown: sanitizedUlmTeamReport }),
      minPages: 2,
    }),
  )
  await fs.writeFile(runtimeSummaryMarkdownPath, sanitizedRuntimeSummary)
  await fs.writeFile(internalReviewMarkdownPath, internalSensitiveReviewMarkdown(operationID, internalReviewEntries))
  await writeJson(internalReviewJsonPath, {
    operationID,
    generatedAt: new Date().toISOString(),
    entries: internalReviewEntries,
  })
  await writeJson(manifestPath, {
    operationID,
    title,
    generatedAt: new Date().toISOString(),
    artifacts: {
      status: path.join(root, "status.md"),
      operationPlan: path.join(root, "plans", "operation-plan.json"),
      html: htmlPath,
      pdf: pdfPath,
      readme: readmePath,
      findingsJson: findingsJsonPath,
      evidenceIndex: evidenceIndexPath,
      peopleProfiles: peopleProfilesPath,
      identityGraph: identityGraphPath,
      operatorReview: operatorReviewPath,
      executiveSummary: executiveSummaryPath,
      technicalAppendix: technicalAppendixPath,
      boardReport: boardReportPath,
      boardReportPdf: boardReportPdfPath,
      cehTechnicalReport: cehTechnicalReportPath,
      cehTechnicalReportPdf: cehTechnicalReportPdfPath,
      ulmTeamReport: ulmTeamReportPath,
      ulmTeamReportPdf: ulmTeamReportPdfPath,
      runtimeSummaryMarkdown: runtimeSummaryMarkdownPath,
      reportOutline: path.join(root, "reports", "report-outline.md"),
      evidence: path.join(root, "evidence"),
      runtimeSummary: path.join(root, "deliverables", "runtime-summary.json"),
    },
    counts: {
      findings: findings.length,
      reportableFindings: reportable.length,
      nonReportableFindings: nonReportable.length,
      byState: counts,
      evidence: evidence.length,
    },
    findings: reportable.map((finding) => finding.findingID),
    nonReportableFindings: nonReportable.map((finding) => finding.findingID),
    evidence: evidence.map((item) => ({
      id: item.evidenceID,
      kind: item.kind,
      title: item.title,
      path: item.path,
    })),
  })
  await publishOperationUpdated(worktree, { operationID, artifact: "report_render", path: manifestPath })
  return {
    operationID,
    html: htmlPath,
    pdf: pdfPath,
    readme: readmePath,
    manifest: manifestPath,
    internalReviewMarkdown: internalReviewMarkdownPath,
    internalReviewJson: internalReviewJsonPath,
    findingsJson: findingsJsonPath,
    evidenceIndex: evidenceIndexPath,
    operatorReview: operatorReviewPath,
    executiveSummary: executiveSummaryPath,
    technicalAppendix: technicalAppendixPath,
    boardReport: boardReportPath,
    boardReportPdf: boardReportPdfPath,
    cehTechnicalReport: cehTechnicalReportPath,
    cehTechnicalReportPdf: cehTechnicalReportPdfPath,
    ulmTeamReport: ulmTeamReportPath,
    ulmTeamReportPdf: ulmTeamReportPdfPath,
    runtimeSummaryMarkdown: runtimeSummaryMarkdownPath,
    finalDir,
    findings: reportable.length,
  }
}
