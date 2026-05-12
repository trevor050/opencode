import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { operationPath, slug } from "./artifact"
import { expectedCredentialServices } from "./credential-safety"
import { createOperationFromTemplate } from "./operation-extras"
import { writeRuntimeSupervisor, type RuntimeSupervisorKind, type RuntimeSupervisorResult } from "./runtime-supervisor"

export type FirstRunLaunchPacketInput = {
  operationID?: string
  targetHours?: number
  supervisor?: RuntimeSupervisorKind
  bunPath?: string
  runtimeDaemonScriptPath?: string
  additionalCredentialTargets?: string[]
  scopeRules?: string[]
  overwriteExisting?: boolean
}

export type FirstRunLaunchPacketResult = {
  operationID: string
  status: "preflight_required"
  template: "school-laptop-48h"
  targetHours: number
  supervisor: RuntimeSupervisorResult
  commands: {
    credentialVaultPath: string
    openCredentialVault: string
    credentialReview: string
    canary: string
    modelRouteAudit: string
    preflight: string
    daemon48h: string
    supervisor: string
    launchReadiness: string
    readiness: string
    objectiveAudit: string
    status: string
    resume: string
  }
  credentialRequirements: {
    required: boolean
    expectedServices: string[]
    vaultPath: string
    openVaultCommand: string
    reviewCommand: string
  }
  scopeRequirements: {
    required: boolean
    rules: string[]
  }
  requiredBeforeLaunch: Array<{
    id: string
    detail: string
  }>
  files: {
    operationRoot: string
    packetJson: string
    packetMarkdown: string
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function commands(operationID: string, targetHours: number) {
  return {
    credentialVaultPath: `/ulm/credentials?operationID=${encodeURIComponent(operationID)}`,
    openCredentialVault: `operation_credentials action=open_vault operationID=${operationID}`,
    credentialReview: `bun run --cwd packages/opencode ulm:credential-review ${operationID} --strict --json`,
    canary: `bun run --cwd packages/opencode ulm:wall-clock-canary ${operationID}-canary --target-seconds 120 --strict --json`,
    modelRouteAudit: `bun run --cwd packages/opencode ulm:model-route-audit ${operationID} --strict --json`,
    preflight: `bun run --cwd packages/opencode ulm:laptop-preflight ${operationID} --prepare --strict --confirm power --confirm sleep --confirm wifi --confirm scope --confirm clock --json`,
    daemon48h: `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours ${targetHours} --detach --json`,
    supervisor: `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours ${targetHours} --supervisor all --json`,
    launchReadiness: `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID} --require-launch-ready --json`,
    readiness: `bun run --cwd packages/opencode ulm:literal-run-readiness ${operationID} --strict --json`,
    objectiveAudit: `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID} --json`,
    status: `opencode ulm status ${operationID}`,
    resume: `opencode ulm resume ${operationID}`,
  }
}

function titleCredentialService(service: string) {
  if (service.toLowerCase() === "classlink") return "ClassLink"
  return service
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function listCredentialServices(services: string[]) {
  const titled = services.map(titleCredentialService)
  if (titled.length === 0) return "Expected"
  if (titled.length === 1) return titled[0]
  if (titled.length === 2) return `${titled[0]} and ${titled[1]}`
  return `${titled.slice(0, -1).join(", ")}, and ${titled[titled.length - 1]}`
}

function requiredBeforeLaunch(expectedServices: string[]) {
  return [
    { id: "wall-power", detail: "Laptop is plugged into wall power for the full 48-hour window." },
    { id: "sleep-disabled", detail: "Sleep, hibernate, modern standby, and lid-close sleep are disabled." },
    { id: "school-wifi", detail: "School private Wi-Fi is connected, captive portals are cleared, and scope is reachable." },
    { id: "scope-confirmed", detail: "Written authorization and target restrictions are entered into the operation plan." },
    { id: "clock-confirmed", detail: "OS clock and timezone are correct before daemon heartbeat proof begins." },
    {
      id: "credential-review",
      detail: `${listCredentialServices(expectedServices)} credentials are stored through the vault with redacted indexes only.`,
    },
    {
      id: "model-route-audit",
      detail: "OpenAI-only model route audit passes for the profile, installed configs, launch env, and selected operation graph.",
    },
    { id: "tool-model-preflight", detail: "Tool preflight and model route audit pass for the selected operation." },
    { id: "wall-clock-canary", detail: "A short literal wall-clock canary passes on this laptop before the 48-hour run." },
    { id: "laptop-preflight", detail: "Strict laptop preflight passes and writes scheduler/laptop-preflight.json." },
    { id: "launch-supervisor", detail: "Start launchd/systemd supervisor or detached daemon only after every prior item is complete." },
  ]
}

function formatMarkdown(result: FirstRunLaunchPacketResult) {
  return [
    `# First Real School Laptop Launch Packet: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- template: ${result.template}`,
    `- target_hours: ${result.targetHours}`,
    `- operation_root: ${result.files.operationRoot}`,
    "",
    "Do not launch the 48-hour daemon until every required pre-launch item below is complete and `laptop-preflight.json` is ready.",
    "",
    "## Required Before Launch",
    "",
    ...result.requiredBeforeLaunch.map((item) => `- ${item.id}: ${item.detail}`),
    "",
    "## Scope Rules",
    "",
    ...result.scopeRequirements.rules.map((rule) => `- ${rule}`),
    "",
    "## Credential Vault Gate",
    "",
    `- required: ${result.credentialRequirements.required}`,
    `- expected_services: ${result.credentialRequirements.expectedServices.join(",") || "none"}`,
    `- vault_path: ${result.credentialRequirements.vaultPath}`,
    `- open_vault: \`${result.credentialRequirements.openVaultCommand}\``,
    `- review: \`${result.credentialRequirements.reviewCommand}\``,
    "- operator_action: Add one redacted vault record for each expected service, then press Submit to agent before running strict preflight.",
    "",
    "## Commands",
    "",
    "Run `launchReadiness` immediately before `daemon48h`; it exits nonzero unless the objective audit says `canStartDaemon: true`.",
    "",
    ...Object.entries(result.commands).map(([name, command]) => `- ${name}: \`${command}\``),
    "",
    "## Supervisor Files",
    "",
    `- manifest: ${result.supervisor.files.manifest}`,
    `- runbook: ${result.supervisor.files.runbook}`,
    result.supervisor.files.launchdPlist ? `- launchd: ${result.supervisor.files.launchdPlist}` : "- launchd: not generated",
    result.supervisor.files.systemdService ? `- systemd: ${result.supervisor.files.systemdService}` : "- systemd: not generated",
    "",
    "## Completion Gate",
    "",
    "After the 48-hour daemon finishes, regenerate runtime summary, report lint/render, operation audit, and literal readiness for this exact operation. The first-run objective audit must stay incomplete until that literal 48-hour proof exists.",
    "",
  ].join("\n")
}

function defaultRuntimeDaemonScriptPath() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "script", "ulm-runtime-daemon.ts")
}

export async function writeFirstRunLaunchPacket(
  worktree: string,
  input: FirstRunLaunchPacketInput = {},
): Promise<FirstRunLaunchPacketResult> {
  const operationID = slug(input.operationID ?? "first-real-school-laptop-run", "first-real-school-laptop-run")
  const targetHours = Math.max(48, Math.floor(input.targetHours ?? 48))
  const root = operationPath(worktree, operationID)
  if (!input.overwriteExisting && (await exists(path.join(root, "plans", "operation-plan.json")))) {
    throw new Error(`first-run launch operation ${operationID} already exists; pass --force to overwrite the launch packet`)
  }
  await createOperationFromTemplate(worktree, {
    operationID,
    template: "school-laptop-48h",
    objective: "First real Surface/private-Wi-Fi school laptop assessment.",
    targetDurationHours: targetHours,
    trustLevel: "unattended",
    scanProfile: "aggressive",
    credentialTargets: input.additionalCredentialTargets,
    scopeRules: input.scopeRules,
    budgetUSD: 20,
    forceReschedule: input.overwriteExisting,
  })
  const planPath = path.join(root, "plans", "operation-plan.json")
  const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
  const launchCommands = commands(operationID, targetHours)
  const expectedServices = expectedCredentialServices(plan)
  const scopeRules = Array.isArray(plan.scopeRules) ? plan.scopeRules.filter((rule: unknown): rule is string => typeof rule === "string") : []
  const supervisor = await writeRuntimeSupervisor({
    operationID,
    worktree,
    bunPath: input.bunPath ?? process.execPath,
    scriptPath: input.runtimeDaemonScriptPath ?? defaultRuntimeDaemonScriptPath(),
    durationSeconds: targetHours * 60 * 60,
    intervalSeconds: 60,
    schedulerCyclesPerTick: 1,
    launchReadinessCommand: launchCommands.launchReadiness,
    supervisor: input.supervisor ?? "all",
  })
  const result: FirstRunLaunchPacketResult = {
    operationID,
    status: "preflight_required",
    template: "school-laptop-48h",
    targetHours,
    supervisor,
    commands: launchCommands,
    credentialRequirements: {
      required: expectedServices.length > 0,
      expectedServices,
      vaultPath: launchCommands.credentialVaultPath,
      openVaultCommand: launchCommands.openCredentialVault,
      reviewCommand: launchCommands.credentialReview,
    },
    scopeRequirements: {
      required: true,
      rules: scopeRules,
    },
    requiredBeforeLaunch: requiredBeforeLaunch(expectedServices),
    files: {
      operationRoot: root,
      packetJson: path.join(root, "scheduler", "first-run-launch-packet.json"),
      packetMarkdown: path.join(root, "scheduler", "first-run-launch-packet.md"),
    },
  }
  await writeJson(result.files.packetJson, result)
  await fs.writeFile(result.files.packetMarkdown, formatMarkdown(result))
  return result
}

export function formatFirstRunLaunchPacket(result: FirstRunLaunchPacketResult) {
  return [
    `# First Real School Laptop Launch Packet`,
    "",
    `- operation: ${result.operationID}`,
    `- status: ${result.status}`,
    `- packet: ${result.files.packetMarkdown}`,
    `- preflight: ${result.commands.preflight}`,
    `- launch_readiness: ${result.commands.launchReadiness}`,
    `- launch: ${result.commands.daemon48h}`,
  ].join("\n")
}
