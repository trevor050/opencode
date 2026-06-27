import fs from "fs/promises"
import { createHash } from "crypto"
import path from "path"
import {
  containsRawCredentialSecret,
  credentialIndexGaps,
  expectedCredentialServices,
  missingCredentialServices,
  validCredentialSubmittedAt,
} from "./credential-safety"
import {
  hasExactCommandArg,
  hasExactCommandFlag,
  hasExactCommandToken,
  hasExactCommandTokens,
  hasShellControlOperator,
} from "./command-text"

export type FirstRunObjectiveCheckStatus = "covered" | "weak" | "missing"

export type FirstRunObjectiveCheck = {
  id: string
  requirement: string
  status: FirstRunObjectiveCheckStatus
  evidence: string[]
  detail: string
}

export type FirstRunObjectiveAuditInput = {
  operationID?: string
  outputDir?: string
  behaviorProbeDir?: string
  harnessScorecardDir?: string
}

export type FirstRunObjectiveAuditResult = {
  status: "ready" | "incomplete"
  checkedAt: string
  launchDecision: FirstRunObjectiveLaunchDecision
  objectiveMatrix: FirstRunObjectiveMatrixItem[]
  checks: FirstRunObjectiveCheck[]
  gaps: string[]
  nextActions: FirstRunObjectiveNextAction[]
  files: {
    json: string
    markdown: string
    nextActionsJson: string
    nextActionsMarkdown: string
    operationJson?: string
    operationMarkdown?: string
    operationNextActionsJson?: string
    operationNextActionsMarkdown?: string
  }
}

export type FirstRunObjectiveNextAction = {
  id: string
  title: string
  status: "required" | "blocked" | "ready" | "watch"
  reason: string
  blockedBy: string[]
  links: string[]
  commands: string[]
  artifacts: string[]
}

export type FirstRunObjectiveMatrixItem = {
  id: string
  requirement: string
  status: FirstRunObjectiveCheckStatus
  mappedChecks: string[]
  nextActionIds: string[]
  evidence: string[]
  detail: string
}

export type FirstRunObjectiveLaunchDecision = {
  status: "blocked" | "ready-to-launch" | "complete"
  canStartDaemon: boolean
  canClaimObjectiveComplete: boolean
  nextActionId?: string
  blockerActionIds: string[]
  reason: string
}

const objectiveRequirementMatrix: Array<{
  id: string
  requirement: string
  mappedChecks: string[]
  detail: string
}> = [
  {
    id: "school-surface-private-wifi-launch",
    requirement: "Start the first real school laptop/private Wi-Fi run from an execution-ready launch packet and strict laptop preflight.",
    mappedChecks: [
      "school-laptop-48h-template",
      "laptop-preflight",
      "first-run-launch-packet",
      "selected-operation-template",
      "selected-operation-launch-packet",
      "selected-operation-preflight",
    ],
    detail: "Covers Microsoft Surface-style unattended handoff, power/sleep/Wi-Fi/scope/clock confirmations, supervisor files, and exact launch commands.",
  },
  {
    id: "authorized-service-credential-handoff",
    requirement: "Accept authorized credentials for Genesis, Google, and other plan-named services without leaking raw secrets into artifacts.",
    mappedChecks: [
      "selected-operation-template",
      "selected-operation-launch-packet",
      "selected-operation-credential-review",
      "selected-operation-preflight",
      "literal-48h-proof",
    ],
    detail: "Credential proof must come from the secure vault submission and redacted indexes before preflight and before the daemon starts.",
  },
  {
    id: "two-day-unattended-runtime",
    requirement: "Run unattended for the selected two-day target with short canary proof first and literal wall-clock proof after the real run.",
    mappedChecks: [
      "school-laptop-48h-template",
      "wall-clock-canary",
      "selected-operation-canary-proof",
      "literal-48h-proof",
      "extended-harness-scorecards",
    ],
    detail: "Fresh harness scorecards, matching 120-second canary proof, and selected-operation literal daemon readiness all have to line up.",
  },
  {
    id: "multi-angle-attack-modeling",
    requirement: "Model the engagement from network, SaaS, identity, authorization, workflow, evidence, and reporting angles.",
    mappedChecks: [
      "school-laptop-48h-template",
      "behavior-probe",
      "live-behavior-probes",
      "selected-operation-template",
      "selected-operation-preflight",
    ],
    detail: "Plan and graph proof must include role/account/identity boundaries, identity lanes, and behavior probes that reward evidence-first reasoning.",
  },
  {
    id: "professional-role-dossiers",
    requirement: "Build professional people, account, role, and identity context while excluding irrelevant private-life dossier material.",
    mappedChecks: ["behavior-probe", "live-behavior-probes", "selected-operation-template", "selected-operation-preflight", "final-report-fanout"],
    detail: "Professional people and identity artifacts are required, and private-life dossier material stays out of scope.",
  },
  {
    id: "exploit-chain-synthesis",
    requirement: "Synthesize exploit chains from validated evidence while rejecting destructive proof and unsafe exfiltration behavior.",
    mappedChecks: ["behavior-probe", "live-behavior-probes", "extended-harness-scorecards", "literal-48h-proof"],
    detail: "The watcher/probes cover chain reasoning, exploit-safety boundaries, and final proof must be tied to selected-operation evidence.",
  },
  {
    id: "continuous-behavior-observation",
    requirement: "Continuously probe and observe model behavior against synthetic scenarios instead of relying on deterministic unit tests alone.",
    mappedChecks: ["behavior-probe", "live-behavior-probes", "extended-harness-scorecards"],
    detail: "Live probe JSON, transcripts, prompts, and fresh chaos/full/overnight harness scorecards are required after relevant source changes.",
  },
  {
    id: "protected-hour-45-finalization",
    requirement: "Switch from broad expansion to report closeout during the protected finalization window near hour 45 of the 48h run.",
    mappedChecks: ["protected-finalization-window", "literal-48h-proof"],
    detail: "Scheduler and supervisor proof must route finalization work before the selected literal readiness proof can count.",
  },
  {
    id: "specialized-subreport-fanout",
    requirement: "Fan out specialized stakeholder subreports for board, CEH technical review, ULM operators, runtime, evidence, and findings.",
    mappedChecks: ["final-report-fanout", "literal-48h-proof"],
    detail: "The final manifest and readiness proof must cover stakeholder markdown/PDFs plus findings, evidence, runtime, and support files.",
  },
  {
    id: "massive-modern-final-report-package",
    requirement: "Produce a long, modern, styled final report package with HTML, PDF, manifest, indexes, and stakeholder-ready derivatives.",
    mappedChecks: ["final-report-fanout", "literal-48h-proof"],
    detail: "For the school-laptop template, final readiness requires the 75-page outline/PDF gates and styled final package integrity.",
  },
  {
    id: "selected-real-run-proof",
    requirement: "Prove the actual selected operation, not a synthetic proxy, completed all first-run gates and the real target-hours daemon.",
    mappedChecks: [
      "selected-operation-template",
      "selected-operation-launch-packet",
      "selected-operation-credential-review",
      "selected-operation-preflight",
      "selected-operation-canary-proof",
      "literal-48h-proof",
    ],
    detail: "This remains missing until the selected operation has submitted credentials, passing preflight, matching canary proof, and literal 48h readiness.",
  },
]

async function readText(file: string) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readJson<T>(file: string) {
  const text = await readText(file)
  if (!text) return undefined
  return JSON.parse(text) as T
}

function hasAll(text: string | undefined, needles: string[]) {
  return !!text && needles.every((needle) => text.includes(needle))
}

function check(input: FirstRunObjectiveCheck): FirstRunObjectiveCheck {
  return input
}

function checkStatus(checks: FirstRunObjectiveCheck[], id: string) {
  return checks.find((item) => item.id === id)?.status
}

function nextActionIDsForMissingChecks(missingChecks: string[], checkStatuses: Map<string, FirstRunObjectiveCheckStatus>) {
  const ids = new Set<string>()
  for (const checkID of missingChecks) {
    if (checkID === "selected-operation-template") ids.add("repair-selected-operation-plan")
    if (checkID === "selected-operation-launch-packet") ids.add("create-launch-packet")
    if (checkID === "selected-operation-credential-review") ids.add("submit-credential-vault")
    if (checkID === "selected-operation-canary-proof") ids.add("run-wall-clock-canary")
    if (checkID === "selected-operation-preflight") {
      if (checkStatuses.get("selected-operation-credential-review") !== "covered") ids.add("submit-credential-vault")
      ids.add("run-laptop-preflight")
    }
    if (checkID === "extended-harness-scorecards") ids.add("refresh-harness-scorecards")
    if (checkID === "live-behavior-probes") ids.add("refresh-live-behavior-probes")
    if (checkID === "literal-48h-proof") {
      if (checkStatuses.get("selected-operation-credential-review") !== "covered") ids.add("submit-credential-vault")
      if (checkStatuses.get("selected-operation-preflight") !== "covered") ids.add("run-laptop-preflight")
      ids.add("run-literal-target-hours")
    }
  }
  return Array.from(ids)
}

function buildObjectiveMatrix(checks: FirstRunObjectiveCheck[]): FirstRunObjectiveMatrixItem[] {
  const byID = new Map(checks.map((item) => [item.id, item]))
  const checkStatuses = new Map(checks.map((item) => [item.id, item.status]))
  return objectiveRequirementMatrix.map((item) => {
    const mapped = item.mappedChecks.map((id) => byID.get(id))
    const missing = mapped
      .filter((check): check is FirstRunObjectiveCheck => check !== undefined && check.status !== "covered")
      .map((check) => check.id)
    const absent = item.mappedChecks.filter((id) => !byID.has(id))
    const weak = mapped.some((check) => check?.status === "weak")
    const status: FirstRunObjectiveCheckStatus =
      missing.length === 0 && absent.length === 0 ? "covered" : weak ? "weak" : "missing"
    const nextActionIds = nextActionIDsForMissingChecks([...missing, ...absent], checkStatuses)
    const evidence = Array.from(new Set(mapped.flatMap((check) => check?.evidence ?? []))).sort()
    const detailParts = [
      item.detail,
      `mapped_checks=${item.mappedChecks.join(",")}`,
      `missing_checks=${missing.length ? missing.join(",") : "none"}`,
      `next_actions=${nextActionIds.length ? nextActionIds.join(",") : "none"}`,
      `absent_checks=${absent.length ? absent.join(",") : "none"}`,
    ]
    return {
      id: item.id,
      requirement: item.requirement,
      status,
      mappedChecks: item.mappedChecks,
      nextActionIds,
      evidence,
      detail: detailParts.join("; "),
    }
  })
}

function buildLaunchDecision(
  checks: FirstRunObjectiveCheck[],
  nextActions: FirstRunObjectiveNextAction[],
): FirstRunObjectiveLaunchDecision {
  const literalStatus = checkStatus(checks, "literal-48h-proof")
  if (literalStatus === "covered") {
    return {
      status: "complete",
      canStartDaemon: false,
      canClaimObjectiveComplete: true,
      nextActionId: "objective-ready",
      blockerActionIds: [],
      reason: "The selected operation has literal target-hours proof and the objective audit can be treated as complete.",
    }
  }

  const literalAction = nextActions.find((action) => action.id === "run-literal-target-hours")
  if (literalAction?.status === "required" && literalAction.blockedBy.length === 0) {
    return {
      status: "ready-to-launch",
      canStartDaemon: true,
      canClaimObjectiveComplete: false,
      nextActionId: literalAction.id,
      blockerActionIds: [],
      reason: literalAction.reason,
    }
  }

  const blockerActionIds = nextActions
    .filter((action) => action.status === "required" || action.status === "blocked")
    .map((action) => action.id)
  return {
    status: "blocked",
    canStartDaemon: false,
    canClaimObjectiveComplete: false,
    nextActionId: blockerActionIds[0],
    blockerActionIds,
    reason: blockerActionIds.length
      ? `Do not start the real daemon until these actions are resolved: ${blockerActionIds.join(", ")}.`
      : "Do not start the real daemon until the objective audit produces an explicit launch action.",
  }
}

function detailList(detail: string | undefined, key: string) {
  return (detailValue(detail, key) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "none" && item !== "missing")
}

function operationRoot(repoRoot: string, operationID: string | undefined) {
  return operationID ? path.join(repoRoot, ".ulmcode", "operations", operationID) : undefined
}

