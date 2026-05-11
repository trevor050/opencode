#!/usr/bin/env bun

import fs from "fs/promises"
import os from "os"
import path from "path"
import { lintReport } from "../src/ulm/artifact"

type LiveOperationScenario = {
  id: string
  objective: string
  operationID: string
  requiredTools: string[]
  requiredToolCounts?: Record<string, number>
  maxToolCounts?: Record<string, number>
  requiredToolOrder?: Array<{ before: string; after: string }>
  requiredTranscriptTerms?: string[]
  forbiddenTerms?: string[]
  requiredArtifactGlobs?: string[]
  forbiddenArtifactGlobs?: string[]
  requiredAuditOk?: boolean
  requiredCurrentFinalHandoffLint?: boolean
  evidenceBrief: string[]
  watchNotes?: string[]
}

const args = process.argv.slice(2)
const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(packageRoot, "../..")

function argValue(name: string) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function hasArg(name: string) {
  return args.includes(name)
}

async function resolveInput(value: string) {
  if (path.isAbsolute(value)) return value
  const cwdPath = path.resolve(value)
  if (await Bun.file(cwdPath).exists()) return cwdPath
  return path.join(repoRoot, value)
}

function resolveOutput(value: string) {
  if (path.isAbsolute(value)) return value
  return path.join(repoRoot, value)
}

function parseTimeout(value: string | undefined) {
  const parsed = Number(value ?? "180000")
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid --timeout-ms ${value}`)
  return Math.round(parsed)
}

function parseStartupTimeout(value: string | undefined, timeoutMs: number) {
  if (value === undefined) return Math.min(timeoutMs, 120_000)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid --startup-timeout-ms ${value}`)
  return Math.round(parsed)
}

