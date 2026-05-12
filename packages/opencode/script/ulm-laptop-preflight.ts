#!/usr/bin/env bun

import { auditLaptopPreflight, formatLaptopPreflight } from "../src/ulm/laptop-preflight"
import { resolveScriptWorktree } from "./ulm-script-worktree"

function readArg(name: string) {
  const index = process.argv.lastIndexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function hasArg(name: string) {
  return process.argv.includes(name)
}

function readRepeatedArg(name: string) {
  const values: string[] = []
  for (let index = 2; index < process.argv.length; index++) {
    if (process.argv[index] === name && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
      values.push(process.argv[index + 1])
    }
  }
  return values
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
const operationID = readArg("--operation-id") ?? positionalOperation ?? "laptop-preflight"
const worktree = resolveScriptWorktree(readArg("--worktree"))
const targetHours = readNumberArg("--target-hours")
const toolManifestPath = readArg("--tool-manifest")
const operatorConfirmed = [readArg("--operator-confirmed") ?? "", ...readRepeatedArg("--confirm")]
  .flatMap((item) => item.split(","))
  .map((item) => item.trim())
  .filter(Boolean)

const result = await auditLaptopPreflight(worktree, {
  operationID,
  targetHours,
  operatorConfirmed,
  preparePrerequisites: hasArg("--prepare"),
  toolManifestPath,
})

if (hasArg("--json")) process.stdout.write(JSON.stringify(result, null, 2) + "\n")
else process.stdout.write(formatLaptopPreflight(result) + "\n")

if (hasArg("--strict") && result.status !== "ready") process.exit(1)
