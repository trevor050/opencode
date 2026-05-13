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
  subtitle?: string
  rows: ULMToolRow[]
  sections: ULMToolSection[]
  preview: string[]
}

const ULM_TOOLS = new Set([
  "operation_goal",
  "tool_inventory",
  "operation_memory",
  "operation_checkpoint",
  "evidence_record",
  "operation_plan",
  "operation_run",
  "operation_credentials",
  "laptop_preflight",
  "runtime_daemon",
  "runtime_summary",
  "operation_audit",
  "report_render",
  "report_lint",
])

const TOOL_TITLES: Record<string, string> = {
  operation_goal: "Operation goal",
  tool_inventory: "Tool inventory",
  operation_memory: "Operation memory",
  operation_checkpoint: "Operation checkpoint",
  evidence_record: "Evidence record",
  operation_plan: "Operation plan",
  operation_run: "Operation run",
  operation_credentials: "Operation credentials",
  laptop_preflight: "Laptop preflight",
  runtime_daemon: "Runtime daemon",
  runtime_summary: "Runtime summary",
  operation_audit: "Operation audit",
  report_render: "Report render",
  report_lint: "Report lint",
}

const CREDENTIAL_TITLES: Record<string, string> = {
  review_status: "Credential review",
  materialize_env: "Credential env",
  open_vault: "Credential vault",
  vault_url: "Credential vault",
}

const OUTPUT_LABELS: Record<string, string> = {
  operation_id: "Operation",
  stage: "Stage",
  status: "Status",
  risk: "Risk",
  riskLevel: "Risk",
  objective: "Objective",
  summary: "Summary",
  next_step: "Next",
  planning_mode: "Mode",
  planning_approval: "Approval",
  plan_kind: "Plan kind",
  installed: "Installed",
  missing: "Missing",
  evidence_id: "Evidence",
  title: "Title",
  kind: "Kind",
  json: "JSON",
  markdown: "Markdown",
  html: "HTML",
  pdf: "PDF",
  manifest: "Manifest",
  runtime_summary: "Runtime summary",
  lane_id: "Lane",
  job_id: "Job",
  vault_url: "Vault URL",
  fallback_url: "Fallback URL",
  opened: "Opened",
  submitted: "Submitted",
  submitted_at: "Submitted at",
  saved_credentials: "Saved credentials",
  review_file: "Review file",
  credential_id: "Credential",
  env_file: "Env file",
  target_hours: "Target hours",
  gaps: "Gaps",
  warnings: "Warnings",
  heartbeat: "Heartbeat",
  log: "Log",
  cycles: "Cycles",
  stopped: "Stopped",
  reason: "Reason",
}

const INPUT_KEYS: Array<[string, string]> = [
  ["operationID", "Operation"],
  ["objective", "Objective"],
  ["action", "Action"],
  ["stage", "Stage"],
  ["planningMode", "Mode"],
  ["targetDurationHours", "Duration"],
  ["evidenceID", "Evidence"],
  ["title", "Title"],
  ["kind", "Kind"],
  ["laneID", "Lane"],
]

const SENSITIVE_KEYS = new Set(["password", "secret", "token", "apiKey", "key", "value", "credentials"])

export function isULMTool(tool: string) {
  return ULM_TOOLS.has(tool)
}

function text(value: unknown) {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return undefined
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function titleCase(input: string) {
  return input.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase())
}

function lines(output?: string) {
  return (output ?? "").split("\n").map((line) => line.trim())
}