function detailNumber(detail: string | undefined, key: string) {
  const match = detail?.match(new RegExp(`${key}\\s*[:=]\\s*(\\d+)`))
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function detailValue(detail: string | undefined, key: string) {
  const match = detail?.match(new RegExp(`${key}\\s*[:=]\\s*([^;\\s]+)`))
  return match?.[1]
}

function sha256(content: string | undefined) {
  return content === undefined ? undefined : createHash("sha256").update(content).digest("hex")
}

function titleCredentialService(service: string) {
  if (service.toLowerCase() === "classlink") return "ClassLink"
  return service
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function sentenceList(items: string[]) {
  if (items.length <= 1) return items[0] ?? ""
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`
}

function numberArg(command: string[] | undefined, name: string) {
  const index = command?.indexOf(name) ?? -1
  if (!command || index === -1) return undefined
  const parsed = Number(command[index + 1])
  return Number.isFinite(parsed) ? parsed : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const requiredLiteral48hChecks = [
  "literal-runtime-proof",
  "daemon-heartbeat-continuity",
  "literal-work-proof",
  "laptop-preflight-proof",
  "laptop-preflight-bypass",
  "credential-handoff-proof",
  "final-package",
  "final-operation-audit",
] as const
const requiredLiteral48hDetailEvidence = [
  { id: "final-package", evidence: "missing_manifest_files=none", label: "final-package:file-proof" },
  { id: "final-package", evidence: "missing_manifest_artifacts=none", label: "final-package:artifact-proof" },
  { id: "final-package", evidence: "stakeholder_gaps=none", label: "final-package:stakeholder-proof" },
  { id: "final-operation-audit", evidence: "ok=true", label: "final-operation-audit:ok" },
  { id: "final-operation-audit", evidence: "blockers=0", label: "final-operation-audit:blockers" },
  { id: "final-operation-audit", evidence: "fresh=true", label: "final-operation-audit:fresh" },
  { id: "final-operation-audit", evidence: "final_handoff=proved", label: "final-operation-audit:handoff" },
  { id: "final-operation-audit", evidence: "required_min_outline_target_pages=75", label: "final-operation-audit:outline-75" },
  { id: "final-operation-audit", evidence: "required_min_pdf_pages=75", label: "final-operation-audit:pdf-75" },
  { id: "credential-handoff-proof", evidence: "credential_before_daemon_start=true", label: "credential-handoff-proof:before-daemon-start" },
] as const
const requiredFinalManifestArtifacts = [
  "html",
  "pdf",
  "readme",
  "findingsJson",
  "evidenceIndex",
  "peopleProfiles",
  "identityGraph",
  "operatorReview",
  "executiveSummary",
  "technicalAppendix",
  "boardReport",
  "boardReportPdf",
  "cehTechnicalReport",
  "cehTechnicalReportPdf",
  "ulmTeamReport",
  "ulmTeamReportPdf",
  "runtimeSummaryMarkdown",
] as const
const requiredSelectedCanaryChecks = [
  "literal-runtime-proof",
  "daemon-heartbeat-continuity",
  "literal-work-proof",
  "final-package",
  "final-operation-audit",
] as const
const requiredSelectedCanaryDetailEvidence = [
  { id: "final-package", evidence: "missing_manifest_files=none", label: "final-package:file-proof" },
] as const
const requiredPreflightChecks = [
  "duration-plan",
  "plan-fingerprint",
  "operation-graph",
  "supervisor-manifest",
  "supervisor-runbook",
  "tool-preflight",
  "model-route-audit",
  "report-outline",
  "credential-vault",
  "operator-power",
  "operator-sleep",
  "operator-wifi",
  "operator-scope",
  "operator-clock",
] as const
const requiredBehaviorProbeScenarios = [
  "k12-sso-roster-export-chain",
  "quick-network-resume-checkpoint",
  "privileged-dossier-attack-chain-report",
  "k12-exploit-chain-safety",
] as const
type RequiredBehaviorProbeScenario = (typeof requiredBehaviorProbeScenarios)[number]
const requiredExtendedHarnessTiers = [
  { tier: "chaos", scenarioID: "provider-sse-repair-chaos" },
  { tier: "full", scenarioID: "synthetic-full-operation" },
  { tier: "overnight", scenarioID: "overnight-readiness-contract" },
] as const
type RequiredExtendedHarnessTier = (typeof requiredExtendedHarnessTiers)[number]["tier"]

async function readDirFiles(dir: string) {
  try {
    return await fs.readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

async function exists(file: string | undefined) {
  if (!file) return false
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function manifestArtifactExists(finalDir: string, artifactPath: unknown) {
  if (typeof artifactPath !== "string" || !artifactPath.trim()) return false
  const resolved = path.resolve(finalDir, artifactPath)
  if (!resolved.startsWith(finalDir + path.sep)) return false
  return exists(resolved)
}

function manifestArtifactPath(finalDir: string, artifactPath: unknown) {
  if (typeof artifactPath !== "string" || !artifactPath.trim()) return undefined
  const resolved = path.resolve(finalDir, artifactPath)
  return resolved.startsWith(finalDir + path.sep) ? resolved : undefined
}

function pdfPageCount(pdf: string | undefined) {
  const match = pdf?.match(/\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)/)
  const pages = Number.parseInt(match?.[1] ?? "", 10)
  return Number.isFinite(pages) && pages > 0 ? pages : undefined
}

async function finalPackagePdfGaps(finalDir: string | undefined, artifacts: Record<string, unknown> | undefined, input: { minMainPages?: number }) {
  if (!finalDir || !artifacts) return []
  const checks = [
    { key: "pdf", label: "report.pdf", minPages: input.minMainPages },
    { key: "boardReportPdf", label: "board-report.pdf" },
    { key: "cehTechnicalReportPdf", label: "ceh-technical-report.pdf" },
    { key: "ulmTeamReportPdf", label: "ulm-team-report.pdf" },
  ]
  const gaps: string[] = []
  for (const check of checks) {
    const file = manifestArtifactPath(finalDir, artifacts[check.key])
    if (!file) continue
    const body = await readText(file)
    if (body === undefined) continue
    if (!body.startsWith("%PDF-")) gaps.push(`${check.label}:not-pdf`)
    if (!body.includes("/ULMCodeRenderer (styled-html)")) gaps.push(`${check.label}:missing-styled-renderer`)
    const pages = pdfPageCount(body)
    if (!pages) gaps.push(`${check.label}:page-count-missing`)
    else if (check.minPages && pages < check.minPages) gaps.push(`${check.label}:pages=${pages}`)
  }
  return gaps
}

async function collectFinalPackageStakeholderGaps(finalDir: string | undefined, artifacts: Record<string, unknown> | undefined) {
  if (!finalDir || !artifacts) return []
  const checks = [
    { key: "html", label: "report.html", terms: ["<!doctype html", "Finding State Counts", "Operation:"] },
    { key: "readme", label: "README.md", terms: ["## Files", "## Findings", "## Evidence"] },
    { key: "operatorReview", label: "operator-review.md", terms: ["Operation:", "## Handoff State", "## Review Before Client Delivery"] },
    { key: "executiveSummary", label: "executive-summary.md", terms: ["Operation:", "## Overview", "## Priority Items"] },
    { key: "technicalAppendix", label: "technical-appendix.md", terms: ["Operation:", "## Scope And Methodology", "## Evidence Index"] },
    { key: "boardReport", label: "board-report.md", terms: ["Operation:", "## Executive Decision Summary", "## Recommended Board Actions"] },
    { key: "cehTechnicalReport", label: "ceh-technical-report.md", terms: ["Operation:", "## Scope And Methodology", "## Validated Findings", "## Evidence Map"] },
    { key: "ulmTeamReport", label: "ulm-team-report.md", terms: ["Operation:", "## Harness Run State", "## Residual Harness Risks"] },
    { key: "runtimeSummaryMarkdown", label: "runtime-summary.md", terms: ["# Runtime Summary"] },
  ]
  const gaps: string[] = []
  for (const check of checks) {
    const file = manifestArtifactPath(finalDir, artifacts[check.key])
    const body = file ? await readText(file) : undefined
    if (!body?.trim()) {
      gaps.push(`${check.label}:empty`)
      continue
    }
    for (const term of check.terms) {
      if (!body.includes(term)) gaps.push(`${check.label}:missing:${term}`)
    }
  }
  return gaps
}

async function nonEmptyFileIncludes(file: string | undefined, needle: string) {
  const text = file ? await readText(file) : undefined
  return !!text?.trim() && text.includes(needle)
}

function resolveProbeArtifact(probeDir: string, value: string | undefined) {
  if (!value) return undefined
  return path.isAbsolute(value) ? value : path.join(probeDir, value)
}

async function collectHarnessScorecardFiles(dir: string): Promise<string[]> {
  let entries: Array<import("fs").Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, "scorecard.json"))
}

async function maxMtime(files: string[]) {
  let newest = 0
  for (const file of files) {
    try {
      newest = Math.max(newest, (await fs.stat(file)).mtimeMs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return newest
}

async function selectedOperationTemplate(repoRoot: string, operationID: string | undefined): Promise<FirstRunObjectiveCheck> {
  const root = operationRoot(repoRoot, operationID)
  const planPath = root ? path.join(root, "plans", "operation-plan.json") : undefined
  const plan = planPath
    ? await readJson<{
      operationID?: string
      templateName?: string
      credentialTargets?: string[]
      scopeRules?: string[]
      timeBudget?: { targetHours?: number; finalizationWindowHours?: number }
    }>(planPath)
    : undefined
  const planOperationMatches = !operationID || plan?.operationID === operationID
  const requiredCredentialTargets = plan?.templateName === "school-laptop-48h" ? ["genesis", "google"] : []
  const credentialTargets = plan?.credentialTargets ?? []
  const missingCredentialTargets = requiredCredentialTargets.filter((target) => !credentialTargets.includes(target))
  const seenCredentialTargets = new Set<string>()
  const credentialTargetGaps = credentialTargets.flatMap((target) => {
    const normalized = target.trim().toLowerCase()
    const gaps: string[] = []
    if (!normalized) gaps.push("blank")
    if (target !== normalized) gaps.push(`noncanonical:${target}`)
    if (normalized && seenCredentialTargets.has(normalized)) gaps.push(`duplicate:${normalized}`)
    if (normalized) seenCredentialTargets.add(normalized)
    return gaps
  })
  const scopeRules = plan?.scopeRules ?? []
  const scopeRulesReady = scopeRules.length > 0
  const seenScopeRules = new Set<string>()
  const scopeRuleGaps = scopeRules.flatMap((rule) => {
    const trimmed = rule.trim()
    const gaps: string[] = []
    if (!trimmed) gaps.push("blank")
    if (rule !== trimmed) gaps.push("noncanonical")
    if (trimmed && seenScopeRules.has(trimmed)) gaps.push("duplicate")
    if (trimmed) seenScopeRules.add(trimmed)
    return gaps
  })
  const scopeRuleText = scopeRules.join("\n").toLowerCase()
  const missingScopeBaselines =
    plan?.templateName === "school-laptop-48h"
      ? [
          /\b(?:explicitly authorized|approved)\b/.test(scopeRuleText) && /\b(?:assets?|services?|targets?)\b/.test(scopeRuleText)
            ? undefined
            : "authorized-assets",
          /\bnon[- ]destructive\b/.test(scopeRuleText) && /\b(?:separate|explicit|written)\b/.test(scopeRuleText)
            ? undefined
            : "non-destructive",
          /\b(?:person|people|account|role)\b/.test(scopeRuleText) &&
          /\b(?:identity|authorization|access|workflow)\b/.test(scopeRuleText) &&
          /\b(?:exclude|avoid|no)\b/.test(scopeRuleText) &&
          /\b(?:private[- ]life|private dossier|dossier material)\b/.test(scopeRuleText)
            ? undefined
            : "identity-boundary",
        ].filter((item): item is string => item !== undefined)
      : []
  const covered =
    planOperationMatches &&
    plan?.templateName === "school-laptop-48h" &&
    (plan.timeBudget?.targetHours ?? 0) >= 48 &&
    (plan.timeBudget?.finalizationWindowHours ?? 0) > 0 &&
    missingCredentialTargets.length === 0 &&
    credentialTargetGaps.length === 0 &&
    scopeRulesReady &&
    scopeRuleGaps.length === 0 &&
    missingScopeBaselines.length === 0
  return check({
    id: "selected-operation-template",
    requirement: "The selected operation is the real school-laptop-48h operation with a 48h time budget and protected finalization window.",
    status: covered ? "covered" : "missing",
    evidence: planPath ? [planPath] : [],
    detail: plan
      ? `template=${plan.templateName ?? "missing"}; plan_operation_id=${plan.operationID ?? "missing"}; selected_operation_id=${operationID ?? "missing"}; target_hours=${plan.timeBudget?.targetHours ?? "missing"}; finalization_window_hours=${plan.timeBudget?.finalizationWindowHours ?? "missing"}; credential_targets=${credentialTargets.join(",") || "none"}; missing_credential_targets=${missingCredentialTargets.length ? missingCredentialTargets.join(",") : "none"}; credential_target_gaps=${credentialTargetGaps.length ? credentialTargetGaps.join(",") : "none"}; scope_rules=${scopeRulesReady ? scopeRules.length : "missing"}; scope_rule_gaps=${scopeRuleGaps.length ? scopeRuleGaps.join(",") : "none"}; missing_scope_baselines=${missingScopeBaselines.length ? missingScopeBaselines.join(",") : "none"}`
      : operationID
        ? "operation-plan.json is missing for the selected operation"
        : "no operationID was supplied, so no selected operation plan can be inspected",
  })
}

async function selectedOperationLaunchPacket(repoRoot: string, operationID: string | undefined): Promise<FirstRunObjectiveCheck> {
  const root = operationRoot(repoRoot, operationID)
  const packetPath = root ? path.join(root, "scheduler", "first-run-launch-packet.json") : undefined
  const supervisorRunbookPath = root ? path.join(root, "scheduler", "supervisor", "supervisor-install.md") : undefined
  const planPath = root ? path.join(root, "plans", "operation-plan.json") : undefined
  const plan = planPath ? await readJson<unknown>(planPath) : undefined
  const supervisorRunbook = supervisorRunbookPath ? await readText(supervisorRunbookPath) : undefined
  const expectedServices = expectedCredentialServices(plan)
  const expectedScopeRules =
    plan && typeof plan === "object" && !Array.isArray(plan) && Array.isArray((plan as { scopeRules?: unknown }).scopeRules)
      ? (plan as { scopeRules: unknown[] }).scopeRules
          .filter((rule): rule is string => typeof rule === "string")
          .map((rule) => rule.trim())
          .filter(Boolean)
      : []
  const packet = packetPath
    ? await readJson<{
        operationID?: string
        status?: string
        template?: string
        targetHours?: number
        commands?: Record<string, string | undefined>
        credentialRequirements?: {
          required?: boolean
          expectedServices?: string[]
          vaultPath?: string
          openVaultCommand?: string
          reviewCommand?: string
        }
        scopeRequirements?: {
          required?: boolean
          rules?: string[]
        }
        requiredBeforeLaunch?: Array<{ id?: string; detail?: string }>
        files?: { operationRoot?: string }
      }>(packetPath)
    : undefined
  const requiredItems = [
    "wall-power",
    "sleep-disabled",
    "school-wifi",
    "scope-confirmed",
    "clock-confirmed",
    "credential-review",
    "model-route-audit",
    "tool-model-preflight",
    "wall-clock-canary",
    "laptop-preflight",
    "launch-supervisor",
  ]
  const packetItemIDs = (packet?.requiredBeforeLaunch ?? []).map((item) => item.id).filter((id): id is string => Boolean(id))
  const packetItems = new Set(packetItemIDs)
  const missingItems = requiredItems.filter((id) => !packetItems.has(id))
  const unexpectedItems = packetItemIDs.filter((id) => !requiredItems.includes(id))
  const seenPacketItems = new Set<string>()
  const duplicateItems = packetItemIDs.filter((id) => {
    if (seenPacketItems.has(id)) return true
    seenPacketItems.add(id)
    return false
  })
  const commandText = Object.values(packet?.commands ?? {}).join("\n")
  const expectedOperationRoot = root ? path.resolve(root) : undefined
  const packetOperationRoot = packet?.files?.operationRoot ? path.resolve(packet.files.operationRoot) : undefined
  const operationRootMatches = !!expectedOperationRoot && packetOperationRoot === expectedOperationRoot
  const planTargetHours =
    plan && typeof plan === "object" && !Array.isArray(plan) && typeof (plan as { timeBudget?: { targetHours?: unknown } }).timeBudget?.targetHours === "number"
      ? (plan as { timeBudget: { targetHours: number } }).timeBudget.targetHours
      : undefined
  const expectedTargetHours = planTargetHours ?? packet?.targetHours ?? 48
  const targetHoursMatches = typeof packet?.targetHours === "number" && packet.targetHours === expectedTargetHours
  const requiredCommandTerms = [
    "/ulm/credentials?operationID=",
    "operation_credentials action=open_vault",
    "ulm:credential-review",
    "ulm:wall-clock-canary",
    "ulm:laptop-preflight",
    "ulm:runtime-daemon",
    `--duration-hours ${expectedTargetHours}`,
    "ulm:literal-run-readiness",
    "ulm:first-run-objective-audit",
  ]
  const missingCommandTerms = requiredCommandTerms.filter((term) => !commandText.includes(term))
  if (!hasExactCommandFlag(commandText, "--require-launch-ready")) missingCommandTerms.push("--require-launch-ready")
  if (!hasExactCommandArg(commandText, "--operation-id", operationID)) {
    missingCommandTerms.push(`--operation-id ${operationID ?? ""}`)
  }
  const credentialReviewCommand = packet?.commands?.credentialReview
  const credentialVaultPath = packet?.commands?.credentialVaultPath
  const openCredentialVaultCommand = packet?.commands?.openCredentialVault
  const canaryCommand = packet?.commands?.canary
  const preflightCommand = packet?.commands?.preflight
  const daemon48hCommand = packet?.commands?.daemon48h
  const supervisorCommand = packet?.commands?.supervisor
  const readinessCommand = packet?.commands?.readiness
  const objectiveAuditCommand = packet?.commands?.objectiveAudit
  const launchReadinessCommand = packet?.commands?.launchReadiness
  const packageScriptPrefix = ["bun", "run", "--cwd", "packages/opencode"]
  const exactCommandReady = (command: string | undefined, expectedTokens: Array<string | undefined>) =>
    typeof command === "string" &&
    expectedTokens.every((token): token is string => typeof token === "string" && token.length > 0) &&
    !hasShellControlOperator(command) &&
    hasExactCommandTokens(command, expectedTokens)
  const credentialReviewCommandReady =
    exactCommandReady(credentialReviewCommand, [...packageScriptPrefix, "ulm:credential-review", operationID, "--strict", "--json"])
  const credentialVaultPathReady =
    typeof credentialVaultPath === "string" && credentialVaultPath === `/ulm/credentials?operationID=${operationID ?? ""}`
  const openCredentialVaultCommandReady =
    exactCommandReady(openCredentialVaultCommand, ["operation_credentials", "action=open_vault", operationID ? `operationID=${operationID}` : undefined])
  const expectedCanaryOperationID = operationID ? `${operationID}-canary` : undefined
  const canaryCommandReady =
    exactCommandReady(canaryCommand, [
      ...packageScriptPrefix,
      "ulm:wall-clock-canary",
      expectedCanaryOperationID,
      "--target-seconds",
      "120",
      "--strict",
      "--json",
    ])
  const preflightCommandReady =
    exactCommandReady(preflightCommand, [
      ...packageScriptPrefix,
      "ulm:laptop-preflight",
      operationID,
      "--prepare",
      "--strict",
      "--confirm",
      "power",
      "--confirm",
      "sleep",
      "--confirm",
      "wifi",
      "--confirm",
      "scope",
      "--confirm",
      "clock",
      "--json",
    ])
  const daemon48hCommandReady =
    exactCommandReady(daemon48hCommand, [
      ...packageScriptPrefix,
      "ulm:runtime-daemon",
      operationID,
      "--duration-hours",
      String(expectedTargetHours),
      "--detach",
      "--json",
    ])
  const supervisorCommandReady =
    exactCommandReady(supervisorCommand, [
      ...packageScriptPrefix,
      "ulm:runtime-daemon",
      operationID,
      "--duration-hours",
      String(expectedTargetHours),
      "--supervisor",
      "all",
      "--json",
    ])
  const readinessCommandReady =
    exactCommandReady(readinessCommand, [...packageScriptPrefix, "ulm:literal-run-readiness", operationID, "--strict", "--json"])
  const objectiveAuditCommandReady =
    exactCommandReady(objectiveAuditCommand, [
      ...packageScriptPrefix,
      "ulm:first-run-objective-audit",
      "--operation-id",
      operationID,
      "--json",
    ])
  const launchReadinessCommandReady =
    exactCommandReady(launchReadinessCommand, [
      ...packageScriptPrefix,
      "ulm:first-run-objective-audit",
      "--operation-id",
      operationID,
      "--require-launch-ready",
      "--json",
    ])
  const commandGaps = [
    credentialVaultPathReady ? undefined : "credentialVaultPath:exact-operation-path",
    openCredentialVaultCommandReady ? undefined : "openCredentialVault:exact-operation-command",
    credentialReviewCommandReady ? undefined : "credentialReview:exact-operation-command",
    canaryCommandReady ? undefined : "canary:exact-operation-canary-command",
    preflightCommandReady ? undefined : "preflight:exact-operation-command",
    daemon48hCommandReady ? undefined : "daemon48h:exact-operation-duration-command",
    supervisorCommandReady ? undefined : "supervisor:exact-operation-supervisor-command",
    readinessCommandReady ? undefined : "readiness:exact-operation-command",
    objectiveAuditCommandReady ? undefined : "objectiveAudit:exact-operation-command",
    launchReadinessCommandReady ? undefined : "launchReadiness:exact-operation-readiness-command",
  ].filter((item): item is string => Boolean(item))
  const supervisorRunbookLaunchReadiness =
    supervisorRunbook?.includes("Launch Readiness Gate") === true &&
    hasExactCommandFlag(supervisorRunbook, "--require-launch-ready") &&
    hasExactCommandArg(supervisorRunbook, "--operation-id", operationID)
  const credentialRequirements = packet?.credentialRequirements
  const credentialRequirementServices = credentialRequirements?.expectedServices ?? []
  const missingCredentialRequirementServices = expectedServices.filter((service) => !credentialRequirementServices.includes(service))
  const unexpectedCredentialRequirementServices = credentialRequirementServices.filter(
    (service) => !expectedServices.includes(service),
  )
  const seenCredentialRequirementServices = new Set<string>()
  const credentialRequirementGaps = credentialRequirementServices.flatMap((service) => {
    const normalized = service.trim().toLowerCase()
    const gaps: string[] = []
    if (!normalized) gaps.push("blank")
    if (service !== normalized) gaps.push(`noncanonical:${service}`)
    if (normalized && seenCredentialRequirementServices.has(normalized)) gaps.push(`duplicate:${normalized}`)
    if (normalized) seenCredentialRequirementServices.add(normalized)
    return gaps
  })
  const credentialRequirementVaultPathReady =
    credentialRequirements?.vaultPath === `/ulm/credentials?operationID=${operationID ?? ""}`
  const credentialRequirementOpenVaultCommandReady =
    exactCommandReady(credentialRequirements?.openVaultCommand, [
      "operation_credentials",
      "action=open_vault",
      operationID ? `operationID=${operationID}` : undefined,
    ])
  const credentialRequirementReviewCommandReady =
    exactCommandReady(credentialRequirements?.reviewCommand, [
      ...packageScriptPrefix,
      "ulm:credential-review",
      operationID,
      "--strict",
      "--json",
    ])
  const credentialRequirementCommandMirrorReady =
    credentialRequirements?.vaultPath === packet?.commands?.credentialVaultPath &&
    credentialRequirements?.openVaultCommand === packet?.commands?.openCredentialVault &&
    credentialRequirements?.reviewCommand === packet?.commands?.credentialReview
  const credentialRequirementCommandGaps = [
    credentialRequirementVaultPathReady ? undefined : "vaultPath:exact-operation-path",
    credentialRequirementOpenVaultCommandReady ? undefined : "openVaultCommand:exact-operation-command",
    credentialRequirementReviewCommandReady ? undefined : "reviewCommand:exact-operation-command",
    credentialRequirementCommandMirrorReady ? undefined : "packetCommandMirror:matches-packet-commands",
  ].filter((item): item is string => Boolean(item))
  const credentialRequirementsReady =
    expectedServices.length === 0 ||
    (credentialRequirements?.required === true &&
      credentialRequirementVaultPathReady &&
      credentialRequirementOpenVaultCommandReady &&
      credentialRequirementReviewCommandReady &&
      credentialRequirementCommandMirrorReady &&
      missingCredentialRequirementServices.length === 0 &&
      unexpectedCredentialRequirementServices.length === 0 &&
      credentialRequirementGaps.length === 0)
  const credentialRequirementsDetail = credentialRequirements
    ? `required=${credentialRequirements.required === true}; expected=${credentialRequirementServices.join(",") || "none"}; missing=${missingCredentialRequirementServices.length ? missingCredentialRequirementServices.join(",") : "none"}; unexpected=${unexpectedCredentialRequirementServices.length ? unexpectedCredentialRequirementServices.join(",") : "none"}; gaps=${credentialRequirementGaps.length ? credentialRequirementGaps.join(",") : "none"}; command_gaps=${credentialRequirementCommandGaps.length ? credentialRequirementCommandGaps.join(",") : "none"}`
    : "missing"
  const credentialChecklistDetail =
    packet?.requiredBeforeLaunch?.find((item) => item.id === "credential-review")?.detail ?? ""
  const credentialChecklistDetailLower = credentialChecklistDetail.toLowerCase()
  const credentialChecklistMissingServices = expectedServices
    .map((service) => ({ service, title: titleCredentialService(service) }))
    .filter(
      ({ service, title }) =>
        !credentialChecklistDetailLower.includes(service.toLowerCase()) &&
        !credentialChecklistDetailLower.includes(title.toLowerCase()),
    )
    .map(({ title }) => title)
  const expectedServiceSet = new Set(expectedServices.map((service) => service.toLowerCase()))
  const credentialChecklistUnexpectedServices = ["sis", "vendor"].filter(
    (service) => !expectedServiceSet.has(service) && new RegExp(`\\b${service}\\b`, "i").test(credentialChecklistDetail),
  )
  const credentialChecklistServicesCurrent =
    expectedServices.length === 0 ||
    (credentialChecklistDetail.length > 0 &&
      credentialChecklistMissingServices.length === 0 &&
      credentialChecklistUnexpectedServices.length === 0)
  const scopeRequirements = packet?.scopeRequirements
  const scopeRequirementRules = scopeRequirements?.rules ?? []
  const missingScopeRequirementRules = expectedScopeRules.filter((rule) => !scopeRequirementRules.includes(rule))
  const unexpectedScopeRequirementRules = scopeRequirementRules.filter((rule) => !expectedScopeRules.includes(rule))
  const seenScopeRequirementRules = new Set<string>()
  const scopeRequirementGaps = scopeRequirementRules.flatMap((rule) => {
    const trimmed = rule.trim()
    const gaps: string[] = []
    if (!trimmed) gaps.push("blank")
    if (rule !== trimmed) gaps.push("noncanonical")
    if (trimmed && seenScopeRequirementRules.has(trimmed)) gaps.push("duplicate")
    if (trimmed) seenScopeRequirementRules.add(trimmed)
    return gaps
  })
  const scopeRequirementsReady =
    scopeRequirements?.required === true &&
    scopeRequirementRules.length > 0 &&
    missingScopeRequirementRules.length === 0 &&
    unexpectedScopeRequirementRules.length === 0 &&
    scopeRequirementGaps.length === 0
  const scopeRequirementsDetail = scopeRequirements
    ? `required=${scopeRequirements.required === true}; rules=${scopeRequirementRules.length || "missing"}; missing=${missingScopeRequirementRules.length ? missingScopeRequirementRules.join(" | ") : "none"}; unexpected=${unexpectedScopeRequirementRules.length ? unexpectedScopeRequirementRules.join(" | ") : "none"}; gaps=${scopeRequirementGaps.length ? scopeRequirementGaps.join(",") : "none"}`
    : "missing"
  const covered =
    packet?.operationID === operationID &&
    packet?.status === "preflight_required" &&
    packet.template === "school-laptop-48h" &&
    (packet.targetHours ?? 0) >= 48 &&
    targetHoursMatches &&
    operationRootMatches &&
    missingItems.length === 0 &&
    unexpectedItems.length === 0 &&
    duplicateItems.length === 0 &&
    missingCommandTerms.length === 0 &&
    commandGaps.length === 0 &&
    supervisorRunbookLaunchReadiness &&
    credentialRequirementsReady &&
    credentialChecklistServicesCurrent &&
    scopeRequirementsReady
  return check({
    id: "selected-operation-launch-packet",
    requirement: "The selected school laptop operation has an operator launch packet with the exact preflight, daemon, readiness, and objective-audit commands.",
    status: covered ? "covered" : "missing",
    evidence: [packetPath, supervisorRunbookPath].filter((item): item is string => Boolean(item)),
    detail: packet
      ? `status=${packet.status ?? "missing"}; packet_operation_id=${packet.operationID ?? "missing"}; selected_operation_id=${operationID ?? "missing"}; template=${packet.template ?? "missing"}; target_hours=${packet.targetHours ?? "missing"}; expected_target_hours=${expectedTargetHours}; target_hours_matches=${targetHoursMatches}; operation_root_matches=${operationRootMatches}; packet_operation_root=${packet.files?.operationRoot ?? "missing"}; expected_operation_root=${expectedOperationRoot ?? "missing"}; missing_required_items=${missingItems.length ? missingItems.join(",") : "none"}; unexpected_required_items=${unexpectedItems.length ? unexpectedItems.join(",") : "none"}; duplicate_required_items=${duplicateItems.length ? duplicateItems.join(",") : "none"}; missing_command_terms=${missingCommandTerms.length ? missingCommandTerms.join(",") : "none"}; command_gaps=${commandGaps.length ? commandGaps.join(",") : "none"}; supervisor_runbook_launch_readiness=${supervisorRunbookLaunchReadiness}; credential_requirements=${credentialRequirementsDetail}; credential_checklist_services_current=${credentialChecklistServicesCurrent}; credential_checklist_missing=${credentialChecklistMissingServices.length ? credentialChecklistMissingServices.join(",") : "none"}; credential_checklist_unexpected=${credentialChecklistUnexpectedServices.length ? credentialChecklistUnexpectedServices.join(",") : "none"}; scope_requirements=${scopeRequirementsDetail}`
      : operationID
        ? "first-run-launch-packet.json is missing for the selected operation"
        : "no operationID was supplied, so no selected operation launch packet can be inspected",
  })
}

async function selectedOperationPreflight(repoRoot: string, operationID: string | undefined): Promise<FirstRunObjectiveCheck> {
  const root = operationRoot(repoRoot, operationID)
  const preflightPath = root ? path.join(root, "scheduler", "laptop-preflight.json") : undefined
  const graphPath = root ? path.join(root, "plans", "operation-graph.json") : undefined
  const planPath = root ? path.join(root, "plans", "operation-plan.json") : undefined
  const goalPath = root ? path.join(root, "goals", "operation-goal.json") : undefined
  const supervisorPath = root ? path.join(root, "scheduler", "supervisor", "supervisor-manifest.json") : undefined
  const runbookPath = root ? path.join(root, "scheduler", "supervisor", "supervisor-install.md") : undefined
  const toolPreflightPath = root ? path.join(root, "tools", "tool-preflight.json") : undefined
  const modelRouteAuditPath = root ? path.join(root, "deliverables", "model-route-audit.json") : undefined
  const reportOutlinePath = root ? path.join(root, "reports", "report-outline.md") : undefined
  const credentialReviewPath = root ? path.join(root, "credentials", "review-submission.json") : undefined
  const preflight = preflightPath
    ? await readJson<{
        operationID?: string
        status?: string
        checkedAt?: string
        targetHours?: number
        gaps?: string[]
        checks?: Array<{ id?: string; status?: string; required?: boolean; detail?: string }>
      }>(preflightPath)
    : undefined
  const credentialReview = credentialReviewPath
    ? await readJson<{ submittedAt?: string; credentials?: unknown[] }>(credentialReviewPath)
    : undefined
  const graph = graphPath ? await readJson<{ safetyMode?: string; lanes?: unknown[] }>(graphPath) : undefined
  const planText = planPath ? await readText(planPath) : undefined
  const plan = planText
    ? (JSON.parse(planText) as { writtenAt?: string; templateName?: string; timeBudget?: { targetHours?: number } })
    : undefined
  const currentPlanSha256 = sha256(planText)
  const goal = goalPath ? await readJson<{ targetDurationHours?: number }>(goalPath) : undefined
  const supervisor = supervisorPath
    ? await readJson<{ command?: string[]; files?: Record<string, string | undefined> }>(supervisorPath)
    : undefined
  const runbook = runbookPath ? await readText(runbookPath) : undefined
  const toolPreflight = toolPreflightPath ? await readJson<{ blocked?: number }>(toolPreflightPath) : undefined
  const reportOutline = reportOutlinePath ? await readText(reportOutlinePath) : undefined
  const okPreflightChecks = new Set(
    (preflight?.checks ?? []).filter((item) => item.status === "ok").map((item) => item.id).filter(Boolean),
  )
  const missingOkChecks = requiredPreflightChecks.filter((id) => !okPreflightChecks.has(id))
  const reportOutlineTargetPages = detailNumber(
    preflight?.checks?.find((item) => item.id === "report-outline")?.detail,
    "target_pages",
  )
  const requiredReportTargetPages = 75
  const underlyingReportTargetPages = detailNumber(reportOutline, "target_pages")
  const requiresLaunchReadinessGate = plan?.templateName === "school-laptop-48h"
  const supervisorDurationSeconds = numberArg(supervisor?.command, "--duration-seconds")
  const supervisorCommandText = supervisor?.command?.join(" ")
  const supervisorCommandOperationCurrent = hasExactCommandToken(supervisorCommandText, operationID)
  const supervisorRunbookLaunchReadiness =
    !requiresLaunchReadinessGate ||
    (runbook?.includes("Launch Readiness Gate") === true &&
      hasExactCommandFlag(runbook, "--require-launch-ready") &&
      hasExactCommandArg(runbook, "--operation-id", operationID))
  const preflightCheckedAtMs = typeof preflight?.checkedAt === "string" ? Date.parse(preflight.checkedAt) : Number.NaN
  const planWrittenAtMs = typeof plan?.writtenAt === "string" ? Date.parse(plan.writtenAt) : Number.NaN
  const preflightStalePlan = Number.isFinite(preflightCheckedAtMs) && Number.isFinite(planWrittenAtMs) && preflightCheckedAtMs < planWrittenAtMs
  const preflightPlanSha256 = detailValue(
    preflight?.checks?.find((item) => item.id === "plan-fingerprint")?.detail,
    "plan_sha256",
  )
  const preflightPlanFingerprintCurrent =
    Boolean(preflightPlanSha256) && Boolean(currentPlanSha256) && preflightPlanSha256 === currentPlanSha256
  const credentialSubmittedAtValid = validCredentialSubmittedAt(credentialReview?.submittedAt)
  const credentialSubmittedAtMs = credentialSubmittedAtValid ? Date.parse(credentialReview!.submittedAt!) : Number.NaN
  const preflightStaleCredentialReview =
    Number.isFinite(preflightCheckedAtMs) && Number.isFinite(credentialSubmittedAtMs) && preflightCheckedAtMs < credentialSubmittedAtMs
  const expectedCredentialServiceList = expectedCredentialServices(plan)
  const credentialSubmissionTimestampGap = expectedCredentialServiceList.length > 0 && !credentialSubmittedAtValid
  const currentCredentialGaps = missingCredentialServices(
    plan,
    Array.isArray(credentialReview?.credentials) ? credentialReview.credentials : [],
  )
  const graphLaneIDs = new Set(
    (Array.isArray(graph?.lanes) ? graph.lanes : [])
      .map((lane) => (isRecord(lane) && typeof lane.id === "string" ? lane.id : undefined))
      .filter((laneID): laneID is string => Boolean(laneID)),
  )
  const requiredIdentityLanes =
    plan?.templateName === "school-laptop-48h" ? ["person_recon", "identity_graph", "identity_auth_review"] : []
  const missingIdentityLanes = requiredIdentityLanes.filter((laneID) => !graphLaneIDs.has(laneID))
  const underlyingPreflightGaps = [
    graph?.safetyMode === "non_destructive" && Array.isArray(graph.lanes) && graph.lanes.length > 0
      ? undefined
      : "operation-graph",
    missingIdentityLanes.length === 0 ? undefined : "operation-graph-identity-lanes",
    (goal?.targetDurationHours ?? 0) >= 48 && (plan?.timeBudget?.targetHours ?? 0) >= 48 ? undefined : "duration-plan",
    supervisorDurationSeconds !== undefined && supervisorDurationSeconds >= 48 * 60 * 60 && supervisorCommandOperationCurrent
      ? undefined
      : "supervisor-manifest",
    runbook?.includes("48-Hour Laptop Checklist") &&
    runbook.includes("Disable sleep/hibernate/modern standby") &&
    runbook.includes("school Wi-Fi") &&
    runbook.includes("credential vault and redacted indexes")
      ? undefined
      : "supervisor-runbook",
    supervisorRunbookLaunchReadiness ? undefined : "supervisor-runbook-launch-readiness",
    toolPreflight && toolPreflight.blocked === 0 ? undefined : "tool-preflight",
    modelRouteAuditPath && (await exists(modelRouteAuditPath)) ? undefined : "model-route-audit",
    (underlyingReportTargetPages ?? 0) >= requiredReportTargetPages ? undefined : "report-outline",
    currentCredentialGaps.length === 0 ? undefined : "credential-vault",
    credentialSubmissionTimestampGap ? "credential-submission-timestamp" : undefined,
    preflightStalePlan ? "preflight-stale-plan" : undefined,
    preflightPlanFingerprintCurrent ? undefined : "preflight-plan-fingerprint",
    preflightStaleCredentialReview ? "preflight-stale-credential-review" : undefined,
  ].filter((item): item is string => item !== undefined)
  const covered =
    preflight?.operationID === operationID &&
    preflight?.status === "ready" &&
    (preflight.targetHours ?? 0) >= 48 &&
    (preflight.gaps?.length ?? 0) === 0 &&
    missingOkChecks.length === 0 &&
    (reportOutlineTargetPages ?? 0) >= requiredReportTargetPages &&
    underlyingPreflightGaps.length === 0
  return check({
    id: "selected-operation-preflight",
    requirement: "The selected school laptop operation has a passing 48h laptop preflight artifact.",
    status: covered ? "covered" : "missing",
    evidence: [
      preflightPath,
      graphPath,
      planPath,
      goalPath,
      supervisorPath,
      runbookPath,
      toolPreflightPath,
      modelRouteAuditPath,
      reportOutlinePath,
      credentialReviewPath,
    ].filter((item): item is string => item !== undefined),
    detail: preflight
      ? `status=${preflight.status ?? "missing"}; preflight_operation_id=${preflight.operationID ?? "missing"}; selected_operation_id=${operationID ?? "missing"}; target_hours=${preflight.targetHours ?? "missing"}; gaps=${preflight.gaps?.length ?? "missing"}; missing_ok_checks=${missingOkChecks.length ? missingOkChecks.join(",") : "none"}; report_outline_target_pages=${reportOutlineTargetPages ?? "missing"}; required_min_report_target_pages=${requiredReportTargetPages}; underlying_report_outline_target_pages=${underlyingReportTargetPages ?? "missing"}; supervisor_command_operation_current=${supervisorCommandOperationCurrent}; supervisor_runbook_launch_readiness=${supervisorRunbookLaunchReadiness}; current_credential_gaps=${currentCredentialGaps.length ? currentCredentialGaps.join(",") : "none"}; expected_credential_services=${expectedCredentialServiceList.length ? expectedCredentialServiceList.join(",") : "none"}; credential_submitted_at=${credentialReview?.submittedAt ?? "missing"}; credential_submitted_at_valid=${credentialSubmittedAtValid}; credential_submission_timestamp_gap=${credentialSubmissionTimestampGap}; plan_written_at=${plan?.writtenAt ?? "missing"}; preflight_checked_at=${preflight.checkedAt ?? "missing"}; preflight_stale_plan=${preflightStalePlan}; preflight_plan_sha256=${preflightPlanSha256 ?? "missing"}; current_plan_sha256=${currentPlanSha256 ?? "missing"}; preflight_plan_fingerprint_current=${preflightPlanFingerprintCurrent}; preflight_stale_credential_review=${preflightStaleCredentialReview}; underlying_preflight_gaps=${underlyingPreflightGaps.length ? underlyingPreflightGaps.join(",") : "none"}`
      : operationID
        ? "laptop-preflight.json is missing for the selected operation"
        : "no operationID was supplied, so no selected operation preflight can be inspected",
  })
}

async function selectedOperationCredentialReview(repoRoot: string, operationID: string | undefined): Promise<FirstRunObjectiveCheck> {
  const root = operationRoot(repoRoot, operationID)
  const reviewPath = root ? path.join(root, "scheduler", "credential-review.json") : undefined
  const planPath = root ? path.join(root, "plans", "operation-plan.json") : undefined
  const plan = planPath ? await readJson(planPath) : undefined
  const review = reviewPath
    ? await readJson<{
        operationID?: string
        status?: string
        checkedAt?: string
        credentialsRequired?: boolean
        submitted?: boolean
        submittedAt?: string
        credentialCount?: number
        gaps?: string[]
        files?: { review?: string }
      }>(reviewPath)
    : undefined
  const underlyingReviewPath = review?.files?.review
  const underlyingReview = underlyingReviewPath
    ? await readJson<{
        operationID?: string
        file?: string
        submittedAt?: string
        credentials?: unknown[]
      }>(underlyingReviewPath)
    : undefined
  const underlyingCredentialCount = Array.isArray(underlyingReview?.credentials) ? underlyingReview.credentials.length : 0
  const underlyingMissingServices = missingCredentialServices(
    plan,
    Array.isArray(underlyingReview?.credentials) ? underlyingReview.credentials : [],
  )
  const underlyingIndexGaps = Array.isArray(underlyingReview?.credentials) ? credentialIndexGaps(underlyingReview.credentials) : []
  const underlyingSubmittedAtValid = validCredentialSubmittedAt(underlyingReview?.submittedAt)
  const underlyingSubmitted = Boolean(underlyingSubmittedAtValid && underlyingCredentialCount > 0)
  const underlyingOperationMatches = !review?.credentialsRequired || underlyingReview?.operationID === operationID
  const underlyingHasRawSecrets = containsRawCredentialSecret(underlyingReview)
  const reviewCheckedAtMs = typeof review?.checkedAt === "string" ? Date.parse(review.checkedAt) : Number.NaN
  const underlyingSubmittedAtMs = underlyingSubmittedAtValid ? Date.parse(underlyingReview!.submittedAt!) : Number.NaN
  const canonicalReviewPath = root ? path.join(root, "credentials", "review-submission.json") : undefined
  const reviewPathCanonical =
    review?.credentialsRequired !== true ||
    (Boolean(underlyingReviewPath) &&
      Boolean(canonicalReviewPath) &&
      path.resolve(underlyingReviewPath!) === path.resolve(canonicalReviewPath!))
  const underlyingFileCanonical =
    review?.credentialsRequired !== true ||
    (typeof underlyingReview?.file === "string" &&
      Boolean(canonicalReviewPath) &&
      path.resolve(underlyingReview.file) === path.resolve(canonicalReviewPath!))
  const reviewCheckedAtValid = Number.isFinite(reviewCheckedAtMs)
  const submittedAtMatches = review?.credentialsRequired !== true || review?.submittedAt === underlyingReview?.submittedAt
  const underlyingAfterReview =
    Number.isFinite(reviewCheckedAtMs) &&
    Number.isFinite(underlyingSubmittedAtMs) &&
    underlyingSubmittedAtMs > reviewCheckedAtMs
  const covered =
    review?.operationID === operationID &&
    (review?.status === "ready" || review?.status === "not_required") &&
    (review?.credentialsRequired !== true || (review?.submitted === true && (review?.credentialCount ?? 0) > 0)) &&
    (review?.gaps?.length ?? 0) === 0 &&
    (review?.credentialsRequired !== true ||
      (underlyingSubmitted &&
        underlyingOperationMatches &&
        reviewPathCanonical &&
        underlyingFileCanonical &&
        underlyingCredentialCount === (review.credentialCount ?? 0) &&
        underlyingMissingServices.length === 0 &&
        underlyingIndexGaps.length === 0 &&
        reviewCheckedAtValid &&
        submittedAtMatches &&
        !underlyingHasRawSecrets &&
        !underlyingAfterReview))
  return check({
    id: "selected-operation-credential-review",
    requirement: "The selected operation has an explicit credential-review gate proving the vault submission state without raw secrets.",
    status: covered ? "covered" : "missing",
    evidence: [reviewPath, underlyingReviewPath, planPath].filter((item): item is string => Boolean(item)),
    detail: review
      ? `status=${review.status ?? "missing"}; review_operation_id=${review.operationID ?? "missing"}; selected_operation_id=${operationID ?? "missing"}; credentials_required=${review.credentialsRequired ?? "missing"}; submitted=${review.submitted ?? "missing"}; credential_count=${review.credentialCount ?? "missing"}; gaps=${review.gaps?.length ? review.gaps.join(",") : "none"}; review_file=${review.files?.review ?? "missing"}; review_path_canonical=${reviewPathCanonical}; underlying_file_canonical=${underlyingFileCanonical}; underlying_submitted=${underlyingSubmitted}; underlying_submitted_at_valid=${underlyingSubmittedAtValid}; underlying_operation_id=${underlyingReview?.operationID ?? "missing"}; underlying_credential_count=${underlyingCredentialCount}; underlying_missing_services=${underlyingMissingServices.length ? underlyingMissingServices.join(",") : "none"}; underlying_index_gaps=${underlyingIndexGaps.length ? underlyingIndexGaps.join(",") : "none"}; review_checked_at_valid=${reviewCheckedAtValid}; submitted_at_matches=${submittedAtMatches}; underlying_raw_secrets=${underlyingHasRawSecrets}; underlying_after_review=${underlyingAfterReview}`
      : operationID
        ? "credential-review.json is missing for the selected operation"
        : "no operationID was supplied, so no selected operation credential review can be inspected",
  })
}

async function selectedOperationCanaryProof(repoRoot: string, operationID: string | undefined): Promise<FirstRunObjectiveCheck> {
  const canaryOperationID = operationID ? `${operationID}-canary` : undefined
  const root = operationRoot(repoRoot, canaryOperationID)
  const auditPath = root ? path.join(root, "scheduler", "literal-run-readiness.json") : undefined
  const finalManifestPath = root ? path.join(root, "deliverables", "final", "manifest.json") : undefined
  const finalAuditPath = root ? path.join(root, "deliverables", "operation-audit.json") : undefined
  const audit = auditPath
    ? await readJson<{
        operationID?: string
        status?: string
        targetElapsedSeconds?: number
        literalElapsedSeconds?: number
        checks?: Array<{ id?: string; status?: string; required?: boolean; detail?: string }>
      }>(auditPath)
    : undefined
  const finalManifest = finalManifestPath
    ? await readJson<{ operationID?: string; generatedAt?: string; artifacts?: Record<string, unknown> }>(finalManifestPath)
    : undefined
  const finalManifestArtifacts = isRecord(finalManifest?.artifacts) ? finalManifest.artifacts : undefined
  const missingFinalManifestArtifacts = requiredFinalManifestArtifacts.filter((key) => !finalManifestArtifacts?.[key])
  const finalDir = finalManifestPath ? path.dirname(finalManifestPath) : undefined
  const missingFinalManifestFiles =
    finalDir && finalManifestArtifacts
      ? (
          await Promise.all(
            requiredFinalManifestArtifacts.map(async (key) => ({
              key,
              exists: await manifestArtifactExists(finalDir, finalManifestArtifacts[key]),
            })),
          )
        )
          .filter((item) => !item.exists)
          .map((item) => item.key)
      : requiredFinalManifestArtifacts.slice()
  const finalPackagePdfIntegrityGaps = await finalPackagePdfGaps(finalDir, finalManifestArtifacts, {})
  const finalPackageStakeholderGaps = await collectFinalPackageStakeholderGaps(finalDir, finalManifestArtifacts)
  const underlyingFinalPackageGaps = [
    finalManifest ? undefined : "final-manifest:missing",
    finalManifest && finalManifest.operationID !== canaryOperationID
      ? `final-manifest:operation-id=${finalManifest.operationID ?? "missing"}`
      : undefined,
    finalManifest && !finalManifestArtifacts ? "final-manifest:missing-artifacts-object" : undefined,
    missingFinalManifestArtifacts.length ? `final-manifest:missing-artifacts=${missingFinalManifestArtifacts.join(",")}` : undefined,
    missingFinalManifestFiles.length ? `final-manifest:missing-files=${missingFinalManifestFiles.join(",")}` : undefined,
    finalPackagePdfIntegrityGaps.length ? `final-manifest:pdf-gaps=${finalPackagePdfIntegrityGaps.join(",")}` : undefined,
    finalPackageStakeholderGaps.length ? `final-manifest:stakeholder-gaps=${finalPackageStakeholderGaps.join(",")}` : undefined,
  ].filter((item): item is string => item !== undefined)
  const finalAudit = finalAuditPath
    ? await readJson<{ operationID?: string; ok?: boolean; blockers?: unknown[]; generatedAt?: string; checks?: { finalHandoff?: { ok?: boolean } } }>(
        finalAuditPath,
      )
    : undefined
  const finalAuditGeneratedAtValid = typeof finalAudit?.generatedAt === "string" && Number.isFinite(Date.parse(finalAudit.generatedAt))
  const finalManifestGeneratedAtMs = typeof finalManifest?.generatedAt === "string" ? Date.parse(finalManifest.generatedAt) : Number.NaN
  const finalAuditGeneratedAtMs = finalAuditGeneratedAtValid ? Date.parse(finalAudit!.generatedAt!) : Number.NaN
  const finalAuditBeforeFinalManifest =
    Number.isFinite(finalAuditGeneratedAtMs) && Number.isFinite(finalManifestGeneratedAtMs) && finalAuditGeneratedAtMs < finalManifestGeneratedAtMs
  const underlyingFinalAuditGaps = [
    finalAudit ? undefined : "final-audit:missing",
    finalAudit && finalAudit.operationID !== canaryOperationID ? `final-audit:operation-id=${finalAudit.operationID ?? "missing"}` : undefined,
    finalAudit && finalAudit.ok !== true ? "final-audit:not-ok" : undefined,
    finalAudit && (finalAudit.blockers?.length ?? 0) !== 0 ? `final-audit:blockers=${finalAudit.blockers?.length ?? "missing"}` : undefined,
    finalAudit && !finalAuditGeneratedAtValid ? "final-audit:generated-at-missing" : undefined,
    finalAudit && finalAuditBeforeFinalManifest ? "final-audit:before-final-manifest" : undefined,
    finalAudit && finalAudit.checks?.finalHandoff?.ok !== true ? "final-audit:handoff-missing" : undefined,
  ].filter((item): item is string => item !== undefined)
  const okChecks = new Set((audit?.checks ?? []).filter((item) => item.status === "ok").map((item) => item.id).filter(Boolean))
  const missingOkChecks = requiredSelectedCanaryChecks.filter((id) => !okChecks.has(id))
  const missingDetailEvidence = requiredSelectedCanaryDetailEvidence
    .filter((requirement) => {
      const item = (audit?.checks ?? []).find((check) => check.id === requirement.id && check.status === "ok")
      return !item?.detail?.includes(requirement.evidence)
    })
    .map((requirement) => requirement.label)
  const covered =
    audit?.operationID === canaryOperationID &&
    audit?.status === "passed" &&
    (audit.targetElapsedSeconds ?? 0) >= 120 &&
    (audit.literalElapsedSeconds ?? 0) >= 120 &&
    missingOkChecks.length === 0 &&
    missingDetailEvidence.length === 0 &&
    underlyingFinalPackageGaps.length === 0 &&
    underlyingFinalAuditGaps.length === 0
  return check({
    id: "selected-operation-canary-proof",
    requirement: "The selected school laptop operation has a passing 120-second wall-clock canary proof from its matching canary operation.",
    status: covered ? "covered" : "missing",
    evidence: [auditPath, finalManifestPath, finalAuditPath].filter((item): item is string => item !== undefined),
    detail: audit
      ? `status=${audit.status ?? "missing"}; canary_operation_id=${audit.operationID ?? "missing"}; expected_canary_operation_id=${canaryOperationID ?? "missing"}; target_elapsed_seconds=${audit.targetElapsedSeconds ?? "missing"}; literal_elapsed_seconds=${audit.literalElapsedSeconds ?? "missing"}; missing_ok_checks=${missingOkChecks.length ? missingOkChecks.join(",") : "none"}; missing_detail_evidence=${missingDetailEvidence.length ? missingDetailEvidence.join(",") : "none"}; underlying_final_package_gaps=${underlyingFinalPackageGaps.length ? underlyingFinalPackageGaps.join(",") : "none"}; underlying_final_audit_gaps=${underlyingFinalAuditGaps.length ? underlyingFinalAuditGaps.join(",") : "none"}`
      : operationID
        ? `literal-run-readiness.json is missing for selected canary operation ${canaryOperationID}`
        : "no operationID was supplied, so no selected operation canary can be inspected",
  })
}

async function literal48hProof(repoRoot: string, operationID: string | undefined): Promise<FirstRunObjectiveCheck> {
  const root = operationRoot(repoRoot, operationID)
  const auditPath = root ? path.join(root, "scheduler", "literal-run-readiness.json") : undefined
  const finalManifestPath = root ? path.join(root, "deliverables", "final", "manifest.json") : undefined
  const finalAuditPath = root ? path.join(root, "deliverables", "operation-audit.json") : undefined
  const planPath = root ? path.join(root, "plans", "operation-plan.json") : undefined
  const credentialReviewPath = root ? path.join(root, "credentials", "review-submission.json") : undefined
  const audit = auditPath
    ? await readJson<{
        operationID?: string
        status?: string
        targetElapsedSeconds?: number
        literalElapsedSeconds?: number
        checks?: Array<{ id?: string; status?: string; required?: boolean; detail?: string }>
      }>(auditPath)
    : undefined
  const plan = planPath ? await readJson(planPath) : undefined
  const credentialReview = credentialReviewPath
    ? await readJson<{ submittedAt?: string; credentials?: unknown[] }>(credentialReviewPath)
    : undefined
  const finalManifest = finalManifestPath
    ? await readJson<{ operationID?: string; generatedAt?: string; artifacts?: Record<string, unknown> }>(finalManifestPath)
    : undefined
  const finalManifestArtifacts = isRecord(finalManifest?.artifacts) ? finalManifest.artifacts : undefined
  const missingFinalManifestArtifacts = requiredFinalManifestArtifacts.filter((key) => !finalManifestArtifacts?.[key])
  const finalDir = finalManifestPath ? path.dirname(finalManifestPath) : undefined
  const missingFinalManifestFiles =
    finalDir && finalManifestArtifacts
      ? (
          await Promise.all(
            requiredFinalManifestArtifacts.map(async (key) => ({
              key,
              exists: await manifestArtifactExists(finalDir, finalManifestArtifacts[key]),
            })),
          )
        )
          .filter((item) => !item.exists)
          .map((item) => item.key)
      : requiredFinalManifestArtifacts.slice()
  const finalPackagePdfIntegrityGaps = await finalPackagePdfGaps(finalDir, finalManifestArtifacts, { minMainPages: 75 })
  const finalPackageStakeholderGaps = await collectFinalPackageStakeholderGaps(finalDir, finalManifestArtifacts)
  const underlyingFinalPackageGaps = [
    finalManifest ? undefined : "final-manifest:missing",
    finalManifest && finalManifest.operationID !== operationID
      ? `final-manifest:operation-id=${finalManifest.operationID ?? "missing"}`
      : undefined,
    finalManifest && !finalManifestArtifacts ? "final-manifest:missing-artifacts-object" : undefined,
    missingFinalManifestArtifacts.length ? `final-manifest:missing-artifacts=${missingFinalManifestArtifacts.join(",")}` : undefined,
    missingFinalManifestFiles.length ? `final-manifest:missing-files=${missingFinalManifestFiles.join(",")}` : undefined,
    finalPackagePdfIntegrityGaps.length ? `final-manifest:pdf-gaps=${finalPackagePdfIntegrityGaps.join(",")}` : undefined,
    finalPackageStakeholderGaps.length ? `final-manifest:stakeholder-gaps=${finalPackageStakeholderGaps.join(",")}` : undefined,
  ].filter((item): item is string => item !== undefined)
  const finalAudit = finalAuditPath
    ? await readJson<{
        operationID?: string
        ok?: boolean
        blockers?: unknown[]
        generatedAt?: string
        checks?: { finalHandoff?: { ok?: boolean; gates?: { minOutlineTargetPages?: number; minPdfPages?: number } } }
      }>(finalAuditPath)
    : undefined
  const finalAuditGeneratedAtValid = typeof finalAudit?.generatedAt === "string" && Number.isFinite(Date.parse(finalAudit.generatedAt))
  const finalManifestGeneratedAtMs = typeof finalManifest?.generatedAt === "string" ? Date.parse(finalManifest.generatedAt) : Number.NaN
  const finalAuditGeneratedAtMs = finalAuditGeneratedAtValid ? Date.parse(finalAudit!.generatedAt!) : Number.NaN
  const finalAuditBeforeFinalManifest =
    Number.isFinite(finalAuditGeneratedAtMs) && Number.isFinite(finalManifestGeneratedAtMs) && finalAuditGeneratedAtMs < finalManifestGeneratedAtMs
  const underlyingFinalAuditGaps = [
    finalAudit ? undefined : "final-audit:missing",
    finalAudit && finalAudit.operationID !== operationID ? `final-audit:operation-id=${finalAudit.operationID ?? "missing"}` : undefined,
    finalAudit && finalAudit.ok !== true ? "final-audit:not-ok" : undefined,
    finalAudit && (finalAudit.blockers?.length ?? 0) !== 0 ? `final-audit:blockers=${finalAudit.blockers?.length ?? "missing"}` : undefined,
    finalAudit && !finalAuditGeneratedAtValid ? "final-audit:generated-at-missing" : undefined,
    finalAudit && finalAuditBeforeFinalManifest ? "final-audit:before-final-manifest" : undefined,
    finalAudit && finalAudit.checks?.finalHandoff?.ok !== true ? "final-audit:handoff-missing" : undefined,
    finalAudit && (finalAudit.checks?.finalHandoff?.gates?.minOutlineTargetPages ?? 0) < 75
      ? `final-audit:min-outline=${finalAudit.checks?.finalHandoff?.gates?.minOutlineTargetPages ?? "missing"}`
      : undefined,
    finalAudit && (finalAudit.checks?.finalHandoff?.gates?.minPdfPages ?? 0) < 75
      ? `final-audit:min-pdf=${finalAudit.checks?.finalHandoff?.gates?.minPdfPages ?? "missing"}`
      : undefined,
  ].filter((item): item is string => item !== undefined)
  const okChecks = new Set((audit?.checks ?? []).filter((item) => item.status === "ok").map((item) => item.id).filter(Boolean))
  const missingOkChecks = requiredLiteral48hChecks.filter((id) => !okChecks.has(id))
  const missingDetailEvidence = requiredLiteral48hDetailEvidence
    .filter((requirement) => {
      const item = (audit?.checks ?? []).find((check) => check.id === requirement.id && check.status === "ok")
      return !item?.detail?.includes(requirement.evidence)
    })
    .map((requirement) => requirement.label)
  const credentialHandoffDetail = (audit?.checks ?? []).find(
    (check) => check.id === "credential-handoff-proof" && check.status === "ok",
  )?.detail
  const expectedCredentialServiceList = expectedCredentialServices(plan)
  const currentCredentialGaps = missingCredentialServices(
    plan,
    Array.isArray(credentialReview?.credentials) ? credentialReview.credentials : [],
  )
  const credentialSubmittedAtValid = validCredentialSubmittedAt(credentialReview?.submittedAt)
  const currentCredentialEvidenceGaps =
    expectedCredentialServiceList.length > 0
      ? [
          credentialSubmittedAtValid ? undefined : "current-credential-submission-timestamp",
          currentCredentialGaps.length ? `current-credential-services=${currentCredentialGaps.join(",")}` : undefined,
          credentialSubmittedAtValid && !credentialHandoffDetail?.includes(`submitted_at=${credentialReview?.submittedAt}`)
            ? "credential-handoff-proof:submitted-at-current"
            : undefined,
        ].filter((item): item is string => item !== undefined)
      : []
  const auditOperationMatches = !operationID || audit?.operationID === operationID
  const passed =
    auditOperationMatches &&
    audit?.status === "passed" &&
    (audit.targetElapsedSeconds ?? 0) >= 48 * 60 * 60 &&
    (audit.literalElapsedSeconds ?? 0) >= 48 * 60 * 60 &&
    missingOkChecks.length === 0 &&
    missingDetailEvidence.length === 0 &&
    currentCredentialEvidenceGaps.length === 0 &&
    underlyingFinalPackageGaps.length === 0 &&
    underlyingFinalAuditGaps.length === 0
  return check({
    id: "literal-48h-proof",
    requirement: "Actual 48-hour wall-clock daemon proof exists for the selected operation.",
    status: passed ? "covered" : "missing",
    evidence: [auditPath, finalManifestPath, finalAuditPath, planPath, credentialReviewPath].filter(
      (item): item is string => item !== undefined,
    ),
    detail: audit
      ? `status=${audit.status ?? "missing"}; audit_operation_id=${audit.operationID ?? "missing"}; selected_operation_id=${operationID ?? "missing"}; target_elapsed_seconds=${audit.targetElapsedSeconds ?? "missing"}; literal_elapsed_seconds=${audit.literalElapsedSeconds ?? "missing"}; missing_ok_checks=${missingOkChecks.length ? missingOkChecks.join(",") : "none"}; missing_detail_evidence=${missingDetailEvidence.length ? missingDetailEvidence.join(",") : "none"}; expected_credential_services=${expectedCredentialServiceList.length ? expectedCredentialServiceList.join(",") : "none"}; current_credential_gaps=${currentCredentialGaps.length ? currentCredentialGaps.join(",") : "none"}; current_credential_submitted_at=${credentialReview?.submittedAt ?? "missing"}; current_credential_submitted_at_valid=${credentialSubmittedAtValid}; missing_current_credential_evidence=${currentCredentialEvidenceGaps.length ? currentCredentialEvidenceGaps.join(",") : "none"}; underlying_final_package_gaps=${underlyingFinalPackageGaps.length ? underlyingFinalPackageGaps.join(",") : "none"}; underlying_final_audit_gaps=${underlyingFinalAuditGaps.length ? underlyingFinalAuditGaps.join(",") : "none"}`
      : operationID
        ? "literal-run-readiness.json is missing for the selected operation"
        : "no operationID was supplied, so no literal 48h proof can be inspected",
  })
}

async function liveBehaviorProbeProof(repoRoot: string, behaviorProbeDir: string | undefined): Promise<FirstRunObjectiveCheck> {
  const probeDir = behaviorProbeDir ?? path.join(repoRoot, ".artifacts", "live-probes")
  const sharedProbeSourceMtime = await maxMtime([
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "behavior-watch.ts"),
    path.join(repoRoot, "packages", "opencode", "script", "ulm-behavior-probe.ts"),
  ])
  const files = (await readDirFiles(probeDir)).filter((file) => file.endsWith(".json")).sort()
  const passed = new Map<string, string>()
  const latestReports = new Map<
    string,
    {
      path: string
      mtimeMs: number
      ok: boolean
      failureReason?: "latest_failed" | "missing_artifacts" | "weak_reports" | "stale_sources"
    }
  >()
  const missingArtifacts: string[] = []
  const weakReports: string[] = []
  const latestFailed: string[] = []
  const staleSources: string[] = []
  for (const file of files) {
    const fullPath = path.join(probeDir, file)
    const report = await readJson<{
      ok?: boolean
      timedOut?: boolean
      transcript?: string
      prompt?: string
      result?: { ok?: boolean; scenarioID?: string; findings?: unknown[] }
    }>(fullPath).catch(() => undefined)
    const scenarioID = report?.result?.scenarioID
    if (!scenarioID || !requiredBehaviorProbeScenarios.includes(scenarioID as RequiredBehaviorProbeScenario)) {
      continue
    }
    const scenarioSourceMtime = await maxMtime([
      path.join(repoRoot, "tools", "ulmcode-behavior-scenarios", `${scenarioID}.json`),
    ])
    const requiredSourceMtime = Math.max(sharedProbeSourceMtime, scenarioSourceMtime)
    const transcriptPath = resolveProbeArtifact(probeDir, report?.transcript)
    const promptPath = resolveProbeArtifact(probeDir, report?.prompt)
    const stat = await fs.stat(fullPath)
    const artifactsExist = (await exists(transcriptPath)) && (await exists(promptPath))
    const artifactContentValid =
      !!scenarioID &&
      (await nonEmptyFileIncludes(transcriptPath, scenarioID)) &&
      (await nonEmptyFileIncludes(promptPath, scenarioID))
    const findings = Array.isArray(report?.result?.findings) ? report.result.findings : []
    const noFindings = findings.length === 0
    const baseOk = report?.ok === true && report.timedOut === false && report.result?.ok === true
    const freshAgainstSources = stat.mtimeMs >= requiredSourceMtime
    const ok = baseOk && artifactsExist && artifactContentValid && noFindings && freshAgainstSources
    const failureReason: "latest_failed" | "missing_artifacts" | "weak_reports" | "stale_sources" | undefined = ok
      ? undefined
      : !baseOk
        ? "latest_failed"
        : !artifactsExist
          ? "missing_artifacts"
          : !artifactContentValid || !noFindings
            ? "weak_reports"
            : "stale_sources"
    const current = latestReports.get(scenarioID)
    if (!current || stat.mtimeMs > current.mtimeMs || (stat.mtimeMs === current.mtimeMs && fullPath > current.path)) {
      latestReports.set(scenarioID, { path: fullPath, mtimeMs: stat.mtimeMs, ok, failureReason })
    }
  }
  for (const scenarioID of requiredBehaviorProbeScenarios) {
    const latest = latestReports.get(scenarioID)
    if (!latest) continue
    if (latest.ok) {
      passed.set(scenarioID, latest.path)
      continue
    }
    if (latest.failureReason === "latest_failed") latestFailed.push(scenarioID)
    if (latest.failureReason === "missing_artifacts") missingArtifacts.push(scenarioID)
    if (latest.failureReason === "weak_reports") weakReports.push(scenarioID)
    if (latest.failureReason === "stale_sources") staleSources.push(scenarioID)
  }
  const missing = requiredBehaviorProbeScenarios.filter((scenarioID) => !passed.has(scenarioID))
  return check({
    id: "live-behavior-probes",
    requirement: "Recent live model behavior probes passed for chain reasoning, named resume, privileged dossiers, and exploit safety.",
    status: missing.length ? "missing" : "covered",
    evidence: Array.from(passed.values()).sort(),
    detail: `probe_dir=${probeDir}; passed_scenarios=${Array.from(passed.keys()).sort().join(",") || "none"}; missing_passed_scenarios=${missing.length ? missing.join(",") : "none"}; latest_failed=${latestFailed.length ? latestFailed.join(",") : "none"}; missing_artifacts=${missingArtifacts.length ? missingArtifacts.join(",") : "none"}; weak_reports=${weakReports.length ? weakReports.join(",") : "none"}; stale_sources=${staleSources.length ? staleSources.join(",") : "none"}`,
  })
}

async function extendedHarnessScorecardProof(repoRoot: string, harnessScorecardDir: string | undefined): Promise<FirstRunObjectiveCheck> {
  const scorecardDir = harnessScorecardDir ?? path.join(repoRoot, "packages", "opencode", ".artifacts", "ulm-harness")
  const requiredSourceMtime = await maxMtime([
    path.join(repoRoot, "packages", "opencode", "script", "ulm-harness-run.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "harness.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "first-run-objective-audit.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "literal-run-readiness.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "laptop-preflight.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "credential-review.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "operation-credentials.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "operation-extras.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "artifact.ts"),
    path.join(repoRoot, "packages", "opencode", "src", "ulm", "wall-clock-canary.ts"),
  ])
  const files = (await collectHarnessScorecardFiles(scorecardDir)).sort()
  const passed = new Map<RequiredExtendedHarnessTier, string>()
  const stale: RequiredExtendedHarnessTier[] = []
  const failed: RequiredExtendedHarnessTier[] = []
  const missingArtifacts: RequiredExtendedHarnessTier[] = []

  for (const required of requiredExtendedHarnessTiers) {
    const candidates: Array<{ file: string; mtimeMs: number; ok: boolean; artifacts: boolean; stale: boolean }> = []
    for (const file of files) {
      const scorecard = await readJson<{
        ok?: boolean
        scenarios?: Array<{ id?: string; tier?: string; status?: string }>
      }>(file).catch(() => undefined)
      const scenario = scorecard?.scenarios?.find((item) => item.id === required.scenarioID)
      if (!scenario) continue
      const scenarioIDs = new Set(scorecard?.scenarios?.map((item) => item.id).filter(Boolean) ?? [])
      const tierRunShape =
        required.tier === "chaos"
          ? !scenarioIDs.has("synthetic-full-operation") && !scenarioIDs.has("overnight-readiness-contract")
          : required.tier === "full"
            ? scenarioIDs.has("synthetic-full-operation") && !scenarioIDs.has("overnight-readiness-contract")
            : scenarioIDs.has("overnight-readiness-contract")
      if (!tierRunShape) continue
      const markdown = path.join(path.dirname(file), "scorecard.md")
      const stat = await fs.stat(file)
      const artifacts = await nonEmptyFileIncludes(markdown, required.scenarioID)
      const ok = scorecard?.ok === true && scenario.status === "passed"
      candidates.push({
        file,
        mtimeMs: stat.mtimeMs,
        ok,
        artifacts,
        stale: stat.mtimeMs < requiredSourceMtime,
      })
    }
    const latest = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))[0]
    if (!latest) continue
    if (!latest.ok) failed.push(required.tier)
    else if (!latest.artifacts) missingArtifacts.push(required.tier)
    else if (latest.stale) stale.push(required.tier)
    else passed.set(required.tier, latest.file)
  }

  const missing = requiredExtendedHarnessTiers.map((item) => item.tier).filter((tier) => !passed.has(tier))
  return check({
    id: "extended-harness-scorecards",
    requirement: "Fresh chaos, full, and overnight harness scorecards cover provider chaos, synthetic full-operation assembly, and overnight readiness contracts.",
    status: missing.length ? "missing" : "covered",
    evidence: Array.from(passed.values()).sort(),
    detail: `scorecard_dir=${scorecardDir}; passed_tiers=${Array.from(passed.keys()).sort().join(",") || "none"}; missing_tiers=${missing.length ? missing.join(",") : "none"}; failed_tiers=${failed.length ? failed.join(",") : "none"}; missing_artifacts=${missingArtifacts.length ? missingArtifacts.join(",") : "none"}; stale_sources=${stale.length ? stale.join(",") : "none"}`,
  })
}

function formatMarkdown(result: FirstRunObjectiveAuditResult) {
  return [
    "# ULM First-Run Objective Audit",
    "",
    `- status: ${result.status}`,
    `- checked_at: ${result.checkedAt}`,
    "",
    "## Launch Decision",
    "",
    `- status: ${result.launchDecision.status}`,
    `- can_start_daemon: ${result.launchDecision.canStartDaemon}`,
    `- can_claim_objective_complete: ${result.launchDecision.canClaimObjectiveComplete}`,
    `- next_action: ${result.launchDecision.nextActionId ?? "none"}`,
    `- blockers: ${result.launchDecision.blockerActionIds.length ? result.launchDecision.blockerActionIds.join(", ") : "none"}`,
    `- reason: ${result.launchDecision.reason}`,
    "",
    "## Objective Completion Matrix",
    "",
    "| Objective | Status | Requirement | Mapped Checks | Next Actions | Evidence | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...result.objectiveMatrix.map(
      (item) =>
        `| ${item.id} | ${item.status} | ${item.requirement.replaceAll("|", "\\|")} | ${item.mappedChecks.join("<br>").replaceAll("|", "\\|")} | ${item.nextActionIds.join("<br>") || "none"} | ${item.evidence.join("<br>").replaceAll("|", "\\|")} | ${item.detail.replaceAll("|", "\\|")} |`,
    ),
    "",
    "## Prompt-to-Artifact Checklist",
    "",
    "| Check | Status | Requirement | Evidence | Detail |",
    "| --- | --- | --- | --- | --- |",
    ...result.checks.map(
      (item) =>
        `| ${item.id} | ${item.status} | ${item.requirement.replaceAll("|", "\\|")} | ${item.evidence.join("<br>").replaceAll("|", "\\|")} | ${item.detail.replaceAll("|", "\\|")} |`,
    ),
    "",
    "## Gaps",
    "",
    ...(result.gaps.length ? result.gaps.map((gap) => `- ${gap}`) : ["- none"]),
    "",
    "## Next Actions",
    "",
    ...(result.nextActions.length
      ? result.nextActions.map((action) => `- ${action.id}: ${action.status} - ${action.reason}`)
      : ["- none"]),
    "",
  ].join("\n")
}

function formatNextActionsMarkdown(result: FirstRunObjectiveAuditResult) {
  return [
    "# First-Run Launch Next Actions",
    "",
    `- status: ${result.status}`,
    `- checkedAt: ${result.checkedAt}`,
    `- actions: ${result.nextActions.length}`,
    "",
    ...result.nextActions.flatMap((action, index) => [
      `## ${index + 1}. ${action.title}`,
      "",
      `- id: ${action.id}`,
      `- status: ${action.status}`,
      `- reason: ${action.reason}`,
      `- blocked_by: ${action.blockedBy.length ? action.blockedBy.join(", ") : "none"}`,
      "",
      "Blocked by:",
      "",
      ...(action.blockedBy.length ? action.blockedBy.map((id) => `- ${id}`) : ["- none"]),
      "",
      "Links:",
      "",
      ...(action.links.length ? action.links.map((link) => `- ${link}`) : ["- none"]),
      "",
      "Commands:",
      "",
      ...(action.commands.length ? action.commands.map((command) => `- \`${command}\``) : ["- none"]),
      "",
      "Artifacts:",
      "",
      ...(action.artifacts.length ? action.artifacts.map((artifact) => `- \`${artifact}\``) : ["- none"]),
      "",
    ]),
  ].join("\n")
}

