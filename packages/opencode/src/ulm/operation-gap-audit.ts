import fs from "fs/promises"
import path from "path"
import {
  evaluateCoverageReadiness,
  operationPath,
  readCoverageContract,
  readEvidenceRecords,
  readFindings,
  readOperationStatus,
  slug,
  type CoverageReadiness,
} from "./artifact"
import { containsRawCredentialSecret } from "./credential-safety"
import type { WorkQueueRecord, WorkUnit } from "./work-queue"

export type CoverageGapCategory =
  | "asset_inventory"
  | "identity_auth"
  | "credentialed_review"
  | "wireless"
  | "web_authz"
  | "third_party"
  | "vulnerability_validation"
  | "attack_graph"
  | "reporting"
  | "queue_health"
  | "coverage_contract"

export type OperationGapSeverity = "low" | "medium" | "high" | "blocks_release"

export type OperationCoverageGap = {
  id: string
  category: CoverageGapCategory
  severity: OperationGapSeverity
  blocksRelease: boolean
  summary: string
  evidenceNeeded: string[]
  suggestedWorkUnitKinds: string[]
  staleAfterMinutes: number
}

export type OperationNextWorkSeed = {
  id: string
  kind: string
  priority: number
  category: CoverageGapCategory
  rationale: string
  expectedArtifacts: string[]
  safety: "non_destructive" | "requires_operator"
  maxDurationMinutes: number
  stopCondition: string
}

export type OperationProgressMetrics = {
  newAssetsLastHour: number
  newEvidenceLastHour: number
  newValidatedFindingsLastHour: number
  newRejectedHypothesesLastHour: number
  repeatedCommandsLastHour: number
  queueDepth: number
  staleWorkUnits: number
  coverageGapCount: number
  reportCompletenessScore: number
}

export type OperationCoverageConfidence = {
  category: CoverageGapCategory
  breadth: number
  depth: number
  freshness: number
  validation: number
  negativeTesting: number
  confidence: number
}

export type OperationWorldModel = {
  assets: Array<{ id: string; label: string; source: string }>
  accounts: Array<{ id: string; label: string; source: string }>
  roles: Array<{ id: string; label: string; source: string }>
  systems: Array<{ id: string; label: string; source: string }>
  apps: Array<{ id: string; label: string; source: string }>
  services: Array<{ id: string; label: string; source: string }>
  authEdges: Array<{ from: string; to: string; relationship: string; evidence: string[]; confidence?: string }>
  evidence: Array<{ id: string; kind: string; summary: string; path?: string }>
  findings: Array<{ id: string; state: string; severity: string; assets: string[]; evidence: string[] }>
  hypotheses: Array<{ id: string; summary: string; evidence: string[] }>
  negativeSpace: Array<{ id: string; category: CoverageGapCategory; evidenceNeeded: string[] }>
  testedControls: Array<{ id: string; status: "validated" | "rejected"; evidence: string[] }>
  unresolvedQuestions: Array<{ id: string; question: string; suggestedWork: string[] }>
}

export type OperationGapAuditResult = {
  operationID: string
  generatedAt: string
  runtimeRemainingSeconds?: number
  releaseReady: boolean
  coverage: CoverageReadiness
  coverageConfidence: OperationCoverageConfidence[]
  worldModel: OperationWorldModel
  progress: OperationProgressMetrics
  gaps: OperationCoverageGap[]
  nextWorkUnitSeeds: OperationNextWorkSeed[]
  files: {
    json: string
    markdown: string
  }
}

type LeadsRecord = {
  leads?: Array<{ id?: string; kind?: string; asset?: string; host?: string; url?: string }>
}

