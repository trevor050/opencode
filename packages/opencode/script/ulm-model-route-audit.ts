#!/usr/bin/env bun

import { auditULMModelRoutes } from "../src/ulm/model-route-audit"
import { resolveScriptWorktree } from "./ulm-script-worktree"

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function positionalArg() {
  return process.argv.find((arg, index) => index > 1 && !arg.startsWith("--") && !process.argv[index - 1]?.startsWith("--"))
}

const operationID = readArg("--operation-id") ?? (hasArg("--profile-only") ? undefined : positionalArg())
const worktree = resolveScriptWorktree(readArg("--worktree"))
const result = await auditULMModelRoutes({
  worktree,
  operationID,
  profileConfigPath: readArg("--profile-config"),
  installedConfigDir: readArg("--installed-config-dir"),
  includeInstalled: !hasArg("--skip-installed"),
  checkLaunchEnv: !hasArg("--skip-launch-env"),
})

if (hasArg("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n")
else {
  process.stdout.write(`# ULM Model Route Audit\n\n`)
  process.stdout.write(`- ok: ${result.ok}\n`)
  process.stdout.write(`- operation: ${result.operationID ?? "profile-only"}\n`)
  process.stdout.write(`- gaps: ${result.gaps.length}\n`)
  if (result.paths.json) process.stdout.write(`- json: ${result.paths.json}\n`)
  if (result.gaps.length) {
    process.stdout.write("\n## Gaps\n\n")
    for (const gap of result.gaps) process.stdout.write(`- ${gap}\n`)
  }
}

if (hasArg("--strict") && !result.ok) process.exit(1)
