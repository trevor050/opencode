#!/usr/bin/env bun

import { formatFirstRunRehearsal, runFirstRunRehearsal } from "../src/ulm/first-run-rehearsal"
import { resolveScriptWorktree } from "./ulm-script-worktree"

function hasArg(name: string) {
  return process.argv.includes(name)
}

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
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
const operationID = readArg("--operation-id") ?? positionalOperation ?? "first-school-laptop-rehearsal"
const worktree = resolveScriptWorktree(readArg("--worktree"))
const canaryTargetSeconds = readNumberArg("--canary-target-seconds")
const canaryIntervalSeconds = readNumberArg("--canary-interval-seconds")

const result = await runFirstRunRehearsal(worktree, {
  operationID,
  canaryTargetSeconds,
  canaryIntervalSeconds,
  modelRouteLaunchEnv: process.env,
})

if (hasArg("--json")) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n")
} else {
  process.stdout.write(formatFirstRunRehearsal(result) + "\n")
}

if (hasArg("--strict") && result.status !== "ready") process.exit(1)
