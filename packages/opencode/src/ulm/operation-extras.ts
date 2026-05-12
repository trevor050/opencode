import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"
import { containsRawCredentialSecret } from "./credential-safety"
import { createOperationGoal } from "./operation-goal"
import { REPORT_ONLY_OPERATION_LANES, writeOperationGraph, type OperationScanProfile, type OperationTrustLevel } from "./operation-graph"
import { writeOperationDiscoveryCharter, writeOperationPlan, writeReportOutline, type Stage } from "./artifact"

export type OperationTemplateID =
  | "single-url-web"
  | "external-k12-district"
  | "authenticated-webapp"
  | "internal-network"
  | "school-laptop-48h"
  | "cloud-posture"
  | "code-audit"
  | "report-only"
  | "benchmark-suite"

export type OperationMemoryInput = {
  operationID: string
  action: "read" | "append" | "replace"
  note?: string
  section?: string
}

export type OperationMemoryResult = {
  operationID: string
  file: string
  content: string
  updated: boolean
}

export type AssetGraphInput = {
  operationID: string
  nodes: Array<{
    id: string
    kind: "target" | "host" | "service" | "route" | "api" | "form" | "parameter" | "account" | "role" | "data" | "finding" | "evidence" | "browser_state" | "other"
    label: string
    source?: string
    notes?: string
  }>
  edges?: Array<{ from: string; to: string; relationship: string; evidence?: string[]; confidence?: "low" | "medium" | "high" }>
  notes?: string[]
}

export type AttackChainInput = {
  operationID: string
  chainID?: string
  title: string
  summary: string
  steps: Array<{
    title: string
    findingID?: string
    assetID?: string
    evidence?: string[]
    notes?: string
  }>
  impact?: string
  blockers?: string[]
}

export type BrowserEvidenceInput = {
  operationID: string
  evidenceID?: string
  title: string
  url: string
  authState?: "unknown" | "unauthenticated" | "authenticated" | "privileged" | "student" | "teacher" | "admin"
  screenshotPath?: string
  domSnapshotPath?: string
  tracePath?: string
  requestLogPath?: string
  summary: string
  notes?: string[]
}

export type OperationAlertInput = {
  operationID: string
  alertID?: string
  kind: "validated_high" | "validated_critical" | "daemon_stale" | "budget_exhausted" | "handoff_ready" | "blocked" | "custom"
  severity?: "info" | "warning" | "high" | "critical"
  title: string
  message: string
  sinks?: Array<"webhook" | "discord" | "slack" | "email" | "console">
  nextActions?: string[]
}

export type OutputNormalizeInput = {
  operationID: string
  tool: "nmap" | "nuclei" | "httpx" | "ffuf" | "gobuster" | "nikto" | "sqlmap" | "subfinder" | "generic"
  title?: string
  content: string
  sourcePath?: string
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function readText(file: string) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function mdList(items: string[] | undefined, fallback = "- none recorded") {
  return items?.length ? items.map((item) => `- ${item}`) : [fallback]
}

function isBoundaryLanguage(value: string) {
  return /\b(?:do not|don't|did not|does not|must not|should not|avoid|without|stop condition|non-destructive|never|no|no destructive|no live|no credentials|no secrets|no student records|no production|no persistence|not performed|not execute|not accessed|not used|was not|were not|synthetic|lab-only|lab evidence|supplied evidence|boundary|validation limit|evidence gap)\b/i.test(
    value,
  )
}

function containsDestructiveAttackChainClaim(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsDestructiveAttackChainClaim(item))
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .some((line) => {
        if (isBoundaryLanguage(line)) return false
        return (
          /(?:ran the exploit against production|triggered account takeover|changed grades|modified grades|destructive exploit|drop table|delete records|wipe|ransomware)/i.test(
            line,
          ) ||
          /(?:dumped|dump|downloaded|download|exfiltrated|exfiltrate|exported|export|copied|copy)[\s\S]{0,140}(?:student records|guardian data|sis database|gradebook|payroll|iep|504 records|bulk roster)[\s\S]{0,140}(?:to prove impact|for proof|as proof|into the report|deliverables\/final)?/i.test(
            line,
          ) ||
          /(?:created|added|installed|uploaded|dropped|left)[\s\S]{0,120}(?:backdoor|persistence|web shell|reverse shell|new admin user|ssh key|cron persistence|startup item)/i.test(
            line,
          )
        )
      })
  }
  if (!value || typeof value !== "object") return false
  return Object.values(value as Record<string, unknown>).some((entry) => containsDestructiveAttackChainClaim(entry))
}

