#!/usr/bin/env bun

import { formatWallClockCanary, runWallClockCanary } from "../src/ulm/wall-clock-canary"
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
const operationID = readArg("--operation-id") ?? positionalOperation ?? "wall-clock-canary"
const worktree = resolveScriptWorktree(readArg("--worktree"))
const targetElapsedSeconds = readNumberArg("--target-seconds")
const intervalSeconds = readNumberArg("--interval-seconds")

const result = await runWallClockCanary(worktree, {
  operationID,
  targetElapsedSeconds,
  intervalSeconds,
})

if (hasArg("--json")) {
  const output = hasArg("--full")
    ? result
    : {
        operationID: result.operationID,
        targetElapsedSeconds: result.targetElapsedSeconds,
        daemon: {
          elapsedSeconds: result.daemon.elapsedSeconds,
          reason: result.daemon.reason,
          startedAt: result.daemon.startedAt,
          endedAt: result.daemon.endedAt,
          heartbeatPath: result.daemon.heartbeatPath,
          logPath: result.daemon.logPath,
        },
        readiness: {
          status: result.readiness.status,
          targetElapsedSeconds: result.readiness.targetElapsedSeconds,
          literalElapsedSeconds: result.readiness.literalElapsedSeconds,
          gaps: result.readiness.gaps,
          auditPath: result.readiness.auditPath,
          markdownPath: result.readiness.markdownPath,
        },
        files: result.files,
      }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n")
} else {
  process.stdout.write(formatWallClockCanary(result) + "\n")
}

if (hasArg("--strict") && result.readiness.status !== "passed") process.exit(1)
