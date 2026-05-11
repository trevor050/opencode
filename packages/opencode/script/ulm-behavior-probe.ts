#!/usr/bin/env bun

import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  auditBehaviorTranscript,
  buildBehaviorWatchScenarioPrompt,
  summarizeBehaviorWatch,
  type BehaviorWatchScenario,
} from "../src/ulm/behavior-watch"

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
  const parsed = Number(value ?? "120000")
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid --timeout-ms ${value}`)
  return Math.round(parsed)
}

async function writePrompt(file: string, prompt: string) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, prompt)
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

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

async function runProbe(input: {
  scenario: BehaviorWatchScenario
  outputPrefix: string
  timeoutMs: number
  runnerCommand?: string
  model: string
  agent: string
}) {
  const prompt = buildBehaviorWatchScenarioPrompt(input.scenario)
  const outputPrefix = resolveOutput(input.outputPrefix)
  const transcript = `${outputPrefix}.jsonl`
  const stderrPath = `${outputPrefix}.stderr.txt`
  const promptFile = `${outputPrefix}.prompt.txt`
  await fs.mkdir(path.dirname(outputPrefix), { recursive: true })
  await writePrompt(promptFile, prompt)

  const tempConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-behavior-probe-config-"))
  const probeWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-behavior-probe-workspace-"))
  const probeRuntimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-behavior-probe-runtime-"))
  const env = {
    ...process.env,
    BEHAVIOR_WATCH_PROMPT: prompt,
    OPENCODE_CONFIG_DIR: tempConfigDir,
    OPENCODE_DB: path.join(probeRuntimeDir, "opencode.db"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      default_agent: input.agent,
      agent: {
        [input.agent]: {
          mode: "primary",
          model: input.model,
          tools: {
            "*": false,
            bash: false,
            operation_status: false,
            operation_goal: false,
            operation_plan: false,
            evidence_record: false,
            attack_chain: false,
            person_profile: false,
            identity_graph: false,
            finding_record: false,
            report_outline: false,
            report_lint: false,
            report_render: false,
            operation_audit: false,
          },
        },
      },
    }),
  }
  const runCommand = input.runnerCommand
    ? input.runnerCommand
    : [
        "bun",
        "run",
        "--conditions=browser",
        path.join(packageRoot, "src/index.ts"),
        "run",
        "--dir",
        probeWorkspace,
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
  const command = ["bash", "-lc", `(${runCommand}) > ${shellQuote(transcript)} 2> ${shellQuote(stderrPath)}`]
  const proc = Bun.spawn(command, {
    cwd: probeWorkspace,
    env,
    stdout: "ignore",
    stderr: "ignore",
  })
  const timeout = Bun.sleep(input.timeoutMs).then(() => "timeout" as const)
  const exited = proc.exited.then((code) => ({ code }) as const)
  const outcome = await Promise.race([timeout, exited])
  let timedOut = false
  if (outcome === "timeout") {
    timedOut = true
    await killProcess(proc)
  }
  const stdout = (await Bun.file(transcript).exists()) ? await Bun.file(transcript).text() : ""
  const stderr = (await Bun.file(stderrPath).exists()) ? await Bun.file(stderrPath).text() : ""
  const result = auditBehaviorTranscript({
    scenario: input.scenario,
    transcript: stdout,
  })
  const summary = summarizeBehaviorWatch(result)
  const report = {
    ok: result.ok && !timedOut && (outcome === "timeout" || outcome.code === 0),
    timedOut,
    exitCode: outcome === "timeout" ? undefined : outcome.code,
    transcript,
    prompt: promptFile,
    stderr: stderr.trim() ? stderrPath : undefined,
    result,
  }
  await fs.writeFile(`${outputPrefix}.json`, JSON.stringify(report, null, 2) + "\n")
  await fs.writeFile(
    `${outputPrefix}.md`,
    [
      "# ULM Behavior Probe",
      "",
      `- ok: ${report.ok}`,
      `- timed_out: ${timedOut}`,
      `- exit_code: ${report.exitCode ?? "none"}`,
      `- transcript: ${transcript}`,
      `- prompt: ${promptFile}`,
      "",
      summary,
      "",
    ].join("\n"),
  )
  return report
}

const scenarioPath = await resolveInput(
  argValue("--scenario") ?? path.join(repoRoot, "tools/ulmcode-behavior-scenarios/k12-sso-roster-export-chain.json"),
)
const scenario = (await Bun.file(scenarioPath).json()) as BehaviorWatchScenario
const outputPrefix = argValue("--output") ?? path.join(repoRoot, ".artifacts/ulm-behavior-watch", scenario.id)
const report = await runProbe({
  scenario,
  outputPrefix,
  timeoutMs: parseTimeout(argValue("--timeout-ms")),
  runnerCommand: argValue("--runner-command"),
  model: argValue("--model") ?? "opencode-go/qwen3.6-plus",
  agent: argValue("--agent") ?? "pentest",
})

if (hasArg("--json")) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(report.ok ? `behavior_probe: ok (${scenario.id})` : `behavior_probe: failed (${scenario.id})`)
  console.log(`transcript: ${report.transcript}`)
}

process.exit(report.ok ? 0 : report.timedOut ? 2 : 1)