export async function updateOperationMemory(worktree: string, input: OperationMemoryInput): Promise<OperationMemoryResult> {
  const operationID = slug(input.operationID, "operation")
  const file = path.join(operationPath(worktree, operationID), "memory.md")
  const current = (await readText(file)) ?? `# Operation Memory: ${operationID}

This file is for agents working this operation. Keep it short. Record only details that matter after compaction, resume, or subagent handoff.

`
  if (input.action === "read") return { operationID, file, content: current, updated: false }
  const note = input.note?.trim()
  if (!note) throw new Error("note is required when action is append or replace")
  if (containsRawCredentialSecret(note)) throw new Error("operation memory notes must not contain raw credential secrets")
  const now = new Date().toISOString()
  const content =
    input.action === "replace"
      ? `# Operation Memory: ${operationID}\n\n${note}\n`
      : `${current.trimEnd()}\n\n## ${input.section?.trim() || "Note"}\n\n- ${now}: ${note}\n`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, content)
  return { operationID, file, content, updated: true }
}

export async function readOperationMemory(worktree: string, operationID: string, maxChars = 4000) {
  const result = await updateOperationMemory(worktree, { operationID, action: "read" })
  return {
    ...result,
    content: result.content.length > maxChars ? `${result.content.slice(0, maxChars)}\n\n[operation memory truncated]` : result.content,
  }
}

