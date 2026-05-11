#!/usr/bin/env bun

import { auditCredentialReview, formatCredentialReview } from "../src/ulm/credential-review"
import { resolveScriptWorktree } from "./ulm-script-worktree"

function hasArg(name: string) {
  return process.argv.includes(name)
}

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const positionalOperation = process.argv.find(
  (arg, index) => index > 1 && !arg.startsWith("--") && !process.argv[index - 1]?.startsWith("--"),
)
const operationID = readArg("--operation-id") ?? positionalOperation ?? "credential-review"
const worktree = resolveScriptWorktree(readArg("--worktree"))
const result = await auditCredentialReview(worktree, { operationID })

if (hasArg("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
} else {
  process.stdout.write(formatCredentialReview(result) + "\n")
}

if (hasArg("--strict") && result.status === "blocked") process.exit(1)
