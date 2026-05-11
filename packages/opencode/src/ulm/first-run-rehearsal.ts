import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { operationPath, slug } from "./artifact"
import { auditLaptopPreflight, type LaptopPreflightResult } from "./laptop-preflight"
import { createOperationFromTemplate } from "./operation-extras"
import { writeRuntimeSupervisor, type RuntimeSupervisorResult } from "./runtime-supervisor"
import { runWallClockCanary, type WallClockCanaryResult } from "./wall-clock-canary"

export type FirstRunRehearsalInput = {
  operationID?: string
  canaryTargetSeconds?: number
  canaryIntervalSeconds?: number
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  bunPath?: string
  runtimeDaemonScriptPath?: string
}

export type FirstRunRehearsalResult = {
  operationID: string
  status: "ready" | "blocked"
  template: "school-laptop-48h"
  supervisor: RuntimeSupervisorResult
  preflight: LaptopPreflightResult
  canary: WallClockCanaryResult
  commands: {
    canary: string
    preflight: string
    launchReadiness: string
    daemon48h: string
    supervisor: string
    readiness: string
  }
  files: {
    operationRoot: string
    summaryJson: string
    summaryMarkdown: string
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

function defaultRuntimeDaemonScriptPath() {
  return path.join(packageRoot(), "script", "ulm-runtime-daemon.ts")
}

function commands(operationID: string, canaryTargetSeconds: number) {
  return {
    canary: `bun run --cwd packages/opencode ulm:wall-clock-canary ${operationID}-canary --target-seconds ${canaryTargetSeconds} --strict --json`,
    preflight: `bun run --cwd packages/opencode ulm:laptop-preflight ${operationID} --prepare --strict --confirm power --confirm sleep --confirm wifi --confirm scope --confirm clock --json`,
    launchReadiness: `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID} --require-launch-ready --json`,
    daemon48h: `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 48 --detach --json`,
    supervisor: `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 48 --supervisor all --json`,
    readiness: `bun run --cwd packages/opencode ulm:literal-run-readiness ${operationID} --strict --json`,
  }
}

function formatMarkdown(result: FirstRunRehearsalResult) {
  return [
    `# First Run Rehearsal: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- template: ${result.template}`,
    `- preflight: ${result.preflight.status}`,
    `- canary: ${result.canary.readiness.status}`,
    `- supervisor: ${result.supervisor.supervisor}`,
    "",
    "## Commands",
    "",
    "Run `launchReadiness` immediately before `daemon48h`; the real daemon must stay blocked until `canStartDaemon: true`.",
    "",
    ...Object.entries(result.commands).map(([name, command]) => `- ${name}: \`${command}\``),
    "",
    "## Files",
    "",
    `- operation_root: ${result.files.operationRoot}`,
    `- preflight: ${result.preflight.files.json}`,
    `- canary: ${result.canary.files.readinessAudit}`,
    `- supervisor_manifest: ${result.supervisor.files.manifest}`,
    "",
  ].join("\n")
}

export async function runFirstRunRehearsal(
  worktree: string,
  input: FirstRunRehearsalInput = {},
): Promise<FirstRunRehearsalResult> {
  const operationID = slug(input.operationID ?? "first-school-laptop-rehearsal", "first-school-laptop-rehearsal")
  const canaryTargetSeconds = Math.max(1, Math.floor(input.canaryTargetSeconds ?? 120))
  const canaryIntervalSeconds = Math.max(1, Math.floor(input.canaryIntervalSeconds ?? 1))
  await createOperationFromTemplate(worktree, {
    operationID,
    template: "school-laptop-48h",
    objective: "First real Surface/private-Wi-Fi school laptop rehearsal.",
    targetDurationHours: 48,
    trustLevel: "unattended",
    scanProfile: "aggressive",
    budgetUSD: 20,
  })
  const operationRoot = operationPath(worktree, operationID)
  const rehearsalManifestPath = path.join(operationRoot, "scheduler", "first-run-rehearsal-tool-manifest.json")
  await writeJson(rehearsalManifestPath, {
    tools: [
      {
        id: "rehearsal-tool",
        category: "canary",
        purpose: "First-run rehearsal preflight fixture.",
        validate: "true",
        install: [],
        fallbacks: [],
      },
    ],
    commandProfiles: [],
  })
  await writeJson(path.join(operationRoot, "credentials", "review-submission.json"), {
    operationID,
    submittedAt: new Date().toISOString(),
    credentials: [
      {
        id: "rehearsal-redacted-genesis-credential",
        label: "Synthetic Genesis reviewed credential placeholder",
        service: "genesis",
        redacted: true,
      },
      {
        id: "rehearsal-redacted-google-credential",
        label: "Synthetic Google reviewed credential placeholder",
        service: "google",
        redacted: true,
      },
    ],
  })

  const supervisor = await writeRuntimeSupervisor({
    operationID,
    worktree,
    bunPath: input.bunPath ?? process.execPath,
    scriptPath: input.runtimeDaemonScriptPath ?? defaultRuntimeDaemonScriptPath(),
    durationSeconds: 48 * 60 * 60,
    intervalSeconds: 60,
    schedulerCyclesPerTick: 1,
    launchReadinessCommand: commands(operationID, canaryTargetSeconds).launchReadiness,
    supervisor: "all",
  })
  const preflight = await auditLaptopPreflight(worktree, {
    operationID,
    targetHours: 48,
    preparePrerequisites: true,
    toolManifestPath: rehearsalManifestPath,
    allowSyntheticCredentials: true,
    operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    now: input.now,
  })
  const canary = await runWallClockCanary(worktree, {
    operationID: `${operationID}-canary`,
    targetElapsedSeconds: canaryTargetSeconds,
    intervalSeconds: canaryIntervalSeconds,
    now: input.now,
    sleep: input.sleep,
  })
  const result: FirstRunRehearsalResult = {
    operationID,
    status: preflight.status === "ready" && canary.readiness.status === "passed" ? "ready" : "blocked",
    template: "school-laptop-48h",
    supervisor,
    preflight,
    canary,
    commands: commands(operationID, canaryTargetSeconds),
    files: {
      operationRoot,
      summaryJson: path.join(operationRoot, "scheduler", "first-run-rehearsal.json"),
      summaryMarkdown: path.join(operationRoot, "scheduler", "first-run-rehearsal.md"),
    },
  }
  await writeJson(result.files.summaryJson, result)
  await fs.writeFile(result.files.summaryMarkdown, formatMarkdown(result))
  return result
}

export function formatFirstRunRehearsal(result: FirstRunRehearsalResult) {
  return [
    `# First Run Rehearsal: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- preflight: ${result.preflight.status}`,
    `- canary: ${result.canary.readiness.status}`,
    `- launch_readiness: ${result.commands.launchReadiness}`,
    `- daemon48h: ${result.commands.daemon48h}`,
    `- summary: ${result.files.summaryJson}`,
    `- markdown: ${result.files.summaryMarkdown}`,
  ].join("\n")
}