export async function writeAssetGraph(worktree: string, input: AssetGraphInput) {
  if (containsRawCredentialSecret(input)) throw new Error("asset graph records must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const record = {
    operationID,
    updatedAt: new Date().toISOString(),
    nodes: input.nodes,
    edges: input.edges ?? [],
    notes: input.notes ?? [],
  }
  const json = path.join(root, "graph", "asset-graph.json")
  const markdown = path.join(root, "graph", "asset-graph.md")
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Asset Graph: ${operationID}`,
      "",
      "## Nodes",
      ...record.nodes.map((node) => `- ${node.id} (${node.kind}): ${node.label}${node.notes ? ` - ${node.notes}` : ""}`),
      "",
      "## Edges",
      ...(record.edges.length
        ? record.edges.map((edge) => `- ${edge.from} -> ${edge.to}: ${edge.relationship}${edge.confidence ? ` (${edge.confidence})` : ""}`)
        : ["- none recorded"]),
      "",
      "## Notes",
      ...mdList(record.notes),
      "",
    ].join("\n"),
  )
  return { operationID, json, markdown, nodes: record.nodes.length, edges: record.edges.length }
}

export async function writeAttackChain(worktree: string, input: AttackChainInput) {
  if (containsRawCredentialSecret(input)) throw new Error("attack chain records must not contain raw credential secrets")
  if (containsDestructiveAttackChainClaim(input)) {
    throw new Error("attack chain records must not contain destructive exploit execution claims")
  }
  const operationID = slug(input.operationID, "operation")
  const chainID = slug(input.chainID ?? input.title, "attack-chain")
  const root = operationPath(worktree, operationID)
  const record = {
    ...input,
    operationID,
    chainID,
    updatedAt: new Date().toISOString(),
    blockers: input.blockers ?? [],
  }
  const json = path.join(root, "chains", `${chainID}.json`)
  const markdown = path.join(root, "chains", `${chainID}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Attack Chain: ${input.title}`,
      "",
      input.summary,
      "",
      "## Steps",
      ...input.steps.map((step, index) => `${index + 1}. ${step.title}${step.findingID ? ` (finding: ${step.findingID})` : ""}${step.assetID ? ` (asset: ${step.assetID})` : ""}`),
      "",
      "## Impact",
      input.impact ?? "No chain-level impact recorded.",
      "",
      "## Blockers",
      ...mdList(record.blockers),
      "",
    ].join("\n"),
  )
  return { operationID, chainID, json, markdown, steps: input.steps.length }
}

export async function writeBrowserEvidence(worktree: string, input: BrowserEvidenceInput) {
  if (containsRawCredentialSecret(input)) throw new Error("browser evidence records must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const evidenceID = slug(input.evidenceID ?? input.title, "browser-evidence")
  const root = operationPath(worktree, operationID)
  const record = {
    ...input,
    operationID,
    evidenceID,
    capturedAt: new Date().toISOString(),
    notes: input.notes ?? [],
  }
  const json = path.join(root, "browser", `${evidenceID}.json`)
  const markdown = path.join(root, "browser", `${evidenceID}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Browser Evidence: ${input.title}`,
      "",
      `- url: ${input.url}`,
      `- auth_state: ${input.authState ?? "unknown"}`,
      `- screenshot: ${input.screenshotPath ?? "none"}`,
      `- dom_snapshot: ${input.domSnapshotPath ?? "none"}`,
      `- trace: ${input.tracePath ?? "none"}`,
      `- request_log: ${input.requestLogPath ?? "none"}`,
      "",
      "## Summary",
      input.summary,
      "",
      "## Notes",
      ...mdList(record.notes),
      "",
    ].join("\n"),
  )
  return { operationID, evidenceID, json, markdown }
}

export async function writeOperationAlert(worktree: string, input: OperationAlertInput) {
  if (containsRawCredentialSecret(input)) throw new Error("operation alerts must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const alertID = slug(input.alertID ?? `${input.kind}-${input.title}`, "alert")
  const root = operationPath(worktree, operationID)
  const record = {
    ...input,
    operationID,
    alertID,
    severity: input.severity ?? (input.kind.includes("critical") ? "critical" : input.kind.includes("high") ? "high" : "warning"),
    sinks: input.sinks ?? ["console"],
    nextActions: input.nextActions ?? [],
    createdAt: new Date().toISOString(),
  }
  const json = path.join(root, "alerts", `${alertID}.json`)
  const markdown = path.join(root, "alerts", `${alertID}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Operation Alert: ${input.title}`,
      "",
      `- kind: ${record.kind}`,
      `- severity: ${record.severity}`,
      `- sinks: ${record.sinks.join(", ")}`,
      "",
      input.message,
      "",
      "## Next Actions",
      ...mdList(record.nextActions),
      "",
    ].join("\n"),
  )
  return { operationID, alertID, json, markdown, sinks: record.sinks.length }
}

function normalizeLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function normalizeToolOutput(worktree: string, input: OutputNormalizeInput) {
  if (containsRawCredentialSecret(input)) throw new Error("normalized tool output must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const lines = normalizeLines(input.content)
  const interesting = lines.filter((line) =>
    /open|http|https|critical|high|medium|low|vulnerable|CVE-|SQL|XSS|redirect|admin|login|forbidden|unauthorized|200|301|302|401|403|500/i.test(line),
  )
  const hosts = [...new Set(lines.flatMap((line) => line.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? []))].sort()
  const urls = [...new Set(lines.flatMap((line) => line.match(/https?:\/\/[^\s"'<>]+/gi) ?? []))].sort()
  const ports = [...new Set(lines.flatMap((line) => line.match(/\b\d{1,5}\/tcp\b/gi) ?? []))].sort()
  const record = {
    operationID,
    tool: input.tool,
    title: input.title ?? `${input.tool} normalized output`,
    sourcePath: input.sourcePath,
    generatedAt: new Date().toISOString(),
    counts: { lines: lines.length, interesting: interesting.length, hosts: hosts.length, urls: urls.length, ports: ports.length },
    hosts,
    urls,
    ports,
    interesting: interesting.slice(0, 200),
  }
  const id = slug(record.title, `${input.tool}-output`)
  const json = path.join(root, "normalized-output", `${id}.json`)
  const markdown = path.join(root, "normalized-output", `${id}.md`)
  await writeJson(json, record)
  await fs.writeFile(
    markdown,
    [
      `# Normalized Output: ${record.title}`,
      "",
      `- tool: ${record.tool}`,
      `- source: ${record.sourcePath ?? "inline"}`,
      `- lines: ${record.counts.lines}`,
      `- interesting_lines: ${record.counts.interesting}`,
      `- hosts: ${record.counts.hosts}`,
      `- urls: ${record.counts.urls}`,
      `- ports: ${record.counts.ports}`,
      "",
      "## Hosts",
      ...mdList(hosts),
      "",
      "## URLs",
      ...mdList(urls),
      "",
      "## Ports",
      ...mdList(ports),
      "",
      "## Interesting Lines",
      ...mdList(record.interesting),
      "",
    ].join("\n"),
  )
  return { operationID, json, markdown, counts: record.counts }
}