type IdentityGraphRecord = {
  nodes?: Array<{ id?: string; kind?: string; label?: string; source?: string }>
  edges?: Array<{ from?: string; to?: string; relationship?: string; evidence?: string[]; confidence?: string }>
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function readUnknownJsonFiles(dir: string): Promise<unknown[]> {
  try {
    const files = await fs.readdir(dir)
    const records = await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => readJson<unknown>(path.join(dir, file))))
    return records.filter((record) => Boolean(record))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function updatedWithin(value: string | undefined, now: Date, minutes: number) {
  if (!value) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && now.getTime() - parsed <= minutes * 60 * 1000
}

function staleRunningWorkUnits(units: WorkUnit[], now: Date, staleAfterMinutes: number) {
  return units.filter((unit) => unit.status === "running" && !unit.jobID && !updatedWithin(unit.updatedAt, now, staleAfterMinutes))
}

function repeatedRecentCommands(units: WorkUnit[], now: Date) {
  const recent = units.filter((unit) => updatedWithin(unit.updatedAt, now, 60))
  const counts = new Map<string, number>()
  for (const unit of recent) {
    const key = `${unit.profileID}:${JSON.stringify(Object.entries(unit.variables).toSorted())}`
    counts.set(key, (counts.get(key) ?? 0) + Math.max(1, unit.attempts))
  }
  return [...counts.values()].filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0)
}

function addEntity(
  entities: Map<string, { id: string; label: string; source: string }>,
  value: string | undefined,
  source: string,
) {
  const id = value?.trim()
  if (!id) return
  if (!entities.has(id)) entities.set(id, { id, label: id, source })
}

function entitiesFor(
  identityGraph: IdentityGraphRecord | undefined,
  kind: string,
  fallback: Map<string, { id: string; label: string; source: string }> = new Map(),
) {
  const entities = new Map(fallback)
  for (const node of identityGraph?.nodes ?? []) {
    if (node.kind !== kind || !node.id) continue
    entities.set(node.id, { id: node.id, label: node.label ?? node.id, source: node.source ?? "identity-graph" })
  }
  return [...entities.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function authEdgesFor(identityGraph: IdentityGraphRecord | undefined): OperationWorldModel["authEdges"] {
  return (identityGraph?.edges ?? [])
    .filter((edge) => !!edge.from && !!edge.to && !!edge.relationship)
    .map((edge) => ({
      from: edge.from!,
      to: edge.to!,
      relationship: edge.relationship!,
      evidence: edge.evidence ?? [],
      confidence: edge.confidence,
    }))
}

function reportCompleteness(status: Awaited<ReturnType<typeof readOperationStatus>>) {
  const reportSignals = [
    status.reports.outline,
    status.reports.markdown,
    status.reports.html,
    status.reports.pdf,
    status.reports.readme,
    status.reports.manifest,
    status.runtimeSummary,
  ]
  return Number((reportSignals.filter(Boolean).length / reportSignals.length).toFixed(3))
}

function gap(input: OperationCoverageGap): OperationCoverageGap {
  return input
}

function bounded(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3))
}

function confidence(input: Omit<OperationCoverageConfidence, "confidence">): OperationCoverageConfidence {
  const scores = [input.breadth, input.depth, input.freshness, input.validation, input.negativeTesting].map(bounded)
  return {
    ...input,
    breadth: scores[0] ?? 0,
    depth: scores[1] ?? 0,
    freshness: scores[2] ?? 0,
    validation: scores[3] ?? 0,
    negativeTesting: scores[4] ?? 0,
    confidence: bounded(scores.reduce((sum, score) => sum + score, 0) / scores.length),
  }
}

function seed(input: OperationNextWorkSeed): OperationNextWorkSeed {
  return input
}

