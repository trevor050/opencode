#!/usr/bin/env bun

import { auditFirstRunObjective, formatFirstRunObjectiveAudit } from "../src/ulm/first-run-objective-audit"
import { resolveScriptWorktree } from "./ulm-script-worktree"

function hasArg(name: string) {
  return process.argv.includes(name)
}

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const worktree = resolveScriptWorktree(readArg("--worktree"))
const operationID = readArg("--operation-id")
const outputDir = readArg("--output-dir")
const result = await auditFirstRunObjective(worktree, { operationID, outputDir })

if (hasArg("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
} else {
  process.stdout.write(formatFirstRunObjectiveAudit(result) + "\n")
}

if (hasArg("--require-launch-ready") && !result.launchDecision.canStartDaemon) process.exit(1)
if (hasArg("--strict") && result.status !== "ready") process.exit(1)