function outputPairs(output?: string) {
  const rows: ULMToolRow[] = []
  let inTaggedJson = false
  for (const line of lines(output)) {
    if (/^<[a-z_]+_json>$/.test(line)) {
      inTaggedJson = true
      continue
    }
    if (/^<\/[a-z_]+_json>$/.test(line)) {
      inTaggedJson = false
      continue
    }
    if (inTaggedJson || line.startsWith("{") || line.startsWith("}")) continue
    const index = line.indexOf(":")
    if (index === -1) continue
    const key = line.slice(0, index).replace(/^-+\s*/, "").trim()
    const value = line.slice(index + 1).trim()
    if (!value) continue
    rows.push({ label: OUTPUT_LABELS[key] ?? titleCase(key), value })
  }
  return rows
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

function list(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter((item): item is string => !!item) : []
}

function add(rows: ULMToolRow[], label: string, value: unknown) {
  const normalized = text(value)
  if (!normalized) return
  if (rows.some((row) => row.label === label)) return
  rows.push({ label, value: normalized })
}

function inputRows(input: Record<string, unknown>) {
  const rows: ULMToolRow[] = []
  for (const [key, label] of INPUT_KEYS) add(rows, label, input[key])
  return rows
}

function jsonRows(data: Record<string, unknown>) {
  const rows: ULMToolRow[] = []
  const operation = record(data.operation)
  const checkpoint = record(data.checkpoint)
  const findings = record(data.findings)
  const evidence = record(data.evidence)
  const reports = record(data.reports)
  const stage = text(checkpoint.stage ?? operation.stage)
  const status = text(checkpoint.status ?? operation.status)
  add(rows, "Operation", data.operationID ?? checkpoint.operationID ?? operation.operationID)
  add(rows, "Status", data.status)
  add(rows, "Target hours", data.targetHours)
  add(rows, "Gaps", list(data.gaps).length || undefined)
  add(rows, "Warnings", list(data.warnings).length || undefined)
  add(rows, "Stage", stage && status ? `${stage}/${status}` : (stage ?? status))
  add(rows, "Summary", checkpoint.summary ?? operation.summary ?? data.summary)
  add(rows, "Findings", findings.total)
  add(rows, "Evidence", evidence.total)
  const readyReports = Object.entries(reports)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .join(", ")
  add(rows, "Reports", readyReports)
  return rows
}

function sections(data: Record<string, unknown>) {
  const checkpoint = record(data.checkpoint)
  const operation = record(data.operation)
  return [
    section("Launch blockers", list(data.gaps)),
    section("Next actions", list(checkpoint.nextActions ?? operation.nextActions ?? data.nextActions)),
    section("Blockers", list(checkpoint.blockers ?? operation.blockers ?? data.blockers)),
    section("Recommended tools", list(data.recommendedTools)),
  ].filter((item): item is ULMToolSection => item !== undefined)
}

function section(title: string, values: string[]) {
  if (!values.length) return undefined
  return {
    title,
    rows: values.slice(0, 5).map((value, index) => ({ label: String(index + 1), value })),
  }
}

function outputPreview(output?: string) {
  const all = output?.split("\n") ?? []
  const start = all.findIndex((line) => line.trim() === "plan_preview:")
  if (start === -1) return []
  return all
    .slice(start + 1)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "```markdown" && line !== "```")
    .filter((line) => line.trim().length > 0)
    .slice(0, 6)
}

function titleFor(tool: string, input: Record<string, unknown>, rows: ULMToolRow[]) {
  if (tool === "operation_plan") {
    const kind = rows.find((row) => row.label === "Plan kind")?.value
    if (kind === "discovery_charter" || input.planningMode === "discovery-charter") return "Discovery charter"
  }
  if (tool === "operation_credentials") {
    const action = text(input.action)
    if (action && CREDENTIAL_TITLES[action]) return CREDENTIAL_TITLES[action]
  }
  return TOOL_TITLES[tool] ?? titleCase(tool)
}

function safeInput(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !SENSITIVE_KEYS.has(key)))
}

export function buildULMToolView(input: {
  tool: string
  input?: Record<string, unknown>
  metadata?: Record<string, unknown>
  output?: string
}): ULMToolView {
  const toolInput = safeInput(input.input ?? {})
  const data = taggedJson(input.output)
  const rows: ULMToolRow[] = []
  for (const row of [...jsonRows(data), ...outputPairs(input.output), ...inputRows(toolInput)]) add(rows, row.label, row.value)
  add(rows, "Operation", input.metadata?.operationID)
  add(rows, "Status", input.metadata?.status)
  if (!rows.length) add(rows, "State", "waiting for tool output")
  const subtitle =
    rows.find((row) => row.label === "Operation")?.value ??
    rows.find((row) => row.label === "Objective")?.value ??
    rows.find((row) => row.label === "Title")?.value
  return {
    title: titleFor(input.tool, toolInput, rows),
    subtitle,
    rows: rows.slice(0, 12),
    sections: sections(data),
    preview: outputPreview(input.output),
  }
}
