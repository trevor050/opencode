#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"
import {
  auditBehaviorTranscript,
  buildBehaviorWatchScenarioPrompt,
  summarizeBehaviorWatch,
  type BehaviorWatchScenario,
} from "../src/ulm/behavior-watch"

const args = process.argv.slice(2)
const repoRoot = path.resolve(import.meta.dir, "../../..")

function argValue(name: string) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
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

const scenarioPath = await resolveInput(
  argValue("--scenario") ?? path.join(repoRoot, "tools/ulmcode-behavior-scenarios/k12-sso-roster-export-chain.json"),
)
const transcriptPath = argValue("--transcript")
const outputPrefix = argValue("--output")
const json = args.includes("--json")
const promptOnly = args.includes("--prompt")
const scenario = (await Bun.file(scenarioPath).json()) as BehaviorWatchScenario

if (promptOnly) {
  console.log(buildBehaviorWatchScenarioPrompt(scenario))
  process.exit(0)
}

if (!transcriptPath) {
  throw new Error("missing --transcript <path>")
}

const result = auditBehaviorTranscript({
  scenario,
  transcript: await Bun.file(await resolveInput(transcriptPath)).text(),
})
const summary = summarizeBehaviorWatch(result)
const output = outputPrefix
  ? {
      json: `${resolveOutput(outputPrefix)}.json`,
      markdown: `${resolveOutput(outputPrefix)}.md`,
    }
  : undefined

if (output) {
  await fs.mkdir(path.dirname(output.json), { recursive: true })
  await Bun.write(output.json, JSON.stringify(result, null, 2) + "\n")
  await Bun.write(output.markdown, `# ULM Behavior Watch\n\n${summary}\n`)
}

if (json) {
  console.log(JSON.stringify({ ok: result.ok, result, output }, null, 2))
} else {
  console.log(summary)
}

process.exit(result.ok ? 0 : 1)