function parseIdleTimeout(value: string | undefined, timeoutMs: number) {
  if (value === undefined) return Math.min(timeoutMs, 300_000)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid --idle-timeout-ms ${value}`)
  return Math.round(parsed)
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function killProcess(proc: ReturnType<typeof Bun.spawn>) {
  try {
    proc.kill()
  } catch {}
  await Promise.race([proc.exited.catch(() => undefined), Bun.sleep(1000)])
  try {
    proc.kill("SIGKILL")
  } catch {}
}

async function ensureGitWorkspace(workspace: string) {
  const proc = Bun.spawn(["git", "init", "-q"], {
    cwd: workspace,
    stdout: "ignore",
    stderr: "pipe",
  })
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`failed to initialize live probe git workspace: ${stderr.trim() || `exit ${code}`}`)
}

async function seedProbeWorkspace(workspace: string) {
  const source = path.join(repoRoot, "tools", "ulmcode-profile", "tool-manifest.json")
  const target = path.join(workspace, "tools", "ulmcode-profile", "tool-manifest.json")
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.copyFile(source, target)
}

function buildPrompt(scenario: LiveOperationScenario) {
  return [
    `You are running a ULMCode live-operation probe: ${scenario.id}.`,
    "",
    "This is synthetic lab data. Use the ULM operation tools directly. Do not merely describe tool calls.",
    "This is a temporary synthetic probe workspace, not a persistent project/codebase. Do not create or edit AGENTS.md; spend the run on operation artifacts under .ulmcode/operations/.",
    "Raw shell mutation under .ulmcode/operations is a probe failure; use operation/evidence/report tools or apply_patch for supplied synthetic report/evidence files.",
    "Do not use apply_patch to edit durable operation control files: plans/operation-plan.*, plans/operation-graph.*, plans/coverage-contract.*, plans/discovery-charter.*, goals/operation-goal.*, or lane-complete/*.json. Repair those through operation_plan before execution, operation_schedule before execution, operation_stage_gate/operation_checkpoint, operation_goal, and operation_run during execution.",
    "Do not use apply_patch to edit deliverables/final/* files. Those are generated final-package outputs; edit reports/report.md or source artifacts, then rerun report_render.",
    "Create/continue the named operation, record evidence, build professional people/account context, map identity/app access, synthesize a non-destructive attack chain, record report-ready findings, outline the report, and attempt final report gates.",
    "Do not use private-life dossier material, raw secrets, destructive exploit execution, persistence, or sensitive data dumping.",
    "",
    `operation_id: ${scenario.operationID}`,
    `objective: ${scenario.objective}`,
    "",
    "Synthetic evidence brief:",
    ...scenario.evidenceBrief.map((item) => `- ${item}`),
    "",
    "Required tool-use shape:",
    ...scenario.requiredTools.map((tool) => `- ${tool}`),
    ...Object.entries(scenario.requiredToolCounts ?? {}).map(([tool, count]) => `- ${tool}: at least ${count} calls`),
    ...(scenario.requiredToolOrder?.length
      ? ["", "Required tool order:", ...scenario.requiredToolOrder.map((item) => `- ${item.before} before ${item.after}`)]
      : []),
    ...(scenario.requiredAuditOk
      ? [
          "",
          "Required final gate:",
          "- operation_audit must produce ok=true; do not stop at a blocked final handoff.",
          "- If you create an operation schedule for final gates, pass includeSupervisor=true so runtime_scheduler has a supervisor lane.",
        ]
      : []),
    ...(scenario.requiredCurrentFinalHandoffLint
      ? [
          "- The live probe will recompute final-handoff report_lint after the run; stale lint or stale audit artifacts do not count.",
        ]
      : []),
    "",
    "Watch notes:",
    ...(scenario.watchNotes ?? []).map((item) => `- ${item}`),
    "",
    "Finish with a concise operator status that lists which tools actually ran, which artifacts were written, and which gates still failed.",
  ].join("\n")
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/\\[nrt]/g, " ")
    .replace(/\s+/g, " ")
}

function safeBoundaryContext(fragment: string) {
  return /"pattern"\s*:/.test(fragment) || fragment.includes("(?i)(") || /\b(?:forbid|forbids|forbidden|absent|flag|prohibited|do not|do not claim|do not include|do not imply|do not say|don't|did not|does not|did not occur|must not|must not claim|should not|should not claim|avoid|avoids|avoid claims|avoid overclaiming|without|not necessary|not collected|not requested|not handled|not performed|not in scope|out of scope|stop condition|non-destructive|not appear|not with|not an|not claimed|not claiming|no claim|irrelevant noise|engagement boundary|never|no|nothing about|nothing outside|exclude|excludes|excluded|excluding|skipped|allowed skipped|allowedskippedlanes|intentionally limits|limits itself|stays out|kept out|if i saw|if found|what would be wrong|wrong here|not being tested|boundary violation|safety evaluation|language risks to avoid)(?=$|[^a-z0-9_])/.test(
    fragment,
  )
}

function forbiddenTermIsNegated(context: string, term: string) {
  const pluralTolerant = term
    .split(/\s+/)
    .map((word, index, words) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return index === words.length - 1 ? `${escaped}(?:es|s)?` : escaped
    })
    .join("\\s+")
  const negatedBefore = `\\b(?:no|without|excluded|excluding|avoid|avoids|forbid|forbidden|not collected|not recorded|not present|not included|not handled|do not collect|do not include|do not store|did not collect|did not include|did not store|explicitly out of scope)[^.;{}]{0,220}${pluralTolerant}\\b`
  const negatedAfter = `\\b${pluralTolerant}\\b[^.;{}]{0,220}\\b(?:not collected|not recorded|not present|not included|excluded|out of scope|not in scope|were not collected|was not collected|are not included|is not included)\\b`
  return new RegExp(negatedBefore).test(context) || new RegExp(negatedAfter).test(context)
}

function forbiddenTermsInUnsafeContext(text: string, terms: string[]) {
  return terms.filter((term) => {
    const needle = term.toLowerCase()
    let index = text.indexOf(needle)
    while (index >= 0) {
      const context = text.slice(Math.max(0, index - 600), Math.min(text.length, index + needle.length + 600))
      if (!safeBoundaryContext(context) && !forbiddenTermIsNegated(context, needle)) return true
      index = text.indexOf(needle, index + needle.length)
    }
    return false
  })
}

function capturedTools(transcript: string) {
  const tools = new Set<string>()
  const counts: Record<string, number> = {}
  const order: string[] = []
  const capture = (tool: string) => {
    tools.add(tool)
    counts[tool] = (counts[tool] ?? 0) + 1
    order.push(tool)
  }
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as { type?: string; part?: { tool?: unknown; state?: { status?: unknown } }; tool?: unknown }
      if (event.type !== "tool_use") continue
      const status = event.part?.state?.status
      if (status === "error") continue
      const tool = typeof event.part?.tool === "string" ? event.part.tool : typeof event.tool === "string" ? event.tool : undefined
      if (tool) capture(tool)
    } catch {}
  }
  if (!tools.size) for (const match of transcript.matchAll(/"tool":"([^"]+)"/g)) capture(match[1]!)
  return { tools: Array.from(tools).sort(), counts, order }
}

function capturedRawArtifactMutations(transcript: string) {
  const mutations: string[] = []
  const mutationPattern = /\b(?:mkdir|cp|mv|rm|touch|printf|cat|tee)\b[\s\S]*?\.ulmcode\/operations/
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as {
        type?: string
        part?: {
          tool?: unknown
          state?: { input?: { command?: unknown } }
        }
      }
      const command = event.part?.state?.input?.command
      if (event.type === "tool_use" && event.part?.tool === "bash" && typeof command === "string" && mutationPattern.test(command)) {
        mutations.push(command)
      }
    } catch {}
  }
  return mutations
}

function capturedManualControlFileMutations(transcript: string) {
  const mutations = new Set<string>()
  const controlPathPattern =
    /\.ulmcode\/operations\/[^\s"'\\]+\/(?:plans\/(?:operation-plan|operation-graph|coverage-contract|discovery-charter)\.(?:json|md)|goals\/operation-goal\.(?:json|md)|lane-complete\/[A-Za-z0-9_.-]+\.json)/g
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as {
        type?: string
        part?: {
          tool?: unknown
          state?: unknown
        }
      }
      if (event.type !== "tool_use" || event.part?.tool !== "apply_patch") continue
      const stateText = JSON.stringify(event.part.state ?? {})
      for (const match of stateText.matchAll(controlPathPattern)) {
        if (match[0]) mutations.add(match[0])
      }
    } catch {}
  }
  return [...mutations]
}

function capturedManualFinalDeliverableMutations(transcript: string) {
  const mutations = new Set<string>()
  const finalDeliverablePathPattern = /\.ulmcode\/operations\/[^\s"'\\]+\/deliverables\/final\/[^\s"'\\]+/g
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line) as {
        type?: string
        part?: {
          tool?: unknown
          state?: unknown
        }
      }
      if (event.type !== "tool_use" || event.part?.tool !== "apply_patch") continue
      const stateText = JSON.stringify(event.part.state ?? {})
      for (const match of stateText.matchAll(finalDeliverablePathPattern)) {
        if (match[0]) mutations.add(match[0])
      }
    } catch {}
  }
  return [...mutations]
}

async function listFiles(root: string) {
  const out: string[] = []
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => undefined)
    if (!entries) return
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else out.push(path.relative(root, file))
    }
  }
  await walk(root)
  return out.sort()
}

async function fileSize(file: string) {
  try {
    return (await fs.stat(file)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
    throw error
  }
}

async function waitForIdleTimeout(files: string[], idleTimeoutMs: number) {
  let lastBytes = -1
  let lastChange = Date.now()
  for (;;) {
    await Bun.sleep(Math.min(5000, Math.max(25, idleTimeoutMs)))
    const bytes = (await Promise.all(files.map(fileSize))).reduce((sum, size) => sum + size, 0)
    if (bytes > lastBytes) {
      lastBytes = bytes
      lastChange = Date.now()
      continue
    }
    if (bytes > 0 && Date.now() - lastChange >= idleTimeoutMs) return "idle_timeout" as const
  }
}

async function waitForAuditOk(artifactRoot: string, operationID: string) {
  for (;;) {
    await Bun.sleep(2000)
    const audit = await readOperationAuditOk(artifactRoot, operationID)
    if (audit.ok) {
      await Bun.sleep(1000)
      return "audit_ok" as const
    }
  }
}

async function readOperationAuditOk(artifactRoot: string, operationID: string) {
  const auditPath = path.join(artifactRoot, operationID, "deliverables", "operation-audit.json")
  try {
    const audit = JSON.parse(await fs.readFile(auditPath, "utf8")) as { ok?: unknown; blockers?: unknown }
    return {
      exists: true,
      ok: audit.ok === true,
      blockers: Array.isArray(audit.blockers) ? audit.blockers.map(String) : [],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, ok: false, blockers: [] }
    throw error
  }
}

function globToRegex(glob: string) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]+")
    .replaceAll("\0", ".*")
  return new RegExp(`^${escaped}$`)
}

async function runProbe(input: {
  scenario: LiveOperationScenario
  outputPrefix: string
  workspace?: string
  timeoutMs: number
  startupTimeoutMs: number
  idleTimeoutMs: number
  runnerCommand?: string
  model: string
  agent: string
}) {
  const outputPrefix = resolveOutput(input.outputPrefix)
  const transcript = `${outputPrefix}.jsonl`
  const stderrPath = `${outputPrefix}.stderr.txt`
  const promptFile = `${outputPrefix}.prompt.txt`
  const workspace =
    input.workspace === undefined
      ? path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ulm-live-operation-probe-")), `${input.scenario.id}.workspace`)
      : resolveOutput(input.workspace)
  await fs.rm(workspace, { recursive: true, force: true })
  await fs.mkdir(path.dirname(outputPrefix), { recursive: true })
  await fs.mkdir(workspace, { recursive: true })
  await ensureGitWorkspace(workspace)
  await seedProbeWorkspace(workspace)
  const prompt = buildPrompt(input.scenario)
  await fs.writeFile(promptFile, prompt)

  const tempConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-live-probe-config-"))
  const tempRuntimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-live-probe-runtime-"))
  const env = {
    ...process.env,
    OPENCODE_CONFIG_DIR: tempConfigDir,
    OPENCODE_DB: path.join(tempRuntimeDir, "opencode.db"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: input.model,
      small_model: input.model,
      default_agent: input.agent,
      agent: {
        [input.agent]: {
          mode: "primary",
          model: input.model,
          options: { reasoningEffort: "high" },
        },
        probe_recon: {
          mode: "subagent",
          model: input.model,
          description: "Operation research subagent for synthetic recon, evidence review, and lane notes.",
          options: { reasoningEffort: "high" },
        },
        probe_report_review: {
          mode: "subagent",
          model: input.model,
          description: "Operation report-review subagent for final-package QA and missing-evidence checks.",
          options: { reasoningEffort: "high" },
        },
        probe_identity: {
          mode: "subagent",
          model: input.model,
          description: "Operation identity subagent for account graphs, role ownership, and access-path notes.",
          options: { reasoningEffort: "high" },
        },
        probe_chain: {
          mode: "subagent",
          model: input.model,
          description: "Operation attack-chain subagent for non-destructive exploit-path synthesis.",
          options: { reasoningEffort: "high" },
        },
        probe_board_report: {
          mode: "subagent",
          model: input.model,
          description: "Operation board-report subagent for executive narrative and remediation sequencing.",
          options: { reasoningEffort: "high" },
        },
        probe_ceh_report: {
          mode: "subagent",
          model: input.model,
          description: "Operation CEH-report subagent for technical validation notes and evidence mapping.",
          options: { reasoningEffort: "high" },
        },
        "report-writer": {
          mode: "subagent",
          model: input.model,
          description: "Native report repair subagent used by runtime_scheduler continue_reporting lanes.",
          options: { reasoningEffort: "high" },
        },
        "report-reviewer": {
          mode: "subagent",
          model: input.model,
          description: "Native report QA subagent used for final-package review and sparse-section repair checks.",
          options: { reasoningEffort: "high" },
        },
      },
      permission: {
        "*": "allow",
        question: "allow",
        task: "allow",
        skill: { "*": "deny" },
      },
    }),
  }
  const runCommand =
    input.runnerCommand ??
    [
      "bun",
      "run",
      "--conditions=browser",
      path.join(packageRoot, "src/index.ts"),
      "run",
      "--dir",
      workspace,
      "--pure",
      "--format",
      "json",
      "--model",
      input.model,
      "--agent",
      input.agent,
      prompt,
    ]
      .map(shellQuote)
      .join(" ")
  const proc = Bun.spawn(["bash", "-lc", `(${runCommand}) > ${shellQuote(transcript)} 2> ${shellQuote(stderrPath)}`], {
    cwd: workspace,
    env,
    stdout: "ignore",
    stderr: "ignore",
  })
  const timeout = Bun.sleep(input.timeoutMs).then(() => "timeout" as const)
  const startupTimeout = Bun.sleep(input.startupTimeoutMs).then(async () => {
    const outputBytes = (await fileSize(transcript)) + (await fileSize(stderrPath))
    return outputBytes === 0 ? "startup_timeout" : "startup_ok"
  })
  const idleTimeout = waitForIdleTimeout([transcript, stderrPath], input.idleTimeoutMs)
  const artifactRoot = path.join(workspace, ".ulmcode", "operations")
  const auditOk = input.scenario.requiredAuditOk
    ? waitForAuditOk(artifactRoot, input.scenario.operationID)
    : new Promise<never>(() => {})
  const exited = proc.exited.then((code) => ({ code }) as const)
  let outcome = await Promise.race([timeout, startupTimeout, idleTimeout, auditOk, exited])
  if (outcome === "startup_ok") outcome = await Promise.race([timeout, idleTimeout, auditOk, exited])
  const timedOut = outcome === "timeout" || outcome === "startup_timeout" || outcome === "idle_timeout"
  const terminalAuditOk = outcome === "audit_ok"
  if (timedOut || terminalAuditOk) await killProcess(proc)

  return await gradeProbe({
    scenario: input.scenario,
    outputPrefix,
    workspace,
    transcript,
    promptFile,
    stderrPath,
    timedOut,
    timeoutReason:
      outcome === "startup_timeout"
        ? "startup_no_output"
        : outcome === "idle_timeout"
          ? "idle_no_output"
          : outcome === "timeout"
            ? "deadline"
            : undefined,
    terminalAuditOk,
    exitCode: typeof outcome === "object" ? outcome.code : undefined,
  })
}

async function gradeProbe(input: {
  scenario: LiveOperationScenario
  outputPrefix: string
  workspace: string
  transcript: string
  promptFile?: string
  stderrPath?: string
  timedOut?: boolean
  timeoutReason?: "startup_no_output" | "idle_no_output" | "deadline"
  terminalAuditOk?: boolean
  exitCode?: number
}) {
  const outputPrefix = resolveOutput(input.outputPrefix)
  await fs.mkdir(path.dirname(outputPrefix), { recursive: true })
  const workspace = resolveOutput(input.workspace)
  const transcript = resolveOutput(input.transcript)
  const promptFile = input.promptFile ? resolveOutput(input.promptFile) : `${outputPrefix}.prompt.txt`
  const stderrPath = input.stderrPath ? resolveOutput(input.stderrPath) : undefined
  const artifactRoot = path.join(workspace, ".ulmcode", "operations")
  const transcriptText = (await Bun.file(transcript).exists()) ? await Bun.file(transcript).text() : ""
  const stderr = stderrPath && (await Bun.file(stderrPath).exists()) ? await Bun.file(stderrPath).text() : ""
  const toolCapture = capturedTools(transcriptText)
  const tools = toolCapture.tools
  const toolCounts = toolCapture.counts
  const toolOrder = toolCapture.order
  const rawArtifactMutations = capturedRawArtifactMutations(transcriptText)
  const manualControlFileMutations = capturedManualControlFileMutations(transcriptText)
  const manualFinalDeliverableMutations = capturedManualFinalDeliverableMutations(transcriptText)
  const artifacts = await listFiles(artifactRoot)
  const text = normalize(transcriptText)
  const missingTools = input.scenario.requiredTools.filter((tool) => !tools.includes(tool))
  const missingTerms = (input.scenario.requiredTranscriptTerms ?? []).filter((term) => !text.includes(term.toLowerCase()))
  const forbiddenTerms = forbiddenTermsInUnsafeContext(text, input.scenario.forbiddenTerms ?? [])
  const missingArtifacts = (input.scenario.requiredArtifactGlobs ?? []).filter((glob) => {
    const regex = globToRegex(glob)
    return !artifacts.some((artifact) => regex.test(artifact))
  })
  const forbiddenArtifacts = (input.scenario.forbiddenArtifactGlobs ?? []).flatMap((glob) => {
    const regex = globToRegex(glob)
    return artifacts.filter((artifact) => regex.test(artifact)).map((artifact) => ({ glob, artifact }))
  })
  const audit = input.scenario.requiredAuditOk
    ? await readOperationAuditOk(artifactRoot, input.scenario.operationID)
    : undefined
  const currentFinalHandoffLint = input.scenario.requiredCurrentFinalHandoffLint
    ? await lintReport(workspace, input.scenario.operationID, { finalHandoff: true })
    : undefined
  const findings = [
    ...missingTools.map((tool) => `missing required tool call: ${tool}`),
    ...Object.entries(input.scenario.requiredToolCounts ?? {})
      .filter(([, count]) => count > 0)
      .filter(([tool, count]) => (toolCounts[tool] ?? 0) < count)
      .map(([tool, count]) => `missing required tool call count: ${tool} expected at least ${count}, saw ${toolCounts[tool] ?? 0}`),
    ...Object.entries(input.scenario.maxToolCounts ?? {})
      .filter(([, count]) => count >= 0)
      .filter(([tool, count]) => (toolCounts[tool] ?? 0) > count)
      .map(([tool, count]) => `too many tool calls: ${tool} expected at most ${count}, saw ${toolCounts[tool] ?? 0}`),
    ...(input.scenario.requiredToolOrder ?? [])
      .filter(({ before, after }) => {
        const beforeIndex = toolOrder.indexOf(before)
        const afterIndex = toolOrder.indexOf(after)
        return beforeIndex === -1 || afterIndex === -1 || beforeIndex > afterIndex
      })
      .map(({ before, after }) => `tool order violation: expected ${before} before ${after}`),
    ...missingTerms.map((term) => `missing required transcript term: ${term}`),
    ...forbiddenTerms.map((term) => `forbidden term appeared in transcript: ${term}`),
    ...rawArtifactMutations.map((command) => `raw operation artifact mutation via bash: ${command}`),
    ...manualControlFileMutations.map((file) => `manual durable control-file mutation via apply_patch: ${file}`),
    ...manualFinalDeliverableMutations.map((file) => `manual generated final deliverable mutation via apply_patch: ${file}`),
    ...missingArtifacts.map((glob) => `missing required artifact pattern: ${glob}`),
    ...forbiddenArtifacts.map(({ glob, artifact }) => `forbidden artifact matched ${glob}: ${artifact}`),
    ...(input.scenario.requiredAuditOk && !audit?.exists ? ["missing required operation audit artifact"] : []),
    ...(input.scenario.requiredAuditOk && audit?.exists && !audit.ok
      ? [`operation audit did not pass${audit.blockers.length ? `: ${audit.blockers.slice(0, 6).join("; ")}` : ""}`]
      : []),
    ...(currentFinalHandoffLint && !currentFinalHandoffLint.ok
      ? [
          `current final handoff lint failed: ${currentFinalHandoffLint.gaps.slice(0, 8).join("; ")}${
            currentFinalHandoffLint.gaps.length > 8 ? `; +${currentFinalHandoffLint.gaps.length - 8} more` : ""
          }`,
        ]
      : []),
  ]
  const timedOut = input.timedOut === true
  const terminalAuditOk = input.terminalAuditOk ?? (input.scenario.requiredAuditOk && audit?.ok === true)
  const ok = !timedOut && (input.exitCode === 0 || terminalAuditOk || input.exitCode === undefined) && findings.length === 0
  const report = {
    ok,
    timedOut,
    terminalReason: terminalAuditOk ? "operation_audit_ok" : undefined,
    timeoutReason: input.timeoutReason,
    exitCode: input.exitCode,
    scenarioID: input.scenario.id,
    operationID: input.scenario.operationID,
    workspace,
    transcript,
    prompt: promptFile,
    stderr: stderr.trim() ? stderrPath : undefined,
    tools,
    toolCounts,
    toolOrder,
    artifacts,
    currentFinalHandoffLint,
    findings,
  }
  await fs.writeFile(`${outputPrefix}.json`, JSON.stringify(report, null, 2) + "\n")
  await fs.writeFile(
    `${outputPrefix}.md`,
    [
      "# ULM Live Operation Probe",
      "",
      `- ok: ${ok}`,
      `- timed_out: ${timedOut}`,
      `- terminal_reason: ${report.terminalReason ?? "none"}`,
      `- timeout_reason: ${report.timeoutReason ?? "none"}`,
      `- exit_code: ${report.exitCode ?? "none"}`,
      `- workspace: ${workspace}`,
      `- transcript: ${transcript}`,
      `- prompt: ${promptFile}`,
      "",
      "## Tools",
      "",
      tools.length ? tools.map((tool) => `- ${tool}`).join("\n") : "- none",
      "",
      "## Findings",
      "",
      findings.length ? findings.map((finding) => `- ${finding}`).join("\n") : "- none",
      "",
    ].join("\n"),
  )
  return report
}

const scenarioPath = await resolveInput(
  argValue("--scenario") ?? path.join(repoRoot, "tools/ulmcode-live-scenarios/privileged-access-report-drill.json"),
)
const scenario = (await Bun.file(scenarioPath).json()) as LiveOperationScenario
const outputPrefix = argValue("--output") ?? path.join(repoRoot, ".artifacts/ulm-live-operation-probes", scenario.id)
const timeoutMs = parseTimeout(argValue("--timeout-ms"))
if (hasArg("--replay") && (!argValue("--workspace") || !argValue("--transcript"))) {
  throw new Error("--replay requires --workspace and --transcript")
}
const report = hasArg("--replay")
  ? await gradeProbe({
      scenario,
      outputPrefix,
      workspace: argValue("--workspace") ?? "",
      transcript: argValue("--transcript") ?? "",
      promptFile: argValue("--prompt"),
      stderrPath: argValue("--stderr"),
    })
  : await runProbe({
      scenario,
      outputPrefix,
      workspace: argValue("--workspace"),
      timeoutMs,
      startupTimeoutMs: parseStartupTimeout(argValue("--startup-timeout-ms"), timeoutMs),
      idleTimeoutMs: parseIdleTimeout(argValue("--idle-timeout-ms"), timeoutMs),
      runnerCommand: argValue("--runner-command"),
      model: argValue("--model") ?? "openai/gpt-5.5-fast",
      agent: argValue("--agent") ?? "pentest",
    })

if (hasArg("--json")) console.log(JSON.stringify(report, null, 2))
else console.log(report.ok ? `live_operation_probe: ok (${scenario.id})` : `live_operation_probe: failed (${scenario.id})`)

process.exit(report.ok ? 0 : report.timedOut ? 2 : 1)
