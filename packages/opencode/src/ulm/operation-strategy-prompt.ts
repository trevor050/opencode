import fs from "fs/promises"
import path from "path"
import { operationPath, readOperationStatus, slug, type OperationStatusSummary } from "./artifact"
import { browserWorkflowManifests } from "./browser-workflows"
import { normalizeStrategyMemo, type OperationStrategyMemo } from "./operation-strategy"

type WorkQueueSummary = {
  total: number
  queued: number
  running: number
  complete: number
  failed: number
}

type GapAuditSummary = {
  gaps: string[]
  releaseReady?: boolean
  queueDepth?: number
}

export type OperationStrategyInput = {
  operationID: string
  horizonItems?: number
  operatorFocus?: string
  now?: Date | string
}

export type OperationStrategyResult = {
  operationID: string
  json: string
  markdown: string
  prompt: string
  memo: OperationStrategyMemo
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readWorkQueue(root: string): Promise<WorkQueueSummary | undefined> {
  const queue = await readJson<{ units?: Array<{ status?: string }> }>(path.join(root, "work-queue.json"))
  if (!queue?.units) return undefined
  const count = (status: string) => queue.units?.filter((unit) => unit.status === status).length ?? 0
  return {
    total: queue.units.length,
    queued: count("queued"),
    running: count("running"),
    complete: count("complete"),
    failed: count("failed"),
  }
}

async function readGapAudit(root: string): Promise<GapAuditSummary | undefined> {
  const audit = await readJson<{
    gaps?: Array<{ id?: string; severity?: string; summary?: string }>
    releaseReady?: boolean
    progress?: { queueDepth?: number }
  }>(path.join(root, "plans", "gap-audit.json"))
  if (!audit) return undefined
  return {
    gaps: (audit.gaps ?? []).map((gap) =>
      [gap.severity ? `[${gap.severity}]` : undefined, gap.id, gap.summary].filter(Boolean).join(" "),
    ),
    releaseReady: audit.releaseReady,
    queueDepth: audit.progress?.queueDepth,
  }
}

function targetTimeRemaining(status: OperationStatusSummary, now: Date) {
  const target = status.goal?.targetDurationHours
  const updated = status.goal?.updatedAt
  if (!target || !updated) return undefined
  const started = Date.parse(updated)
  if (!Number.isFinite(started)) return undefined
  return Math.max(0, target - (now.getTime() - started) / 60 / 60 / 1000)
}

function strategyPrompt(input: {
  status: OperationStatusSummary
  queue?: WorkQueueSummary
  gapAudit?: GapAuditSummary
  horizonItems: number
  operatorFocus?: string
  remainingHours?: number
}) {
  const status = input.status
  return [
    `# Operation Strategist Prompt: ${status.operationID}`,
    "",
    "Write a permissive next-actions memo for the scheduler. Return plain JSON with an `items` array.",
    `Aim for ${input.horizonItems} useful moves. Keep titles short. Include why each move matters.`,
    "The deterministic scheduler treats this as hints, not law.",
    "",
    input.operatorFocus ? `Operator focus: ${input.operatorFocus}` : undefined,
    "",
    `Objective: ${status.operation?.objective ?? status.goal?.objective ?? "unknown"}`,
    `Stage/status: ${status.operation ? `${status.operation.stage}/${status.operation.status}` : "no checkpoint"}`,
    `Time remaining: ${input.remainingHours === undefined ? "unknown" : `${input.remainingHours.toFixed(1)}h`}`,
    "",
    `Findings: total=${status.findings.total} candidate=${status.findings.byState.candidate} needs_validation=${status.findings.byState.needs_validation} validated=${status.findings.byState.validated} report_ready=${status.findings.byState.report_ready}`,
    `Evidence: total=${status.evidence.total}`,
    `Runtime: summary=${status.runtimeSummary} compaction=${status.runtime?.compaction?.pressure ?? "unknown"} budget_remaining=${status.runtime?.usage?.remainingUSD ?? "unknown"}`,
    `Queue: total=${input.queue?.total ?? 0} queued=${input.queue?.queued ?? 0} running=${input.queue?.running ?? 0} failed=${input.queue?.failed ?? 0}`,
    "",
    "Graph:",
    `- total lanes: ${status.graph?.lanes.total ?? 0}`,
    `- running: ${(status.graph?.lanes.running ?? []).join(", ") || "none"}`,
    `- incomplete: ${(status.graph?.lanes.incomplete ?? []).slice(0, 12).join(", ") || "none"}`,
    `- failed: ${(status.graph?.lanes.failed ?? []).join(", ") || "none"}`,
    "",
    "Gap audit:",
    ...(input.gapAudit?.gaps.length ? input.gapAudit.gaps.slice(0, 8).map((gap) => `- ${gap}`) : ["- none recorded"]),
    "",
    "Authenticated browser workflow manifests:",
    ...browserWorkflowManifests().map(
      (workflow) => `- ${workflow.id}: ${workflow.serviceType}; proof=${workflow.expectedEvidenceArtifacts.join(", ")}`,
    ),
    "",
    "Prefer identity/SaaS/browser work over more low-value unauthenticated recon when both are available and safe.",
    "Never include raw credentials, student records, secrets, or private data in the memo.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

function heuristicItems(status: OperationStatusSummary, horizonItems: number): OperationStrategyMemo["items"] {
  const items: OperationStrategyMemo["items"] = []
  const incomplete = new Set(status.graph?.lanes.incomplete ?? [])
  if (incomplete.has("identity_auth_review")) {
    items.push({
      title: "Prioritize identity and authenticated browser review",
      why: "Identity and role coverage are usually higher-value than more unauthenticated recon in long district runs.",
      suggestedLane: "identity-auth-review",
      usefulTools: ["operation_run", "runtime_scheduler", "browser_evidence"],
      expectedProof: ["browser/session-log.jsonl", "profiles/identity-graph.json"],
    })
  }
  if (incomplete.has("saas_cloud_review")) {
    items.push({
      title: "Review SaaS/admin portal exposure through logged-in browser workflows",
      why: "SaaS admin surfaces often decide whether student-data access is actually constrained.",
      suggestedLane: "saas-cloud-review",
      usefulTools: ["playwright_persistent", "browser_evidence"],
      expectedProof: ["browser/screenshots/", "browser/session-log.jsonl"],
    })
  }
  if (status.findings.byState.candidate || status.findings.byState.needs_validation) {
    items.push({
      title: "Resolve candidate findings before report claims harden",
      why: "Validation debt can poison the final report if it stays unresolved.",
      suggestedLane: "finding-validation",
      usefulTools: ["finding_record", "evidence_record"],
      expectedProof: ["findings/", "evidence/"],
    })
  }
  if (!status.reports.markdown && (status.findings.byState.validated || status.findings.byState.report_ready)) {
    items.push({
      title: "Start report writing from validated evidence",
      why: "Long reports need authored substance early enough to survive review and rendering.",
      suggestedLane: "report-writing",
      usefulTools: ["report_outline", "report_lint"],
      expectedProof: ["reports/report.md"],
    })
  }
  return items.slice(0, Math.max(1, horizonItems))
}

function strategyMarkdown(memo: OperationStrategyMemo, promptPath: string) {
  return [
    `# Operation Strategy: ${memo.operationID}`,
    "",
    `- generated_at: ${memo.generatedAt ?? "unknown"}`,
    `- prompt: ${promptPath}`,
    "",
    "## Next Strategy Items",
    ...(memo.items.length
      ? memo.items.map((item, index) => `${index + 1}. ${item.title}\n   - why: ${item.why ?? "not provided"}\n   - suggested_lane: ${item.suggestedLane ?? "none"}`)
      : ["- none"]),
    "",
    "## Gaps",
    ...(memo.gaps.length ? memo.gaps.map((gap) => `- ${gap}`) : ["- none"]),
    "",
  ].join("\n")
}

export async function writeOperationStrategy(worktree: string, input: OperationStrategyInput): Promise<OperationStrategyResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const strategyDir = path.join(root, "strategy")
  const horizonItems = Math.max(1, Math.min(10, Math.floor(input.horizonItems ?? 5)))
  const now = input.now instanceof Date ? input.now : input.now ? new Date(input.now) : new Date()
  const status = await readOperationStatus(worktree, operationID, { eventLimit: 5 })
  const queue = await readWorkQueue(root)
  const gapAudit = await readGapAudit(root)
  const promptText = strategyPrompt({
    status,
    queue,
    gapAudit,
    horizonItems,
    operatorFocus: input.operatorFocus,
    remainingHours: targetTimeRemaining(status, now),
  })
  const memo = normalizeStrategyMemo({
    operationID,
    generatedAt: now.toISOString(),
    horizon: `next ${horizonItems} useful moves`,
    items: heuristicItems(status, horizonItems),
  })
  const promptPath = path.join(strategyDir, "strategist-prompt.md")
  const json = path.join(strategyDir, "next-actions.json")
  const markdown = path.join(strategyDir, "next-actions.md")
  await fs.mkdir(strategyDir, { recursive: true })
  await fs.writeFile(promptPath, promptText + "\n")
  await fs.writeFile(json, JSON.stringify(memo, null, 2) + "\n")
  await fs.writeFile(markdown, strategyMarkdown(memo, path.relative(root, promptPath)) + "\n")
  return { operationID, json, markdown, prompt: promptPath, memo }
}

export function formatOperationStrategy(result: OperationStrategyResult) {
  return [
    `# Operation Strategy: ${result.operationID}`,
    "",
    `- json: ${result.json}`,
    `- markdown: ${result.markdown}`,
    `- prompt: ${result.prompt}`,
    `- items: ${result.memo.items.length}`,
    "",
    "<operation_strategy_json>",
    JSON.stringify(result.memo, null, 2),
    "</operation_strategy_json>",
  ].join("\n")
}