const templateStages: Record<OperationTemplateID, Stage[]> = {
  "single-url-web": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "external-k12-district": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "authenticated-webapp": ["intake", "mapping", "validation", "reporting", "handoff"],
  "internal-network": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "school-laptop-48h": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "cloud-posture": ["intake", "recon", "mapping", "validation", "reporting", "handoff"],
  "code-audit": ["intake", "mapping", "validation", "reporting", "handoff"],
  "report-only": ["reporting", "handoff"],
  "benchmark-suite": ["intake", "recon", "validation", "reporting", "handoff"],
}

function templateTimeBudget(input: { targetDurationHours?: number; stages: Stage[] }) {
  const targetHours = input.targetDurationHours
  if (!targetHours) return undefined
  const base = Math.max(0.25, Number((targetHours / input.stages.length).toFixed(2)))
  const finalizationWindowHours = Math.max(1, Math.min(4, Math.round(targetHours * 0.15)))
  return {
    targetHours,
    finalizationWindowHours,
    durationFit: {
      confidence: targetHours >= 2 ? "duration_sized" as const : "medium" as const,
      evidence: [
        `Template target duration is ${targetHours}h.`,
        "Operation graph includes recon, validation, reporting, handoff, supervisor, and recovery-capable lanes.",
      ],
      overflowBacklog: [
        "Expand host/service inventory.",
        "Run profile fallbacks for blocked command profiles.",
        "Deepen evidence normalization, finding validation, and report review until gates pass.",
      ],
    },
    allocations: input.stages.map((stage, index) => ({
      stage,
      hours: index === input.stages.length - 1 ? Math.max(0.25, Number((targetHours - base * (input.stages.length - 1)).toFixed(2))) : base,
      work: `${stage} work for the template operation.`,
    })),
    executionBlocks: templateExecutionBlocks({ targetDurationHours: targetHours, stages: input.stages, finalizationWindowHours }),
  }
}

function templateExecutionBlocks(input: { targetDurationHours: number; stages: Stage[]; finalizationWindowHours: number }) {
  if (input.targetDurationHours < 2) return undefined
  const executionMinutes = Math.max(15, Math.round((input.targetDurationHours - input.finalizationWindowHours) * 60))
  const blockMinutes = input.targetDurationHours >= 8 ? 60 : 30
  const blockCount = Math.max(1, Math.ceil(executionMinutes / blockMinutes))
  const workStages = input.stages.filter((stage) => stage !== "reporting" && stage !== "handoff")
  const stages = workStages.length ? workStages : input.stages
  return Array.from({ length: blockCount }, (_, index) => {
    const stage = stages[index % stages.length] ?? "recon"
    const remainingMinutes = executionMinutes - index * blockMinutes
    const durationMinutes = Math.max(15, Math.min(blockMinutes, remainingMinutes))
    const id = `template-block-${index + 1}`
    return {
      id,
      stage,
      laneID: templateExecutionLaneID(stage),
      title: `Template execution block ${index + 1}`,
      startMinute: index * blockMinutes,
      durationMinutes,
      objective: `Complete focused ${stage} work for the duration-sized template run.`,
      actions: [
        "Run the next bounded command profile or model lane for this block.",
        "Record evidence, blockers, and fallback decisions before moving to the next block.",
      ],
      successCriteria: [
        "A durable block note exists under work-blocks/.",
        "Evidence references or explicit blockers are recorded for this block.",
      ],
      fallbackWork: [
        "If the primary profile is blocked, switch to lower-risk inventory, normalization, validation, or backlog grooming.",
      ],
      subagents: stage === "validation" ? ["validator"] : ["recon", "attack-map"],
      expectedArtifacts: [`work-blocks/${id}.md`],
    }
  })
}