function firstRunNextActions(repoRoot: string, operationID: string | undefined, checks: FirstRunObjectiveCheck[]) {
  const selectedOperation = operationID ?? "<operationID>"
  const selectedRoot = operationRoot(repoRoot, operationID)
  const launchPacketStatus = checkStatus(checks, "selected-operation-launch-packet")
  const selectedTemplateStatus = checkStatus(checks, "selected-operation-template")
  const credentialReviewStatus = checkStatus(checks, "selected-operation-credential-review")
  const preflightStatus = checkStatus(checks, "selected-operation-preflight")
  const canaryStatus = checkStatus(checks, "selected-operation-canary-proof")
  const literalStatus = checkStatus(checks, "literal-48h-proof")
  const harnessStatus = checkStatus(checks, "extended-harness-scorecards")
  const behaviorStatus = checkStatus(checks, "live-behavior-probes")
  const selectedTemplate = checks.find((item) => item.id === "selected-operation-template")
  const targetHours = detailNumber(selectedTemplate?.detail, "target_hours") ?? 48
  const credentialTargets = detailList(selectedTemplate?.detail, "credential_targets")
  const credentialServiceText = credentialTargets.length
    ? sentenceList(credentialTargets.map(titleCredentialService))
    : "the plan-required"
  const actions: FirstRunObjectiveNextAction[] = []
  const credentialVaultPath = `/ulm/credentials?operationID=${encodeURIComponent(selectedOperation)}`

  if (selectedTemplateStatus !== "covered") {
    actions.push({
      id: "repair-selected-operation-plan",
      title: "Repair the selected school-laptop operation plan",
      status: "required",
      reason: "The selected operation plan does not match the school-laptop-48h template contract; regenerate the launch plan and packet before trusting later gates.",
      blockedBy: [],
      links: [],
      commands: [`bun run --cwd packages/opencode ulm:first-run-launch-packet ${selectedOperation} --force --strict --json`],
      artifacts: selectedRoot
        ? [
            path.join(selectedRoot, "plans", "operation-plan.json"),
            path.join(selectedRoot, "scheduler", "first-run-launch-packet.json"),
            path.join(selectedRoot, "scheduler", "first-run-launch-packet.md"),
          ]
        : [],
    })
  }

  if (launchPacketStatus !== "covered") {
    actions.push({
      id: "create-launch-packet",
      title: "Create the selected launch packet",
      status: "required",
      reason: "The selected operation does not yet have a current launch packet with exact vault, preflight, daemon, readiness, and objective-audit commands.",
      blockedBy: selectedTemplateStatus === "covered" ? [] : ["repair-selected-operation-plan"],
      links: [],
      commands: [`bun run --cwd packages/opencode ulm:first-run-launch-packet ${selectedOperation} --strict --json`],
      artifacts: selectedRoot
        ? [
            path.join(selectedRoot, "scheduler", "first-run-launch-packet.json"),
            path.join(selectedRoot, "scheduler", "first-run-launch-packet.md"),
          ]
        : [],
    })
  }

  if (credentialReviewStatus !== "covered") {
    actions.push({
      id: "submit-credential-vault",
      title: "Submit the credential vault review",
      status: "required",
      reason: `${credentialServiceText} credential services are expected for the selected school-laptop run, and the current vault review has not been submitted.`,
      blockedBy: selectedTemplateStatus === "covered" ? [] : ["repair-selected-operation-plan"],
      links: [credentialVaultPath],
      commands: [
        `operation_credentials action=open_vault operationID=${selectedOperation}`,
        `open the local ULMCode vault route: ${credentialVaultPath}`,
        `bun run --cwd packages/opencode ulm:credential-review ${selectedOperation} --strict --json`,
      ],
      artifacts: selectedRoot
        ? [
            path.join(selectedRoot, "credentials", "review-submission.json"),
            path.join(selectedRoot, "scheduler", "credential-review.json"),
          ]
        : [],
    })
  }

  if (canaryStatus !== "covered") {
    actions.push({
      id: "run-wall-clock-canary",
      title: "Run the matching wall-clock canary",
      status: "required",
      reason: `A selected first run needs a literal short canary from the matching canary operation before the ${targetHours}-hour daemon is trusted.`,
      blockedBy: [],
      links: [],
      commands: [`bun run --cwd packages/opencode ulm:wall-clock-canary ${selectedOperation}-canary --target-seconds 120 --strict --json`],
      artifacts: [
        path.join(repoRoot, ".ulmcode", "operations", `${selectedOperation}-canary`, "scheduler", "literal-run-readiness.json"),
        path.join(repoRoot, ".ulmcode", "operations", `${selectedOperation}-canary`, "deliverables", "final", "manifest.json"),
      ],
    })
  }

  if (preflightStatus !== "covered") {
    actions.push({
      id: "run-laptop-preflight",
      title: "Run strict laptop preflight after credentials are submitted",
      status: credentialReviewStatus === "covered" ? "required" : "blocked",
      reason:
        credentialReviewStatus === "covered"
          ? "The selected laptop preflight is not ready yet."
          : "Preflight cannot become ready until the credential vault review is submitted and timestamped.",
      blockedBy: [
        ...(selectedTemplateStatus === "covered" ? [] : ["repair-selected-operation-plan"]),
        ...(credentialReviewStatus === "covered" ? [] : ["submit-credential-vault"]),
      ],
      links: [],
      commands: [
        `bun run --cwd packages/opencode ulm:laptop-preflight ${selectedOperation} --prepare --strict --confirm power --confirm sleep --confirm wifi --confirm scope --confirm clock --json`,
      ],
      artifacts: selectedRoot ? [path.join(selectedRoot, "scheduler", "laptop-preflight.json")] : [],
    })
  }

  if (harnessStatus !== "covered") {
    actions.push({
      id: "refresh-harness-scorecards",
      title: "Refresh first-run harness scorecards",
      status: "required",
      reason: "Fresh chaos, full, and overnight scorecards are required after launch-readiness source changes.",
      blockedBy: [],
      links: [],
      commands: [
        "bun run --cwd packages/opencode test:ulm-harness:chaos",
        "bun run --cwd packages/opencode test:ulm-harness:full",
        "bun run --cwd packages/opencode test:ulm-harness:overnight",
      ],
      artifacts: [path.join(repoRoot, "packages", "opencode", ".artifacts", "ulm-harness")],
    })
  }

  if (behaviorStatus !== "covered") {
    actions.push({
      id: "refresh-live-behavior-probes",
      title: "Refresh live behavior probes",
      status: "required",
      reason: "Recent passing live probes are required for chain reasoning, resume discipline, privileged dossiers, and exploit safety.",
      blockedBy: [],
      links: [],
      commands: requiredBehaviorProbeScenarios.map(
        (scenario) =>
          `bun run --cwd packages/opencode ulm:behavior-probe -- --scenario tools/ulmcode-behavior-scenarios/${scenario}.json --output .artifacts/live-probes/${scenario}-$(date -u +%Y-%m-%dT%H-%M-%SZ) --timeout-ms 90000`,
      ),
      artifacts: [path.join(repoRoot, ".artifacts", "live-probes")],
    })
  }

  if (literalStatus !== "covered") {
    actions.push({
      id: "run-literal-target-hours",
      title: `Run the real ${targetHours}-hour daemon and readiness audit`,
      status: preflightStatus === "covered" && credentialReviewStatus === "covered" ? "required" : "blocked",
      reason:
        preflightStatus === "covered" && credentialReviewStatus === "covered"
          ? `Launch gates are ready; literal wall-clock proof still has to be produced by the real ${targetHours}-hour run.`
          : `Do not start the ${targetHours}-hour daemon until credential review and laptop preflight are both covered.`,
      blockedBy: [
        ...(selectedTemplateStatus === "covered" ? [] : ["repair-selected-operation-plan"]),
        ...(credentialReviewStatus === "covered" ? [] : ["submit-credential-vault"]),
        ...(preflightStatus === "covered" ? [] : ["run-laptop-preflight"]),
      ],
      links: [],
      commands: [
        `bun run --cwd packages/opencode ulm:runtime-daemon ${selectedOperation} --duration-hours ${targetHours} --detach --json`,
        `bun run --cwd packages/opencode ulm:literal-run-readiness ${selectedOperation} --strict --json`,
        `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${selectedOperation} --strict --json`,
      ],
      artifacts: selectedRoot
        ? [
            path.join(selectedRoot, "scheduler", "literal-run-readiness.json"),
            path.join(selectedRoot, "deliverables", "final", "manifest.json"),
            path.join(selectedRoot, "deliverables", "operation-audit.json"),
          ]
        : [],
    })
  }

  if (actions.length === 0) {
    actions.push({
      id: "objective-ready",
      title: "Objective audit is ready",
      status: "ready",
      reason: "Every selected first-run requirement is covered by current artifacts.",
      blockedBy: [],
      links: [],
      commands: [`bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${selectedOperation} --strict --json`],
      artifacts: [],
    })
  }

  return actions
}

