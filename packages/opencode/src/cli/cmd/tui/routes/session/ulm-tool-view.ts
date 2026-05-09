export type ULMToolRow = {
  label: string
  value: string
}

export type ULMToolSection = {
  title: string
  rows: ULMToolRow[]
}

export type ULMToolView = {
  title: string
  rows: ULMToolRow[]
  sections: ULMToolSection[]
  preview: string[]
}

const IMPORTANT_KEYS = [
  "operation_id",
  "plan_kind",
  "planning_mode",
  "planning_approval",
  "next_step",
  "stage",
  "status",
  "risk",
  "riskLevel",
  "health",
  "summary",
  "profile_id",
  "tool",
  "target",
  "dry_run",
  "job_id",
  "lane_id",
  "work_unit_id",
  "json",
  "markdown",
  "plan",
  "html",
  "pdf",
  "manifest",
  "runtime_summary",
  "stdout",
  "stderr",
  "heartbeat",
  "credential_id",
  "index",
  "env_file",
  "vault_url",
  "fallback_url",
  "opened",
  "open_status",
  "submitted",
  "submitted_at",
  "saved_credentials",
  "review_file",
  "deleted",
] as const

const LABELS: Record<string, string> = {
  operation_id: "Operation",
  plan_kind: "Plan kind",
  planning_mode: "Mode",
  planning_approval: "Approval",
  next_step: "Next",
  riskLevel: "Risk",
  profile_id: "Profile",
  dry_run: "Dry run",
  job_id: "Job",
  lane_id: "Lane",
  work_unit_id: "Work unit",
  json: "JSON",
  html: "HTML",
  pdf: "PDF",
  runtime_summary: "Runtime summary",
  credential_id: "Credential",
  env_file: "Env file",
  vault_url: "Vault URL",
  fallback_url: "Fallback URL",
  open_status: "Open status",
  submitted_at: "Submitted at",
  saved_credentials: "Saved credentials",
  review_file: "Review file",
}

const TOOL_TITLES: Record<string, string> = {
  command_supervise: "# Supervised Command",
  runtime_scheduler: "# Runtime Scheduler",
  runtime_daemon: "# Runtime Daemon",
  operation_plan: "# Operation Plan",
  operation_goal: "# Operation Goal",
  operation_status: "# Operation Status",
  operation_resume: "# Operation Resume",
  operation_checkpoint: "# Operation Checkpoint",
  operation_supervise: "# Operation Supervisor",
  operation_run: "# Operation Run",
  operation_next: "# Operation Next",
  operation_schedule: "# Operation Schedule",
  operation_stage_gate: "# Stage Gate",
  operation_audit: "# Operation Audit",
  operation_recover: "# Operation Recovery",
  operation_credentials: "# Operation Credentials",
  evidence_record: "# Evidence Record",
  finding_record: "# Finding Record",
  report_outline: "# Report Outline",
  report_lint: "# Report Lint",
  report_render: "# Report Render",
  runtime_summary: "# Runtime Summary",
  eval_scorecard: "# Eval Scorecard",
  asset_graph: "# Asset Graph",
  attack_chain: "# Attack Chain",
  browser_evidence: "# Browser Evidence",
  output_normalize: "# Output Normalize",
  tool_inventory: "# Tool Inventory",
  tool_acquire: "# Tool Acquire",
}

function text(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => item !== undefined && item.length > 0) : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function titleCase(input: string) {
  return input
    .replace(/^operation_/, "operation_")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function defaultTitle(tool: string) {
  if (tool.startsWith("operation_")) return "# " + titleCase(tool.replace(/^operation_/, "operation "))
  return "# " + titleCase(tool)
}

function lineMap(output?: string) {
  return new Map(
    (output ?? "")
      .split("\n")
      .map((line) => line.trim())
      .map((line) => {
        const index = line.indexOf(":")
        if (index === -1) return undefined
        return [line.slice(0, index), line.slice(index + 1).trim()] as const
      })
      .filter((entry): entry is readonly [string, string] => entry !== undefined && entry[1].length > 0),
  )
}

function taggedJson(output?: string) {
  const match = (output ?? "").match(/<([a-z_]+_json)>\s*([\s\S]*?)\s*<\/\1>/)
  if (!match?.[2]) return {}
  try {
    return record(JSON.parse(match[2]))
  } catch {
    return {}
  }
}

function outputPreview(output?: string) {
  const lines = (output ?? "").split("\n")
  const start = lines.findIndex((line) => line.trim() === "plan_preview:")
  if (start === -1) return []
  return lines
    .slice(start + 1)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "```markdown" && line !== "```")
    .filter((line) => line.trim().length > 0)
    .slice(0, 8)
}

function add(rows: ULMToolRow[], label: string, value?: unknown) {
  const normalized = text(value)
  if (!normalized) return rows
  if (rows.some((row) => row.label === label)) return rows
  return [...rows, { label, value: normalized }]
}

function section(title: string, items: string[]) {
  if (!items.length) return undefined
  return {
    title,
    rows: items.slice(0, 6).map((value, index) => ({ label: String(index + 1), value })),
  }
}

function rowsFromOutput(output?: string) {
  const values = lineMap(output)
  return IMPORTANT_KEYS.reduce((rows, key) => add(rows, LABELS[key] ?? titleCase(key), values.get(key)), [] as ULMToolRow[])
}