function templateExecutionLaneID(stage: Stage) {
  switch (stage) {
    case "intake":
    case "recon":
      return "recon"
    case "mapping":
      return "web_inventory"
    case "validation":
      return "finding_validation"
    case "reporting":
      return "report_writing"
    case "handoff":
      return "operator_summary"
  }
}

function templateDiscoveryCharter(input: { template: OperationTemplateID; objective: string; targetDurationHours?: number; stages: Stage[] }) {
  if ((input.targetDurationHours ?? 0) < 2) return undefined
  return {
    purpose: `Establish a duration-sized ${input.template} operation plan for ${input.objective}.`,
    researchQuestions: [
      "Which assets and services are in authorized scope?",
      "Which command profiles and subagent lanes can safely fill the target window?",
      "Which evidence is required for final report confidence?",
    ],
    reconInvestments: [
      "Run bounded inventory before broad execution.",
      "Use safe profile fallbacks when command profiles are blocked or noisy.",
    ],
    operatorQuestions: [
      "Confirm scope exclusions and safety limits.",
      input.template === "report-only"
        ? "Confirm credentialed testing is not required for this report-only closeout."
        : "Confirm whether credentials are available through the secure vault.",
    ],
    candidateDeepWorkLanes: input.stages.map((stage) => `${stage} lane`),
    decisionCriteriaForFullPlan: [
      "The plan has enough safe queued work and fallback work to fill the requested duration.",
      "The plan includes final report, runtime, and audit gates.",
    ],
  }
}

