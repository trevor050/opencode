#!/usr/bin/env bun

import { scanOperationArtifacts } from "../src/ulm/operation-artifact-safety"
import { resolveScriptWorktree } from "./ulm-script-worktree"

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

const operationID =
  readArg("--operation-id") ??
  process.argv.find((arg, index) => index > 1 && !arg.startsWith("--") && !process.argv[index - 1]?.startsWith("--"))
if (!operationID) {
  console.error("Usage: bun run script/ulm-operation-artifact-audit.ts <operationID> [--json] [--strict]")
  process.exit(1)
}

const result = await scanOperationArtifacts(resolveScriptWorktree(readArg("--worktree")), operationID)
if (hasArg("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n")
else {
  process.stdout.write(`# ULM Credential Leak Audit: ${result.operationID}\n\n`)
  process.stdout.write(`- ok: ${result.ok}\n`)
  process.stdout.write(`- findings: ${result.findings.length}\n`)
  for (const finding of result.findings) process.stdout.write(`- ${finding.label}: ${finding.reason}\n`)
}
if (hasArg("--strict") && !result.ok) process.exit(1)
