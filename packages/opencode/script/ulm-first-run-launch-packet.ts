#!/usr/bin/env bun

import { formatFirstRunLaunchPacket, writeFirstRunLaunchPacket } from "../src/ulm/first-run-launch-packet"
import { resolveScriptWorktree } from "./ulm-script-worktree"

function hasArg(name: string) {
  return process.argv.includes(name)
}

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function readRepeatedArgs(name: string) {
  return process.argv
    .flatMap((arg, index) => (arg === name ? [process.argv[index + 1]] : []))
    .filter((value): value is string => value !== undefined && !value.startsWith("--"))
}

function readNumberArg(name: string) {
  const raw = readArg(name)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

const positionalOperation = process.argv.find(
  (arg, index) => index > 1 && !arg.startsWith("--") && !process.argv[index - 1]?.startsWith("--"),
)
const result = await writeFirstRunLaunchPacket(resolveScriptWorktree(readArg("--worktree")), {
  operationID: readArg("--operation-id") ?? positionalOperation ?? "first-real-school-laptop-run",
  targetHours: readNumberArg("--target-hours"),
  additionalCredentialTargets: readRepeatedArgs("--credential-target"),
  scopeRules: readRepeatedArgs("--scope-rule"),
  overwriteExisting: hasArg("--force"),
})

if (hasArg("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
} else {
  process.stdout.write(formatFirstRunLaunchPacket(result) + "\n")
}

if (hasArg("--strict") && result.status !== "preflight_required") process.exit(1)