export async function createOperationFromTemplate(
  worktree: string,
  input: {
    operationID?: string
    template: OperationTemplateID
    objective: string
    targetDurationHours?: number
    trustLevel?: OperationTrustLevel
    scanProfile?: OperationScanProfile
    credentialTargets?: string[]
    scopeRules?: string[]
    budgetUSD?: number
    forceReschedule?: boolean
  },
) {
  const targetDurationHours = input.targetDurationHours ?? (input.template === "school-laptop-48h" ? 48 : undefined)
  const trustLevel = input.trustLevel ?? (input.template === "school-laptop-48h" ? "unattended" : undefined)
  const scanProfile = input.scanProfile ?? (input.template === "school-laptop-48h" ? "aggressive" : undefined)
  const goal = await createOperationGoal(worktree, {
    operationID: input.operationID,
    objective: input.objective,
    targetDurationHours,
  })
  const stages = templateStages[input.template]
  const discoveryCharter = templateDiscoveryCharter({
    template: input.template,
    objective: input.objective,
    targetDurationHours,
    stages,
  })
  const planningApproval = discoveryCharter
    ? {
        status: "approved" as const,
        discoveryCharterPath: "plans/discovery-charter.md",
        approver: "operation_template",
        notes: ["Template-created operation charter approved because the operator requested a repeatable operation template."],
      }
    : undefined
  if (discoveryCharter) {
    await writeOperationDiscoveryCharter(worktree, {
      operationID: goal.operationID,
      templateName: input.template,
      trustLevel,
      scanProfile,
      browserEvidence: input.template.includes("web") || input.template === "external-k12-district",
      operationMemory: true,
      planningApproval,
      discoveryCharter,
    })
  }
  const phases = stages.map((stage) => ({
    stage,
    objective: `${input.template} ${stage} phase for ${input.objective}`,
    actions: [
      `Use scan profile ${input.scanProfile ?? "balanced"} and trust level ${input.trustLevel ?? "moderate"}.`,
      "Write durable artifacts before relying on chat context.",
      "Update memory.md with important compaction/resume notes.",
    ],
    successCriteria: [
      "Relevant operation artifacts exist on disk.",
      "Blockers and unknowns are explicit.",
      "Report handoff uses stored evidence and final artifacts.",
    ],
    subagents: stage === "reporting" ? ["report-writer", "report-reviewer"] : stage === "validation" ? ["validator"] : ["recon", "attack-map"],
    noSubagents: ["Do not spawn broad workers without a bounded objective."],
  }))
  const credentialTargets = [
    ...(input.template === "school-laptop-48h" ? ["genesis", "google"] : []),
    ...(input.credentialTargets ?? []),
  ]
    .map((target) => target.trim().toLowerCase())
    .filter(Boolean)
    .filter((target, index, targets) => targets.indexOf(target) === index)
  const scopeRules = [
    ...(input.template === "school-laptop-48h"
        ? [
          "Only test assets and services explicitly authorized for this school laptop operation.",
          "Stay non-destructive unless the operator records separate written approval.",
          "Person and account research must stay limited to role, authorization, identity, and workflow risk; exclude private-life dossier material.",
        ]
      : []),
    ...(input.scopeRules ?? []),
  ]
    .map((rule) => rule.trim())
    .filter(Boolean)
    .filter((rule, index, rules) => rules.indexOf(rule) === index)
  const coverageRequiredLanes =
    input.template === "report-only"
      ? [...REPORT_ONLY_OPERATION_LANES]
      : [
          "recon",
          "web_inventory",
          "evidence_normalization",
          "finding_validation",
          "report_writing",
          "report_review",
          "operator_summary",
        ]
  const reportTargetPages =
    input.template === "report-only"
      ? targetDurationHours !== undefined && targetDurationHours <= 2
        ? 12
        : 35
      : input.template === "school-laptop-48h"
        ? 75
        : 50
  const plan = await writeOperationPlan(worktree, {
    operationID: goal.operationID,
    templateName: input.template,
    trustLevel,
    scanProfile,
    credentialTargets: credentialTargets.length ? credentialTargets : undefined,
    scopeRules: scopeRules.length ? scopeRules : undefined,
    planningApproval,
    discoveryCharter,
    timeBudget: templateTimeBudget({ targetDurationHours, stages }),
    coverageContract: targetDurationHours !== undefined
      ? {
          status: "unmet",
          goals: [
            "Complete all release-blocking graph lanes or record allowed coverage exceptions.",
            "Produce durable evidence for every claimed finding and every explicit non-finding decision.",
          ],
          minimumEvidence: ["operation graph lane proof", "raw command evidence", "normalized evidence index", "final report package"],
          requiredLanes: coverageRequiredLanes,
          allowedSkippedLanes: [],
          fallbackRules: ["Retry timed-out command profiles with lower concurrency before marking a lane blocked."],
          retryRules: ["Retry transient provider/tool failures before using a fallback model or command profile."],
          subagentOpportunities: ["recon inventory", "validation", "report writing", "report review"],
          reportGates: ["report_lint finalHandoff=true", "report_render", "runtime_summary", "operation_audit finalHandoff=true"],
        }
      : undefined,
    browserEvidence: input.template.includes("web") || input.template === "external-k12-district",
    operationMemory: true,
    phases,
    assumptions: [`Template: ${input.template}`],
    reportingCloseout: [
      ...(input.template === "school-laptop-48h"
        ? ["Run laptop_preflight before starting runtime_daemon or supervisor handoff."]
        : []),
      "Produce a polished HTML/PDF final report from durable artifacts.",
      "Run report_lint with finalHandoff=true before delivery.",
      "Run report_render to produce the final HTML/PDF package.",
      "Run runtime_summary so the handoff includes cost, model, compaction, task, and artifact accounting.",
      "Include coverage, handoff checklist, executive summary, technical appendix, and runtime summary sections.",
    ],
  })
  const graph = await writeOperationGraph(worktree, {
    operationID: goal.operationID,
    template: input.template,
    includeSupervisor: (targetDurationHours ?? 0) >= 1,
    budgetUSD: input.budgetUSD,
    trustLevel,
    scanProfile,
    forceReschedule: input.forceReschedule,
  })
  const outline = await writeReportOutline(worktree, {
    operationID: goal.operationID,
    targetPages: reportTargetPages,
    designProfile: "premium",
    includeCoverageSection: true,
    includeHandoffChecklist: true,
  })
  const memory = await updateOperationMemory(worktree, {
    operationID: goal.operationID,
    action: "append",
    section: "Template",
    note:
      input.template === "school-laptop-48h"
        ? `Started from ${input.template}; trust=${trustLevel ?? "moderate"}; scan=${scanProfile ?? "balanced"}. Surface/private Wi-Fi first-real-test defaults: 48h target, laptop_preflight before daemon launch, supervisor required, 75-page final report target.`
        : `Started from ${input.template}; trust=${trustLevel ?? "moderate"}; scan=${scanProfile ?? "balanced"}.`,
  })
  return { operationID: goal.operationID, goal, plan, graph, outline, memory: memory.file }
}