function gapAuditMarkdown(result: OperationGapAuditResult) {
  return [
    `# Operation Gap Audit: ${result.operationID}`,
    "",
    `- generated_at: ${result.generatedAt}`,
    `- release_ready: ${result.releaseReady}`,
    `- coverage_status: ${result.coverage.status}`,
    `- runtime_remaining_seconds: ${result.runtimeRemainingSeconds ?? "unknown"}`,
    `- queue_depth: ${result.progress.queueDepth}`,
    `- stale_work_units: ${result.progress.staleWorkUnits}`,
    `- report_completeness_score: ${result.progress.reportCompletenessScore}`,
    `- world_model_assets: ${result.worldModel.assets.length}`,
    `- world_model_findings: ${result.worldModel.findings.length}`,
    `- world_model_hypotheses: ${result.worldModel.hypotheses.length}`,
    "",
    "## Coverage Confidence",
    ...result.coverageConfidence.map(
      (item) =>
        `- ${item.category}: confidence=${item.confidence} breadth=${item.breadth} depth=${item.depth} freshness=${item.freshness} validation=${item.validation} negative_testing=${item.negativeTesting}`,
    ),
    "",
    "## Gaps",
    ...(result.gaps.length
      ? result.gaps.map((item) => `- [${item.severity}] ${item.id}: ${item.summary}`)
      : ["- none"]),
    "",
    "## Next Work Seeds",
    ...(result.nextWorkUnitSeeds.length
      ? result.nextWorkUnitSeeds.map((item) => `- p${item.priority} ${item.kind}: ${item.rationale}`)
      : ["- none"]),
    "",
  ].join("\n")
}