function commandRows(input: Record<string, unknown>, outputRows: ULMToolRow[]) {
  const variables = input.variables && typeof input.variables === "object" ? (input.variables as Record<string, unknown>) : {}
  return [
    ...outputRows,
    ...[
      { label: "Profile", value: text(input.profileID) },
      { label: "Target", value: text(variables.target) },
      { label: "Dry run", value: text(input.dryRun) },
    ]
      .filter((row): row is ULMToolRow => row.value !== undefined && !outputRows.some((existing) => existing.label === row.label))
      .map((row) => ({ label: row.label, value: row.value })),
  ]
}

function operationRows(data: Record<string, unknown>) {
  const checkpoint = record(data.checkpoint)
  const operation = record(data.operation)
  const health = record(data.health)
  const artifacts = record(data.artifacts)
  const reports = record(artifacts.reports ?? data.reports)
  const stage = text(checkpoint.stage ?? operation.stage)
  const status = text(checkpoint.status ?? operation.status)
  const reportFlags = Object.entries(reports)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .join(", ")
  return [
    { label: "Operation", value: text(data.operationID ?? checkpoint.operationID ?? operation.operationID) },
    { label: "Stage", value: stage && status ? `${stage}/${status}` : (stage ?? status) },
    { label: "Health", value: text(health.status) },
    { label: "Summary", value: text(checkpoint.summary ?? operation.summary) },
    { label: "Findings", value: text(artifacts.findings ?? record(data.findings).total) },
    { label: "Evidence", value: text(artifacts.evidence ?? record(data.evidence).total) },
    { label: "Reports", value: reportFlags || undefined },
    { label: "Runtime", value: artifacts.runtimeSummary === true || data.runtimeSummary === true ? "summary recorded" : undefined },
  ].filter((row): row is ULMToolRow => row.value !== undefined && row.value.length > 0)
}

function operationSections(data: Record<string, unknown>) {
  const checkpoint = record(data.checkpoint)
  const operation = record(data.operation)
  const health = record(data.health)
  return [
    section("Next actions", list(checkpoint.nextActions ?? operation.nextActions ?? data.nextActions)),
    section("Blockers", list(checkpoint.blockers ?? operation.blockers ?? data.blockers)),
    section("Gaps", list(health.gaps)),
    section("Recommended tools", list(data.recommendedTools)),
  ].filter((item): item is ULMToolSection => item !== undefined)
}

function supervisorSections(data: Record<string, unknown>) {
  const decisions = Array.isArray(data.decisions) ? data.decisions.map(record) : []
  const rows = decisions
    .map((decision) => {
      const action = text(decision.action)
      const reason = text(decision.reason)
      const nextTool = text(decision.requiredNextTool ?? decision.next_tool)
      if (!action || !reason) return undefined
      return { label: action, value: nextTool ? `${nextTool} - ${reason}` : reason }
    })
    .filter((row): row is ULMToolRow => row !== undefined)
  return rows.length ? [{ title: "Supervisor decisions", rows }] : []
}

function inputRows(tool: string, input: Record<string, unknown>) {
  const variables = record(input.variables)
  return [
    { label: "Operation", value: text(input.operationID) },
    { label: "Action", value: text(input.action) },
    { label: "Stage", value: text(input.stage) },
    { label: "Profile", value: text(input.profileID) },
    { label: "Target", value: text(variables.target ?? input.target) },
    { label: "Mode", value: text(input.planningMode) },
    { label: "State", value: "waiting for tool output" },
  ].filter((row): row is ULMToolRow => row.value !== undefined && row.value.length > 0)
}

function titleFor(tool: string, rows: ULMToolRow[], input: Record<string, unknown>) {
  const planKind = rows.find((row) => row.label === "Plan kind")?.value
  const planningMode = text(input.planningMode)
  if (tool === "operation_plan" && (planKind === "discovery_charter" || planningMode === "discovery-charter")) {
    return "# Discovery Charter"
  }
  if (tool === "operation_credentials" && input.action === "review_status") return "# Credential Review"
  if (tool === "operation_credentials" && input.action === "materialize_env") return "# Credential Env"
  if (tool === "operation_credentials" && (input.action === "vault_url" || input.action === "open_vault")) {
    return "# Credential Vault"
  }
  return TOOL_TITLES[tool] ?? defaultTitle(tool)
}

export function buildULMToolView(input: {
  tool: string
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
}): ULMToolView {
  const toolInput = input.input ?? {}
  const json = taggedJson(input.output)
  const outputRows = rowsFromOutput(input.output)
  const metadataRows = [
    { label: "Operation", value: text(input.metadata?.operationID) },
    { label: "Stage", value: text(input.metadata?.stage) },
    { label: "Status", value: text(input.metadata?.status) },
  ].filter((row): row is ULMToolRow => row.value !== undefined && !outputRows.some((existing) => existing.label === row.label))
  const rows =
    input.tool === "command_supervise"
      ? commandRows(toolInput, [...outputRows, ...metadataRows])
      : [...operationRows(json), ...outputRows, ...metadataRows]
  const fallbackRows = rows.length ? rows : inputRows(input.tool, toolInput)
  return {
    title: titleFor(input.tool, fallbackRows, toolInput),
    rows: fallbackRows.slice(0, 16),
    sections: [...operationSections(json), ...supervisorSections(json)],
    preview: outputPreview(input.output),
  }
}