export async function auditFirstRunObjective(
  repoRoot: string,
  input: FirstRunObjectiveAuditInput = {},
): Promise<FirstRunObjectiveAuditResult> {
  const outputDir = input.outputDir ?? path.join(repoRoot, "packages", "opencode", ".artifacts", "first-run-objective-audit")
  const pkg = await readText(path.join(repoRoot, "packages", "opencode", "package.json"))
  const operationExtras = await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "operation-extras.ts"))
  const firstRunRehearsal = await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "first-run-rehearsal.ts"))
  const wallClockCanary = await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "wall-clock-canary.ts"))
  const behaviorWatch = await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "behavior-watch.ts"))
  const artifact = await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "artifact.ts"))
  const supervisor = await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "operation-supervisor.ts"))
  const scheduler = await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "runtime-scheduler.ts"))
  const profileReadme = await readText(path.join(repoRoot, "tools", "ulmcode-profile", "README.md"))
  const checks: FirstRunObjectiveCheck[] = [
    check({
      id: "school-laptop-48h-template",
      requirement: "A first-real-test template creates a 48h unattended school laptop operation with aggressive bounded scanning and a long report target.",
      status: hasAll(operationExtras, ["school-laptop-48h", "targetDurationHours", "48", "75-page final report target"]) ? "covered" : "missing",
      evidence: ["packages/opencode/src/ulm/operation-extras.ts"],
      detail: "Template source is checked for 48h target, school-laptop id, and report target.",
    }),
    check({
      id: "laptop-preflight",
      requirement: "The real run has a strict laptop pre-launch gate for power, sleep, Wi-Fi, scope, clock, supervisor, tools, model routes, report outline, and credential review.",
      status: hasAll(profileReadme, ["ulm:laptop-preflight", "--confirm power", "--confirm sleep", "--confirm wifi", "--confirm scope", "--confirm clock"]) ? "covered" : "missing",
      evidence: ["tools/ulmcode-profile/README.md", "packages/opencode/src/ulm/laptop-preflight.ts"],
      detail: "Profile handoff documents the strict preflight command and confirmations.",
    }),
    check({
      id: "first-run-rehearsal",
      requirement: "Operators can rehearse the real launch chain before the real operation.",
      status: hasAll(firstRunRehearsal, [
        "runFirstRunRehearsal",
        "school-laptop-48h",
        "writeRuntimeSupervisor",
        "auditLaptopPreflight",
        "runWallClockCanary",
        "launchReadiness",
        "--require-launch-ready",
      ]) &&
        hasAll(pkg, ["ulm:first-run-rehearsal"])
          ? "covered"
          : "missing",
      evidence: ["packages/opencode/src/ulm/first-run-rehearsal.ts", "packages/opencode/package.json"],
      detail: "Rehearsal stitches template, supervisor, preflight, canary, and pre-daemon launch readiness into one operator command.",
    }),
    check({
      id: "wall-clock-canary",
      requirement: "Short literal wall-clock daemon proof exists before trusting a two-day run.",
      status: hasAll(wallClockCanary, ["runWallClockCanary", "auditLiteralRunReadiness", "targetElapsedSeconds + intervalSeconds * 2"]) &&
        hasAll(pkg, ["ulm:wall-clock-canary"])
          ? "covered"
          : "missing",
      evidence: ["packages/opencode/src/ulm/wall-clock-canary.ts", "packages/opencode/package.json"],
      detail: "Canary runs real daemon seconds and audits heartbeat continuity.",
    }),
    check({
      id: "behavior-probe",
      requirement: "Synthetic behavior probes catch unsafe exploit chaining, private dossiers, destructive proof, broad artifact reads, and weak report behavior.",
      status: hasAll(behaviorWatch, [
        "destructive-exploit-execution",
        "sensitive-data-exfiltration",
        "irrelevant-private-dossier-content",
        "raw-operation-artifact-shell-read",
      ])
        ? "covered"
        : "missing",
      evidence: ["packages/opencode/src/ulm/behavior-watch.ts", "tools/ulmcode-behavior-scenarios/"],
      detail: "Behavior watcher includes transcript-level unsafe behavior detectors.",
    }),
    await liveBehaviorProbeProof(repoRoot, input.behaviorProbeDir),
    await extendedHarnessScorecardProof(repoRoot, input.harnessScorecardDir),
    check({
      id: "first-run-launch-packet",
      requirement: "Operators can create the real school laptop operation and launch packet without forging readiness.",
      status: hasAll(await readText(path.join(repoRoot, "packages", "opencode", "src", "ulm", "first-run-launch-packet.ts")), [
        "writeFirstRunLaunchPacket",
        "first-run-launch-packet.json",
        "additionalCredentialTargets",
        "scopeRequirements",
        "preflight_required",
        "Do not launch the 48-hour daemon until",
      ]) && hasAll(pkg, ["ulm:first-run-launch-packet"]) && hasAll(await readText(path.join(repoRoot, "packages", "opencode", "script", "ulm-first-run-launch-packet.ts")), [
        "--credential-target",
        "--scope-rule",
      ])
        ? "covered"
        : "missing",
      evidence: ["packages/opencode/src/ulm/first-run-launch-packet.ts", "packages/opencode/package.json"],
      detail: "Launch packet creates the real selected operation, supervisor files, checklist, and exact commands while keeping readiness gated.",
    }),
    check({
      id: "final-report-fanout",
      requirement: "The final package can fan out board, CEH technical, ULM team, executive, technical appendix, runtime, evidence, findings, HTML, and PDF deliverables.",
      status: hasAll(artifact, [
        "board-report.pdf",
        "ceh-technical-report.pdf",
        "ulm-team-report.pdf",
        "people-profiles.md",
        "identity-graph.json",
      ])
        ? "covered"
        : "missing",
      evidence: ["packages/opencode/src/ulm/artifact.ts"],
      detail: "Final package file list includes stakeholder-specific reports and supporting indexes.",
    }),
    check({
      id: "protected-finalization-window",
      requirement: "Around hour 45 of the 48h run, the supervisor stops expanding broad work and pushes report closeout.",
      status: hasAll(supervisor, ["finalizationWindowStatus", "finalization window is open"]) &&
        hasAll(scheduler, ["Start finalization report closeout", "protected finalization window"])
          ? "covered"
          : "missing",
      evidence: ["packages/opencode/src/ulm/operation-supervisor.ts", "packages/opencode/src/ulm/runtime-scheduler.ts"],
      detail: "Supervisor and scheduler source include protected finalization behavior.",
    }),
    await selectedOperationTemplate(repoRoot, input.operationID),
    await selectedOperationLaunchPacket(repoRoot, input.operationID),
    await selectedOperationCredentialReview(repoRoot, input.operationID),
    await selectedOperationPreflight(repoRoot, input.operationID),
    await selectedOperationCanaryProof(repoRoot, input.operationID),
    await literal48hProof(repoRoot, input.operationID),
  ]
  const gaps = checks.filter((item) => item.status !== "covered").map((item) => `${item.id}: ${item.detail}`)
  const objectiveMatrix = buildObjectiveMatrix(checks)
  const nextActions = firstRunNextActions(repoRoot, input.operationID, checks)
  const launchDecision = buildLaunchDecision(checks, nextActions)
  const operationOutputDir = input.operationID ? path.join(operationRoot(repoRoot, input.operationID)!, "scheduler") : undefined
  const result: FirstRunObjectiveAuditResult = {
    status: gaps.length ? "incomplete" : "ready",
    checkedAt: new Date().toISOString(),
    launchDecision,
    objectiveMatrix,
    checks,
    gaps,
    nextActions,
    files: {
      json: path.join(outputDir, "first-run-objective-audit.json"),
      markdown: path.join(outputDir, "first-run-objective-audit.md"),
      nextActionsJson: path.join(outputDir, "first-run-next-actions.json"),
      nextActionsMarkdown: path.join(outputDir, "first-run-next-actions.md"),
      ...(operationOutputDir
        ? {
            operationJson: path.join(operationOutputDir, "first-run-objective-audit.json"),
            operationMarkdown: path.join(operationOutputDir, "first-run-objective-audit.md"),
            operationNextActionsJson: path.join(operationOutputDir, "first-run-next-actions.json"),
            operationNextActionsMarkdown: path.join(operationOutputDir, "first-run-next-actions.md"),
          }
        : {}),
    },
  }
  const resultJson = JSON.stringify(result, null, 2) + "\n"
  const markdown = formatMarkdown(result)
  const nextActionsJson = JSON.stringify(nextActions, null, 2) + "\n"
  const nextActionsMarkdown = formatNextActionsMarkdown(result)
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(result.files.json, resultJson)
  await fs.writeFile(result.files.markdown, markdown)
  await fs.writeFile(result.files.nextActionsJson, nextActionsJson)
  await fs.writeFile(result.files.nextActionsMarkdown, nextActionsMarkdown)
  if (operationOutputDir) {
    await fs.mkdir(operationOutputDir, { recursive: true })
    await fs.writeFile(result.files.operationJson!, resultJson)
    await fs.writeFile(result.files.operationMarkdown!, markdown)
    await fs.writeFile(result.files.operationNextActionsJson!, nextActionsJson)
    await fs.writeFile(result.files.operationNextActionsMarkdown!, nextActionsMarkdown)
  }
  return result
}

export function formatFirstRunObjectiveAudit(result: FirstRunObjectiveAuditResult) {
  return [
    `# First-Run Objective Audit`,
    "",
    `- status: ${result.status}`,
    `- launch_decision: ${result.launchDecision.status}`,
    `- can_start_daemon: ${result.launchDecision.canStartDaemon}`,
    `- can_claim_objective_complete: ${result.launchDecision.canClaimObjectiveComplete}`,
    `- next_action: ${result.launchDecision.nextActionId ?? "none"}`,
    `- objective_matrix: ${result.objectiveMatrix.length}`,
    `- checks: ${result.checks.length}`,
    `- gaps: ${result.gaps.length}`,
    `- json: ${result.files.json}`,
    `- markdown: ${result.files.markdown}`,
    `- next_actions_json: ${result.files.nextActionsJson}`,
    `- next_actions_markdown: ${result.files.nextActionsMarkdown}`,
    ...(result.files.operationNextActionsMarkdown ? [`- operation_next_actions_markdown: ${result.files.operationNextActionsMarkdown}`] : []),
  ].join("\n")
}