export async function auditOperationGaps(
  worktree: string,
  input: {
    operationID: string
    runtimeRemainingSeconds?: number
    now?: Date | string
  },
): Promise<OperationGapAuditResult> {
  if (containsRawCredentialSecret(input)) throw new Error("operation gap audits must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const now = input.now instanceof Date ? input.now : input.now ? new Date(input.now) : new Date()
  const generatedAt = now.toISOString()
  const root = operationPath(worktree, operationID)
  const status = await readOperationStatus(worktree, operationID, { eventLimit: 0 })
  const coverage = await evaluateCoverageReadiness(worktree, operationID)
  const coverageContract = await readCoverageContract(worktree, operationID)
  const queuePath = path.join(root, "work-queue.json")
  const queue = await readJson<WorkQueueRecord>(queuePath)
  const leads = (await readJson<LeadsRecord>(path.join(root, "leads.json")))?.leads ?? []
  const evidenceRecords = await readEvidenceRecords(root)
  const findings = await readFindings(root)
  const chainFiles = await readUnknownJsonFiles(path.join(root, "chains"))
  const identityGraph = await readJson<IdentityGraphRecord>(path.join(root, "profiles", "identity-graph.json"))
  const identityGraphExists = await exists(path.join(root, "profiles", "identity-graph.json"))
  const evidenceIndexExists = await exists(path.join(root, "evidence-index.json"))
  const queuedUnits = (queue?.units ?? []).filter((unit) => unit.status === "queued")
  const staleUnits = staleRunningWorkUnits(queue?.units ?? [], now, 30)
  const candidateFindings = findings.filter((finding) => finding.state === "candidate" || finding.state === "needs_validation")
  const reportableFindings = findings.filter((finding) => finding.state === "validated" || finding.state === "report_ready")

  const gaps: OperationCoverageGap[] = []
  const seeds: OperationNextWorkSeed[] = []

  if (!coverage.ok) {
    gaps.push(
      gap({
        id: "coverage-contract-not-release-ready",
        category: "coverage_contract",
        severity: "blocks_release",
        blocksRelease: true,
        summary: coverage.gaps.join("; "),
        evidenceNeeded: coverageContract?.minimumEvidence.length ? coverageContract.minimumEvidence : coverage.gaps,
        suggestedWorkUnitKinds: ["coverage-gap-review", "second-pass-coverage-review"],
        staleAfterMinutes: 120,
      }),
    )
    seeds.push(
      seed({
        id: "seed-coverage-gap-review",
        kind: "coverage-gap-review",
        priority: 90,
        category: "coverage_contract",
        rationale: "Coverage contract is not release-ready; convert specific gaps into bounded validation work.",
        expectedArtifacts: ["work-blocks/coverage-gap-review.md", "plans/gap-audit.json"],
        safety: "non_destructive",
        maxDurationMinutes: 30,
        stopCondition: "Each coverage gap is either backed by evidence, mapped to a new work unit, or recorded as a blocker.",
      }),
    )
  }

  if (!evidenceRecords.length && !evidenceIndexExists) {
    gaps.push(
      gap({
        id: "evidence-corpus-empty",
        category: "asset_inventory",
        severity: "high",
        blocksRelease: true,
        summary: "No evidence records or normalized evidence index exist yet.",
        evidenceNeeded: ["At least one evidence record or normalized evidence-index.json"],
        suggestedWorkUnitKinds: ["asset-inventory", "evidence-normalization"],
        staleAfterMinutes: 60,
      }),
    )
  }

  if (candidateFindings.length) {
    gaps.push(
      gap({
        id: "candidate-findings-need-validation",
        category: "vulnerability_validation",
        severity: "high",
        blocksRelease: true,
        summary: `${candidateFindings.length} candidate or needs-validation findings require safe validation or rejection.`,
        evidenceNeeded: candidateFindings.map((finding) => finding.findingID),
        suggestedWorkUnitKinds: ["finding-validation", "credentialed-role-check"],
        staleAfterMinutes: 120,
      }),
    )
    seeds.push(
      seed({
        id: "seed-candidate-validation",
        kind: "credentialed-role-check",
        priority: 100,
        category: "vulnerability_validation",
        rationale: "Candidate findings are present; validator work should prove, downgrade, or reject them before reporting.",
        expectedArtifacts: ["findings/", "evidence/"],
        safety: "non_destructive",
        maxDurationMinutes: 45,
        stopCondition: "Candidate findings move to validated, report_ready, or rejected with evidence references.",
      }),
    )
  }

  if (!identityGraphExists && ((status.goal?.targetDurationHours ?? 0) >= 1 || candidateFindings.length || reportableFindings.length)) {
    gaps.push(
      gap({
        id: "identity-auth-graph-missing",
        category: "identity_auth",
        severity: "medium",
        blocksRelease: false,
        summary: "profiles/identity-graph.json is missing, so role/account/application boundaries are not modeled.",
        evidenceNeeded: ["profiles/identity-graph.json"],
        suggestedWorkUnitKinds: ["authz-matrix-review", "credentialed-role-check"],
        staleAfterMinutes: 240,
      }),
    )
    seeds.push(
      seed({
        id: "seed-authz-matrix-review",
        kind: "authz-matrix-review",
        priority: 80,
        category: "identity_auth",
        rationale: "Long-running K-12 work needs a role/app/data graph, not just lane completion.",
        expectedArtifacts: ["profiles/identity-graph.json", "profiles/identity-graph.md"],
        safety: "non_destructive",
        maxDurationMinutes: 45,
        stopCondition: "Identity graph captures observed account, role, app, data, and vendor edges with evidence references.",
      }),
    )
  }

  if (reportableFindings.length && !chainFiles.length) {
    gaps.push(
      gap({
        id: "attack-chain-missing-for-reportable-findings",
        category: "attack_graph",
        severity: "medium",
        blocksRelease: false,
        summary: "Validated/reportable findings exist but no attack-chain artifact connects impact paths and limits.",
        evidenceNeeded: ["chains/*.json", "chains/*.md"],
        suggestedWorkUnitKinds: ["attack-chain-modeling"],
        staleAfterMinutes: 240,
      }),
    )
    seeds.push(
      seed({
        id: "seed-attack-chain-modeling",
        kind: "attack-chain-modeling",
        priority: 70,
        category: "attack_graph",
        rationale: "Reportable findings need a non-destructive attack path narrative and validation boundary.",
        expectedArtifacts: ["chains/"],
        safety: "non_destructive",
        maxDurationMinutes: 30,
        stopCondition: "Attack chain records only validated or safely testable paths and explicit stop conditions.",
      }),
    )
  }

  if (leads.length && !queuedUnits.length) {
    gaps.push(
      gap({
        id: "leads-exist-with-empty-queue",
        category: "queue_health",
        severity: "medium",
        blocksRelease: false,
        summary: `${leads.length} normalized leads exist but no queued command work remains.`,
        evidenceNeeded: ["work-queue.json queued units"],
        suggestedWorkUnitKinds: ["queue-refill"],
        staleAfterMinutes: 30,
      }),
    )
  }

  if (staleUnits.length) {
    gaps.push(
      gap({
        id: "stale-work-units",
        category: "queue_health",
        severity: "medium",
        blocksRelease: false,
        summary: `${staleUnits.length} running work units have no bound job and are stale.`,
        evidenceNeeded: staleUnits.map((unit) => unit.id),
        suggestedWorkUnitKinds: ["stale-lease-requeue"],
        staleAfterMinutes: 30,
      }),
    )
  }

  if (input.runtimeRemainingSeconds !== undefined && input.runtimeRemainingSeconds <= 90 * 60 && status.reports.manifest === false) {
    gaps.push(
      gap({
        id: "finalization-window-report-package-missing",
        category: "reporting",
        severity: "blocks_release",
        blocksRelease: true,
        summary: "Runtime is inside the finalization window but final manifest is missing.",
        evidenceNeeded: ["deliverables/final/manifest.json", "operation_audit finalHandoff=true"],
        suggestedWorkUnitKinds: ["report-finalization"],
        staleAfterMinutes: 30,
      }),
    )
  }

  const progress: OperationProgressMetrics = {
    newAssetsLastHour: leads.filter((lead) => lead.asset || lead.host || lead.url).length,
    newEvidenceLastHour: evidenceRecords.filter((record) => updatedWithin(record.time.updated, now, 60)).length,
    newValidatedFindingsLastHour: findings.filter(
      (finding) => finding.state === "validated" && updatedWithin(finding.time.updated, now, 60),
    ).length,
    newRejectedHypothesesLastHour: findings.filter(
      (finding) => finding.state === "rejected" && updatedWithin(finding.time.updated, now, 60),
    ).length,
    repeatedCommandsLastHour: repeatedRecentCommands(queue?.units ?? [], now),
    queueDepth: queuedUnits.length,
    staleWorkUnits: staleUnits.length,
    coverageGapCount: gaps.length,
    reportCompletenessScore: reportCompleteness(status),
  }

  const coverageConfidence: OperationCoverageConfidence[] = [
    confidence({
      category: "asset_inventory",
      breadth: leads.length || evidenceRecords.length ? 1 : 0,
      depth: Math.min(1, evidenceRecords.length / 5),
      freshness: progress.newEvidenceLastHour > 0 ? 1 : 0,
      validation: coverage.ok ? 1 : 0.4,
      negativeTesting: progress.newRejectedHypothesesLastHour > 0 ? 1 : 0,
    }),
    confidence({
      category: "identity_auth",
      breadth: identityGraphExists ? 1 : 0,
      depth: identityGraphExists ? 0.8 : 0,
      freshness: identityGraphExists ? 0.5 : 0,
      validation: candidateFindings.length ? 0.4 : reportableFindings.length ? 0.8 : 0.2,
      negativeTesting: progress.newRejectedHypothesesLastHour > 0 ? 1 : 0,
    }),
    confidence({
      category: "vulnerability_validation",
      breadth: findings.length ? 1 : 0,
      depth: Math.min(1, findings.length / 4),
      freshness: progress.newValidatedFindingsLastHour || progress.newRejectedHypothesesLastHour ? 1 : 0.3,
      validation: reportableFindings.length / Math.max(1, reportableFindings.length + candidateFindings.length),
      negativeTesting: findings.some((finding) => finding.state === "rejected") ? 1 : 0,
    }),
    confidence({
      category: "attack_graph",
      breadth: chainFiles.length ? 1 : 0,
      depth: reportableFindings.length ? Math.min(1, chainFiles.length / reportableFindings.length) : chainFiles.length ? 1 : 0.2,
      freshness: chainFiles.length ? 0.5 : 0,
      validation: reportableFindings.length && chainFiles.length ? 0.8 : 0,
      negativeTesting: chainFiles.length ? 0.5 : 0,
    }),
    confidence({
      category: "reporting",
      breadth: progress.reportCompletenessScore,
      depth: progress.reportCompletenessScore,
      freshness: status.reports.markdown || status.reports.html ? 0.6 : 0,
      validation: status.reports.manifest ? 1 : 0,
      negativeTesting: status.evalScorecard ? 1 : 0,
    }),
    confidence({
      category: "queue_health",
      breadth: queue ? 1 : 0,
      depth: queuedUnits.length ? 1 : leads.length ? 0.3 : 0.6,
      freshness: queue?.generatedAt && updatedWithin(queue.generatedAt, now, 60) ? 1 : 0,
      validation: staleUnits.length ? 0 : 1,
      negativeTesting: progress.repeatedCommandsLastHour ? 0 : 1,
    }),
  ]

  if (!gaps.length && input.runtimeRemainingSeconds !== undefined && input.runtimeRemainingSeconds > 90 * 60) {
    seeds.push(
      seed({
        id: "seed-second-pass-review",
        kind: "second-pass-coverage-review",
        priority: 40,
        category: "coverage_contract",
        rationale: "No blocking gaps remain, but runtime remains; run a novelty/cross-check pass instead of idling.",
        expectedArtifacts: ["work-blocks/second-pass-coverage-review.md"],
        safety: "non_destructive",
        maxDurationMinutes: 30,
        stopCondition: "Second-pass review records negative space, repeated checks avoided, and any newly generated leads.",
      }),
    )
  }

  const assetEntities = new Map<string, { id: string; label: string; source: string }>()
  for (const lead of leads) {
    addEntity(assetEntities, lead.asset, "leads.json")
    addEntity(assetEntities, lead.host, "leads.json")
    addEntity(assetEntities, lead.url, "leads.json")
  }
  for (const finding of findings) {
    for (const asset of finding.affectedAssets) addEntity(assetEntities, asset, `finding:${finding.findingID}`)
  }
  const worldModel: OperationWorldModel = {
    assets: entitiesFor(identityGraph, "host", assetEntities),
    accounts: entitiesFor(identityGraph, "account"),
    roles: entitiesFor(identityGraph, "role"),
    systems: entitiesFor(identityGraph, "data"),
    apps: entitiesFor(identityGraph, "application"),
    services: entitiesFor(identityGraph, "service"),
    authEdges: authEdgesFor(identityGraph),
    evidence: evidenceRecords.map((record) => ({
      id: record.evidenceID,
      kind: record.kind,
      summary: record.summary,
      path: record.path,
    })),
    findings: findings.map((finding) => ({
      id: finding.findingID,
      state: finding.state,
      severity: finding.severity,
      assets: finding.affectedAssets,
      evidence: finding.evidence.map((item) => item.id),
    })),
    hypotheses: candidateFindings.map((finding) => ({
      id: finding.findingID,
      summary: finding.description,
      evidence: finding.evidence.map((item) => item.id),
    })),
    negativeSpace: gaps.map((item) => ({
      id: item.id,
      category: item.category,
      evidenceNeeded: item.evidenceNeeded,
    })),
    testedControls: findings
      .filter((finding) => finding.state === "validated" || finding.state === "rejected")
      .map((finding) => ({
        id: finding.findingID,
        status: finding.state === "validated" ? "validated" : "rejected",
        evidence: finding.evidence.map((item) => item.id),
      })),
    unresolvedQuestions: gaps.map((item) => ({
      id: `question-${item.id}`,
      question: item.summary,
      suggestedWork: item.suggestedWorkUnitKinds,
    })),
  }

  const json = path.join(root, "plans", "gap-audit.json")
  const markdown = path.join(root, "plans", "gap-audit.md")
  const result: OperationGapAuditResult = {
    operationID,
    generatedAt,
    runtimeRemainingSeconds: input.runtimeRemainingSeconds,
    releaseReady: coverage.ok && !gaps.some((item) => item.blocksRelease),
    coverage,
    coverageConfidence,
    worldModel,
    progress,
    gaps,
    nextWorkUnitSeeds: seeds.sort((a, b) => b.priority - a.priority),
    files: { json, markdown },
  }
  await writeJson(json, result)
  await fs.writeFile(markdown, gapAuditMarkdown(result))
  return result
}

export function formatOperationGapAudit(result: OperationGapAuditResult) {
  return [
    gapAuditMarkdown(result),
    "<operation_gap_audit_json>",
    JSON.stringify(result, null, 2),
    "</operation_gap_audit_json>",
  ].join("\n")
}
