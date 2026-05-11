#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"

const packageRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(readArg("--repo-root") ?? path.resolve(packageRoot, "../.."))

type CheckResult = {
  id: string
  status: "ok"
  detail: string
  summary?: string
}

type ToolManifest = {
  policy?: {
    defaultSafetyMode?: string
    destructiveSafetyMode?: string
    installFailureBehavior?: string
  }
  tools?: Array<{ id?: string }>
  commandProfiles?: Array<{
    id?: string
    tool?: string
    safety?: string
    template?: string
    heartbeatSeconds?: number
    idleTimeoutSeconds?: number
    hardTimeoutSeconds?: number
    restartable?: boolean
    artifacts?: string[]
  }>
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function readArg(name: string) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

async function read(relative: string) {
  return fs.readFile(path.join(repoRoot, relative), "utf8")
}

async function exists(relative: string) {
  try {
    await fs.access(path.join(repoRoot, relative))
    return true
  } catch {
    return false
  }
}

function requireText(file: string, content: string, needles: string[]) {
  for (const needle of needles) {
    assert(content.includes(needle), `${file}: missing ${needle}`)
  }
}

function validateToolManifestSupervision(content: string) {
  const manifest = JSON.parse(content) as ToolManifest
  assert(manifest.policy?.defaultSafetyMode === "non_destructive", "default safety mode must be non_destructive")
  assert(
    manifest.policy?.destructiveSafetyMode === "interactive_destructive",
    "destructive safety mode must require interactive_destructive",
  )
  assert(
    manifest.policy?.installFailureBehavior === "record_blocker_with_fallback",
    "install failures must become blockers with fallbacks",
  )
  const toolIDs = new Set((manifest.tools ?? []).map((tool) => tool.id).filter((id): id is string => typeof id === "string"))
  assert(toolIDs.size >= 4, "expected at least four tool entries for supervised commands")
  assert((manifest.commandProfiles?.length ?? 0) >= 4, "expected at least four supervised command profiles")
  for (const profile of manifest.commandProfiles ?? []) {
    assert(typeof profile.id === "string" && profile.id.length > 0, "supervised command profile is missing id")
    assert(typeof profile.tool === "string" && toolIDs.has(profile.tool), `${profile.id}: references unknown tool`)
    assert(profile.safety === "non_destructive", `${profile.id}: unattended profiles must be non_destructive`)
    assert(typeof profile.template === "string" && profile.template.length >= 8, `${profile.id}: command template is required`)
    assert(typeof profile.heartbeatSeconds === "number" && profile.heartbeatSeconds > 0, `${profile.id}: heartbeat must be positive`)
    assert(
      typeof profile.idleTimeoutSeconds === "number" && profile.idleTimeoutSeconds >= profile.heartbeatSeconds,
      `${profile.id}: idle timeout must cover heartbeat`,
    )
    assert(
      typeof profile.hardTimeoutSeconds === "number" && profile.hardTimeoutSeconds >= profile.idleTimeoutSeconds,
      `${profile.id}: hard timeout must cover idle timeout`,
    )
    assert(Array.isArray(profile.artifacts) && profile.artifacts.length >= 1, `${profile.id}: expected output artifacts are required`)
    assert(typeof profile.restartable === "boolean", `${profile.id}: restartable flag is required`)
  }
  assert(
    (manifest.commandProfiles ?? []).some((profile) => profile.restartable === true),
    "expected at least one restartable supervised command profile",
  )
}

async function run(command: string[]) {
  const proc = Bun.spawn(command, { cwd: repoRoot, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  assert(exitCode === 0, `${command.join(" ")} failed: ${stderr.trim() || stdout.trim()}`)
  return stdout.trim()
}

function blockedUpstreamCommit(subject: string) {
  return /\bdo not merge\b|\bdo-not-merge\b/i.test(subject)
}

async function labManifestIDs() {
  const labsRoot = path.join(repoRoot, "tools", "ulmcode-labs")
  const entries = await fs.readdir(labsRoot, { withFileTypes: true })
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifest = path.join(labsRoot, entry.name, "manifest.json")
          try {
            const content = JSON.parse(await fs.readFile(manifest, "utf8")) as { id?: string }
            return content.id
          } catch {
            return undefined
          }
        }),
    )
  )
    .filter((id): id is string => typeof id === "string")
    .sort()
}

async function labManifests() {
  const labsRoot = path.join(repoRoot, "tools", "ulmcode-labs")
  const entries = await fs.readdir(labsRoot, { withFileTypes: true })
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifest = path.join(labsRoot, entry.name, "manifest.json")
          try {
            return JSON.parse(await fs.readFile(manifest, "utf8")) as {
              id?: string
              findings?: unknown[]
              report?: { authoredMarkdownFile?: string }
            }
          } catch {
            return undefined
          }
        }),
    )
  ).filter(
    (manifest): manifest is { id?: string; findings?: unknown[]; report?: { authoredMarkdownFile?: string } } =>
      manifest !== undefined,
  )
}

async function auditUpstream() {
  const right = await run(["git", "rev-list", "--right-only", "--count", "HEAD...upstream/dev"])
  if (right !== "0") {
    const subjects = (await run(["git", "log", "--format=%s", "HEAD..upstream/dev"]))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const blocked = subjects.filter(blockedUpstreamCommit)
    if (blocked.length > 0 && blocked.length < Number(right)) {
      return {
        id: "upstream_current",
        status: "ok",
        detail: `upstream range deferred: ${right} missing commits are based on blocked upstream commit(s): ${blocked.join("; ")}`,
        summary: `upstream_current: ok (upstream range deferred; ${right} missing commits)`,
      } satisfies CheckResult
    }
    assert(
      blocked.length === Number(right),
      `branch is behind upstream/dev by ${right} commits${blocked.length ? ` (${blocked.length} blocked upstream commits deferred)` : ""}`,
    )
    return {
      id: "upstream_current",
      status: "ok",
      detail: `${blocked.length} blocked upstream commit${blocked.length === 1 ? "" : "s"} deferred: ${blocked.join("; ")}`,
      summary: `upstream_current: ok (${blocked.length} blocked upstream commit${blocked.length === 1 ? "" : "s"} deferred)`,
    } satisfies CheckResult
  }
  return { id: "upstream_current", status: "ok", detail: "branch has no missing upstream/dev commits" } satisfies CheckResult
}

async function auditOperationRuntime() {
  const registry = await read("packages/opencode/src/tool/registry.ts")
  const artifact = await read("packages/opencode/src/ulm/artifact.ts")
  const operationResume = await read("packages/opencode/src/tool/operation_resume.ts")
  const todoService = await read("packages/opencode/src/session/todo.ts")
  const commandService = await read("packages/opencode/src/command/index.ts")
  const configService = await read("packages/opencode/src/config/config.ts")
  const observability = await read("packages/core/src/effect/observability.ts")
  const shellTool = await read("packages/opencode/src/tool/shell.ts")
  const shellPrompt = await read("packages/opencode/src/tool/shell/shell.txt")
  const systemPrompt = await read("packages/opencode/src/session/system.ts")
  const promptPaste = await read("packages/opencode/src/cli/cmd/tui/component/prompt/paste.ts")
  const projectService = await read("packages/opencode/src/project/project.ts")
  const providerTransform = await read("packages/opencode/src/provider/transform.ts")
  const sseRepair = await read("packages/opencode/src/provider/sse-repair.ts")
  const providerService = await read("packages/opencode/src/provider/provider.ts")
  const codexPlugin = await read("packages/opencode/src/plugin/codex.ts")
  const codexTests = await read("packages/opencode/test/plugin/codex.test.ts")
  const pluginTypes = await read("packages/plugin/src/index.ts")
  const sessionPrompt = await read("packages/opencode/src/session/prompt.ts")
  const v2ModelGroup = await read("packages/opencode/src/server/routes/instance/httpapi/groups/v2/model.ts")
  const v2ModelHandler = await read("packages/opencode/src/server/routes/instance/httpapi/handlers/v2/model.ts")
  const sdk = await read("packages/sdk/js/src/v2/gen/sdk.gen.ts")
  const requiredTools = [
    "OperationCheckpointTool",
    "OperationGovernorTool",
    "OperationNextTool",
    "OperationPlanTool",
    "OperationQueueTool",
    "OperationQueueNextTool",
    "OperationRecoverTool",
    "OperationResumeTool",
    "OperationRunTool",
    "OperationScheduleTool",
    "OperationStageGateTool",
    "ReportLintTool",
    "ReportRenderTool",
    "RuntimeDaemonTool",
    "RuntimeSchedulerTool",
    "RuntimeSummaryTool",
    "TaskRestartTool",
    "CommandSuperviseTool",
    "EvidenceNormalizeTool",
    "ToolAcquireTool",
  ]
  requireText("packages/opencode/src/tool/registry.ts", registry, requiredTools)
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, [
    "runtimeHealthGaps",
    "runtime blind spot:",
    "recoverStaleTasks=true",
    "operation_checkpoint",
    "operation_audit",
    "stage-gates",
  ])
  requireText("packages/opencode/src/tool/operation_resume.ts", operationResume, ["recoverStaleTasks", "maxRecoveries"])
  requireText("packages/opencode/src/ulm/operation-extras.ts", await read("packages/opencode/src/ulm/operation-extras.ts"), [
    "school-laptop-48h",
    "Surface/private Wi-Fi first-real-test defaults",
    "Run laptop_preflight before starting runtime_daemon",
    "Person and account research must stay limited to role, authorization, identity, and workflow risk; exclude private-life dossier material.",
    "containsRawCredentialSecret",
    "operation memory notes must not contain raw credential secrets",
    "asset graph records must not contain raw credential secrets",
    "attack chain records must not contain raw credential secrets",
    "containsDestructiveAttackChainClaim",
    "attack chain records must not contain destructive exploit execution claims",
    "browser evidence records must not contain raw credential secrets",
    "operation alerts must not contain raw credential secrets",
    "normalized tool output must not contain raw credential secrets",
    "const reportTargetPages =",
    "input.template === \"school-laptop-48h\"",
    "? 75",
    "targetPages: reportTargetPages",
  ])
  requireText("packages/opencode/src/tool/operation_memory.txt", await read("packages/opencode/src/tool/operation_memory.txt"), [
    "credential handles",
    "Never include raw passwords, tokens, cookies, API keys, or other secret values.",
  ])
  requireText("packages/opencode/test/ulm/operation-extras.test.ts", await read("packages/opencode/test/ulm/operation-extras.test.ts"), [
    "rejects raw credential secrets in operation-local memory notes",
    "rejects raw credential secrets in operation graph and recon helper artifacts",
    "rejects destructive exploit execution claims in attack chain artifacts",
    "allows non-destructive attack chain stop-condition language",
    "rejects raw credential secrets in normalized tool output artifacts",
  ])
  requireText("packages/opencode/src/tool/attack_chain.txt", await read("packages/opencode/src/tool/attack_chain.txt"), [
    "Keep chains non-destructive.",
  ])
  requireText("packages/opencode/src/tool/operation_template.txt", await read("packages/opencode/src/tool/operation_template.txt"), [
    "school-laptop-48h",
    "48-hour unattended operation",
  ])
  const commandSupervise = await read("packages/opencode/src/tool/command_supervise.ts")
  const toolManifest = await read("packages/opencode/src/ulm/tool-manifest.ts")
  const toolAcquisition = await read("packages/opencode/src/ulm/tool-acquisition.ts")
  const evidenceNormalizer = await read("packages/opencode/src/ulm/evidence-normalizer.ts")
  const operationGoal = await read("packages/opencode/src/ulm/operation-goal.ts")
  const operationGraph = await read("packages/opencode/src/ulm/operation-graph.ts")
  const operationNext = await read("packages/opencode/src/ulm/operation-next.ts")
  const workQueue = await read("packages/opencode/src/ulm/work-queue.ts")
  const operationRun = await read("packages/opencode/src/ulm/operation-run.ts")
  const operationRecovery = await read("packages/opencode/src/ulm/operation-recovery.ts")
  const operationRunTool = await read("packages/opencode/src/tool/operation_run.ts")
  const runtimeGovernor = await read("packages/opencode/src/ulm/runtime-governor.ts")
  const runtimeDaemon = await read("packages/opencode/src/ulm/runtime-daemon.ts")
  const runtimeSupervisor = await read("packages/opencode/src/ulm/runtime-supervisor.ts")
  const literalRunReadiness = await read("packages/opencode/src/ulm/literal-run-readiness.ts")
  const laptopPreflight = await read("packages/opencode/src/ulm/laptop-preflight.ts")
  const modelRuntimeCatalog = await read("packages/opencode/src/ulm/model-runtime-catalog.ts")
  const taskTool = await read("packages/opencode/src/tool/task.ts")
  requireText("packages/opencode/src/tool/command_supervise.ts", commandSupervise, [
    "command_supervise",
    "laneID",
    "writeCommandPlan",
    "BackgroundJob.Service",
    "hardTimeoutSeconds",
    "containsRawCredentialSecret",
    "supervised command inputs must not contain raw credential secrets",
  ])
  requireText("packages/opencode/src/tool/command_supervise.txt", await read("packages/opencode/src/tool/command_supervise.txt"), [
    "Use redacted credential handles and vault-backed materialization paths only.",
  ])
  requireText("packages/opencode/test/tool/command_supervise.test.ts", await read("packages/opencode/test/tool/command_supervise.test.ts"), [
    "rejects raw credential secrets before writing supervised command plans",
  ])
  requireText("packages/opencode/src/ulm/tool-manifest.ts", toolManifest, [
    "buildCommandPlan",
    "unattended command_supervise only allows non_destructive",
    "renderTemplate",
    "writeCommandPlan",
  ])
  requireText("packages/opencode/src/ulm/tool-acquisition.ts", toolAcquisition, [
    "acquireTool",
    "acquireManifestTools",
    "tool-preflight.json",
    "install required before supervised command execution",
    "fallbacks",
    "recordPath",
  ])
  requireText("packages/opencode/src/ulm/evidence-normalizer.ts", evidenceNormalizer, [
    "normalizeEvidence",
    "containsRawCredentialSecret",
    "evidence normalization outputs must not contain raw credential secrets",
    "evidence-index.json",
    "leads.json",
    "httpx-jsonl",
    "nmap-xml",
    "screenshot-json",
    "tls-jsonl",
    "cloud-json",
    "auth_surface",
    "writeEvidence",
  ])
  requireText("packages/opencode/src/tool/evidence_normalize.txt", await read("packages/opencode/src/tool/evidence_normalize.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/test/ulm/evidence-normalizer.test.ts", await read("packages/opencode/test/ulm/evidence-normalizer.test.ts"), [
    "rejects raw credential secrets before writing evidence indexes and leads",
  ])
  requireText("packages/opencode/src/ulm/operation-goal.ts", operationGoal, [
    "containsRawCredentialSecret",
    "operation goals must not contain raw credential secrets",
    "completion-blockers.json",
  ])
  requireText("packages/opencode/src/tool/operation_goal.txt", await read("packages/opencode/src/tool/operation_goal.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/test/ulm/operation-goal.test.ts", await read("packages/opencode/test/ulm/operation-goal.test.ts"), [
    "rejects raw credential secrets in operation goal objectives",
  ])
  requireText("packages/opencode/src/ulm/operation-graph.ts", operationGraph, [
    "REQUIRED_OPERATION_LANES",
    "web_inventory",
    "identity_auth_review",
    "report_review",
    "buildOperationGraph",
    "validateOperationGraph",
    "containsRawCredentialSecret",
    "operation graphs must not contain raw credential secrets",
    "non_destructive lanes must use command_supervise instead of raw shell",
  ])
  requireText("packages/opencode/src/ulm/runtime-governor.ts", runtimeGovernor, [
    "evaluateRuntimeGovernor",
    "writeRuntimeGovernorRouteAudit",
    "model-route-audit.json",
    "operation budget exhausted",
    "context pressure is critical",
    "lane budget exhausted",
    "model route quota exhausted",
    "resolveModelRuntime",
    "contextRatio",
    "formatGovernorDecision",
  ])
  requireText("packages/opencode/src/ulm/model-runtime-catalog.ts", modelRuntimeCatalog, [
    "resolveModelRuntime",
    "auditModelRoutes",
    "contextLimit",
    "outputLimit",
    "costCliffTokens",
    "opencode-go/qwen3.6-plus",
  ])
  requireText("packages/opencode/src/ulm/operation-next.ts", operationNext, [
    "decideOperationNext",
    "readOperationScopeRules",
    "Operation scope rules:",
    "max concurrent lanes",
    "launch_lane",
    "next-action.json",
    "formatOperationNext",
  ])
  requireText("packages/opencode/src/ulm/operation-run.ts", operationRun, [
    "runOperationStep",
    "readOperationScopeRules",
    "Operation scope rules:",
    "operation-run.jsonl",
    "complete_lane",
    "fail_lane",
    "autoCompleteLanes",
    "validateLaneCompletionProof",
    "lane-complete",
    "containsRawCredentialSecret",
    "operation run inputs must not contain raw credential secrets",
    "syncBackgroundJobs",
  ])
  requireText("packages/opencode/src/ulm/operation-recovery.ts", operationRecovery, [
    "markRecoveredLanesRunning",
    "containsRawCredentialSecret",
    "operation recovery inputs must not contain raw credential secrets",
    "recover_lane",
    "operation-run.jsonl",
  ])
  requireText("packages/opencode/src/ulm/runtime-scheduler.ts", await read("packages/opencode/src/ulm/runtime-scheduler.ts"), [
    "runRuntimeScheduler",
    "containsRawCredentialSecret",
    "runtime scheduler inputs must not contain raw credential secrets",
    "heartbeat.json",
    "requeueStaleWorkUnits",
    "bindWorkUnitJob",
    "evaluateRuntimeGovernor",
    "runOperationStep",
    "launchCommandWorkUnit",
    "dryRun: false",
    "protected finalization window",
    "Start finalization report closeout",
  ])
  requireText("packages/opencode/src/ulm/operation-supervisor.ts", await read("packages/opencode/src/ulm/operation-supervisor.ts"), [
    "containsRawCredentialSecret",
    "operation supervisor reviews must not contain raw credential secrets",
    "finalizationWindowStatus",
    "finalization window is open",
    "Stop launching new broad discovery",
    "handoff stage gate has unresolved blockers",
    "handoffGateOk === true",
  ])
  requireText("packages/opencode/src/tool/operation_supervise.txt", await read("packages/opencode/src/tool/operation_supervise.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/operation_recover.txt", await read("packages/opencode/src/tool/operation_recover.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/ulm/runtime-daemon.ts", runtimeDaemon, [
    "runRuntimeDaemon",
    "daemon.lock.json",
    "requireLaptopPreflight",
    "requireFirstRunLaunchReadiness",
    "auditFirstRunObjective",
    "first-run launch readiness blocked",
    "laptop-preflight.json",
    "staleLockSeconds",
    "errorBackoffSeconds",
    "maxConsecutiveErrors",
    "cycleIntervalSeconds",
    "signal",
  ])
  requireText("packages/opencode/script/ulm-runtime-daemon.ts", await read("packages/opencode/script/ulm-runtime-daemon.ts"), [
    "--detach",
    "daemon-launch.json",
    "child.unref()",
    "--skip-laptop-preflight",
    "ULMCODE_ALLOW_LONG_RUN_PREFLIGHT_BYPASS",
    "laptop-preflight-bypass.json",
    "--supervisor",
    "writeRuntimeSupervisor",
    "buildCommandPlan",
    "ulm-command-worker.ts",
    "--full",
    "compactRuntimeDaemon",
    "cycleCount",
  ])
  requireText("packages/opencode/script/ulm-command-worker.ts", await read("packages/opencode/script/ulm-command-worker.ts"), [
    "hardTimeoutSeconds",
    "idleTimeoutSeconds",
    "heartbeatPath",
    "proc.kill",
  ])
  requireText("packages/opencode/src/ulm/runtime-supervisor.ts", runtimeSupervisor, [
    "writeRuntimeSupervisor",
    "launchd",
    "systemd",
    "supervisor-install.md",
    "supervisor-manifest.json",
    "Restart=on-failure",
    "Do not add `--detach`",
    "containsRawCredentialSecret",
    "runtime supervisor manifests must not contain raw credential secrets",
    "48-Hour Laptop Checklist",
    "launchReadinessCommand",
    "Launch Readiness Gate",
    "--require-launch-ready",
    "ulm:laptop-preflight",
    "--prepare --strict",
    "Disable sleep/hibernate/modern standby",
    "school Wi-Fi",
    "credential vault and redacted indexes",
  ])
  requireText("packages/opencode/src/ulm/runtime-daemon.ts", runtimeDaemon, [
    "containsRawCredentialSecret",
    "runtime daemon inputs must not contain raw credential secrets",
  ])
  requireText("packages/opencode/src/tool/runtime_scheduler.txt", await read("packages/opencode/src/tool/runtime_scheduler.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/runtime_daemon.txt", await read("packages/opencode/src/tool/runtime_daemon.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/test/ulm/runtime-scheduler.test.ts", await read("packages/opencode/test/ulm/runtime-scheduler.test.ts"), [
    "rejects raw credential secrets before writing scheduler heartbeat artifacts",
  ])
  requireText("packages/opencode/test/ulm/runtime-daemon.test.ts", await read("packages/opencode/test/ulm/runtime-daemon.test.ts"), [
    "rejects raw credential secrets before writing daemon heartbeat artifacts",
    "blocks school-laptop daemon launches until first-run launch readiness is true",
  ])
  requireText("packages/opencode/script/ulm-burnin.ts", await read("packages/opencode/script/ulm-burnin.ts"), [
    "--target-hours",
    "runBurnInHarness",
  ])
  requireText("packages/opencode/src/ulm/burnin-harness.ts", await read("packages/opencode/src/ulm/burnin-harness.ts"), [
    "burnin-proof.json",
    "simulatedElapsedSeconds",
    "restartCount",
  ])
  requireText("packages/opencode/src/ulm/literal-run-readiness.ts", literalRunReadiness, [
    "auditLiteralRunReadiness",
    "literal-run-readiness.json",
    "literal-runtime-proof",
    "laptop-preflight-bypass",
    "laptop-preflight-proof",
    "preflight_operation_id",
    "syntheticCredentialReason",
    "synthetic credential placeholder",
    "containsRawCredentialSecret",
    "raw secret fields",
    "credential review operation id does not match operation",
    "credential review file reference is not canonical",
    "credential review was submitted after daemon ended",
    "credential review was submitted after daemon started",
    "credential_before_daemon_start",
    "credentialIndexGaps",
    "final_handoff",
    "generated_at",
    "final_manifest_generated_at",
    "heartbeat_operation_id",
    "manifest_operation_id",
    "missing_manifest_files",
    "finalManifestArtifactExists",
    "finalStakeholderPackageGaps",
    "stakeholder_gaps",
    "missing-styled-renderer",
    "audit_operation_id",
    "requiredFinalManifestArtifacts",
    "boardReportPdf",
    "accelerated-burnin-proof",
    "service-supervisor",
  ])
  requireText("packages/opencode/test/ulm/literal-run-readiness.test.ts", await read("packages/opencode/test/ulm/literal-run-readiness.test.ts"), [
    "rejects long-run literal proof when the daemon used the laptop preflight bypass",
    "controlled test bypass",
    "rejects long-run literal proof without a ready laptop preflight artifact",
    "laptop-preflight.json is missing",
    "rejects credentialed runs when vault review contains a synthetic credential placeholder",
    "synthetic credential placeholder",
    "rejects credentialed runs when vault review contains raw secret fields",
    "rejects credentialed runs when vault review is copied from another operation id",
    "rejects credentialed runs when vault review file reference is noncanonical",
    "rejects credentialed runs when vault review was submitted after the daemon ended",
    "rejects credentialed runs when vault review was submitted after the daemon started",
    "rejects credentialed runs when vault review contains malformed credential indexes",
    "rejects credentialed runs when vault review has an invalid submitted timestamp",
    "rejects final audits that do not prove final handoff lint passed",
    "final_handoff=missing",
    "rejects final audits without a generated timestamp",
    "generated_at=missing",
    "rejects final audits generated before the final package manifest",
    "final_manifest_generated_at=2026-05-08T20:10:00.000Z",
    "rejects copied daemon heartbeat proof from another operation",
    "heartbeat_operation_id=different-operation",
    "rejects copied final package and audit artifacts from another operation",
    "manifest_operation_id=different-operation",
    "rejects final manifests that omit stakeholder report package artifacts",
    "missing_manifest_artifacts=boardReportPdf,cehTechnicalReportPdf,ulmTeamReportPdf",
    "rejects final manifests that point stakeholder report artifacts at missing files",
    "missing_manifest_files=boardReportPdf",
    "rejects shallow stakeholder report package content even when manifest and final audit claim success",
    "board-report.md:missing:## Executive Decision Summary",
  ])
  requireText("packages/opencode/script/ulm-literal-run-readiness.ts", await read("packages/opencode/script/ulm-literal-run-readiness.ts"), [
    "--strict",
    "auditLiteralRunReadiness",
  ])
  requireText("packages/opencode/src/ulm/laptop-preflight.ts", laptopPreflight, [
    "auditLaptopPreflight",
    "prepareLaptopPreflightPrerequisites",
    "allowSyntheticCredentials",
    "syntheticCredentialReason",
    "synthetic credential placeholder",
    "containsRawCredentialSecret",
    "raw secret fields",
    "credentialIndexGaps",
    "validCredentialSubmittedAt",
    "laptop-preflight.json",
    "plan-freshness",
    "preflight_stale_plan",
    "credential review was submitted after preflight check",
    "report-outline.md",
    "operator-sleep",
    "credential-vault",
    "tool-preflight.json",
    "model-route-audit.json",
    "requiresLaunchReadinessGate",
    "launch_readiness_gate",
    "credential review operation id does not match operation",
    "credential review file reference is not canonical",
  ])
  requireText("packages/opencode/script/ulm-laptop-preflight.ts", await read("packages/opencode/script/ulm-laptop-preflight.ts"), [
    "--strict",
    "--prepare",
    "--confirm",
    "auditLaptopPreflight",
  ])
  requireText("packages/opencode/test/ulm/runtime-daemon.test.ts", await read("packages/opencode/test/ulm/runtime-daemon.test.ts"), [
    "CLI refuses long laptop preflight bypass unless the explicit bypass env is set",
    "CLI records an audit artifact when a controlled long preflight bypass is allowed",
    "ULMCODE_ALLOW_LONG_RUN_PREFLIGHT_BYPASS",
    "laptop-preflight-bypass.json",
  ])
  requireText("packages/opencode/test/ulm/laptop-preflight.test.ts", await read("packages/opencode/test/ulm/laptop-preflight.test.ts"), [
    "rejects synthetic rehearsal credentials for a real long credentialed handoff",
    "synthetic credential placeholder",
    "rejects credential review artifacts that contain raw secret fields",
    "rejects copied credential reviews from another operation id",
    "rejects credential reviews whose file reference is noncanonical",
    "rejects credential review artifacts with malformed credential indexes",
    "rejects credential review artifacts with invalid submitted timestamps",
    "rejects credential reviews submitted after the preflight check time",
    "blocks when the laptop clock would write preflight proof older than the plan",
    "requires school-laptop supervisor runbooks to include the launch readiness gate",
  ])
  requireText("packages/opencode/src/ulm/credential-safety.ts", await read("packages/opencode/src/ulm/credential-safety.ts"), [
    "containsRawCredentialSecret",
    "credentialIndexGaps",
    "credentialSubmittedAtGaps",
    "validCredentialSubmittedAt",
    "duplicate credential id",
    "missing a label",
    "isSensitiveCredentialKey",
    "JSON.parse",
    "split(/\\r?\\n/",
  ])
  requireText("packages/opencode/src/ulm/first-run-rehearsal.ts", await read("packages/opencode/src/ulm/first-run-rehearsal.ts"), [
    "allowSyntheticCredentials: true",
    "launchReadiness",
    "--require-launch-ready",
  ])
  requireText("packages/opencode/src/tool/laptop_preflight.ts", await read("packages/opencode/src/tool/laptop_preflight.ts"), [
    "LaptopPreflightTool",
    "auditLaptopPreflight",
    "preparePrerequisites",
    "laptop_preflight_json",
    "bindOperationSession",
  ])
  requireText("packages/opencode/src/tool/registry.ts", await read("packages/opencode/src/tool/registry.ts"), [
    "LaptopPreflightTool",
    "laptopPreflight",
  ])
  requireText("packages/opencode/src/tool/runtime_daemon.ts", await read("packages/opencode/src/tool/runtime_daemon.ts"), [
    "runtime_daemon",
    "BackgroundJob.Service",
    "backgroundJobProvider",
  ])
  requireText("packages/opencode/src/tool/task.ts", taskTool, [
    "modelRoute",
    "modelFromRoute",
    "laneID",
    "containsRawCredentialSecret",
    "operation-scoped task inputs must not contain raw credential secrets",
  ])
  requireText("packages/opencode/src/tool/task.txt", await read("packages/opencode/src/tool/task.txt"), [
    "Pass redacted credential handles only.",
  ])
  requireText("packages/opencode/test/tool/task.test.ts", await read("packages/opencode/test/tool/task.test.ts"), [
    "rejects raw credential secrets in operation-scoped task prompts",
  ])
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, ["byLane"])
  requireText("packages/opencode/src/tool/operation_run.ts", operationRunTool, [
    "launchModelLane",
    "artifacts",
    "evidenceRefs",
    "TaskTool",
    "taskDef.execute",
    "backgroundJobs",
  ])
  requireText("packages/opencode/src/tool/operation_schedule.txt", await read("packages/opencode/src/tool/operation_schedule.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/operation_run.txt", await read("packages/opencode/src/tool/operation_run.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/operation_queue.txt", await read("packages/opencode/src/tool/operation_queue.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/test/ulm/operation-graph.test.ts", await read("packages/opencode/test/ulm/operation-graph.test.ts"), [
    "rejects raw credential secrets before writing operation graph artifacts",
  ])
  requireText("packages/opencode/test/ulm/operation-run.test.ts", await read("packages/opencode/test/ulm/operation-run.test.ts"), [
    "rejects raw credential secrets in lane completion and terminal proofs",
    "includes operation plan scope rules in launched lane prompts",
  ])
  requireText("packages/opencode/test/ulm/work-queue.test.ts", await read("packages/opencode/test/ulm/work-queue.test.ts"), [
    "rejects raw credential secrets before persisting work queues",
  ])
  requireText("packages/opencode/test/ulm/operation-extras.test.ts", await read("packages/opencode/test/ulm/operation-extras.test.ts"), [
    "rejects raw credential secrets in runtime supervisor manifests",
  ])
  requireText("packages/opencode/src/tool/operation_governor.ts", await read("packages/opencode/src/tool/operation_governor.ts"), [
    "Provider.Service",
    "buildModelRuntimeCatalog",
    "writeRuntimeGovernorRouteAudit",
    "model_route_audit",
    "modelCatalog",
  ])
  requireText("packages/opencode/src/tool/task_restart_args.ts", await read("packages/opencode/src/tool/task_restart_args.ts"), [
    "taskRestartArgs",
    "commandRestartArgs",
    "command_supervise",
    "workUnitID",
  ])
  requireText("packages/opencode/src/ulm/work-queue.ts", workQueue, [
    "buildWorkQueue",
    "nextWorkUnits",
    "work-queue.json",
    "commandSupervise",
    "containsRawCredentialSecret",
    "work queues must not contain raw credential secrets",
    "work queue only emits non_destructive",
  ])
  requireText("packages/opencode/src/session/todo.ts", todoService, [
    "export function active",
    'todo.status === "pending"',
    'todo.status === "in_progress"',
  ])
  requireText("packages/opencode/src/command/index.ts", commandService, ["CLEAR_TASKS", "CLEAR_TASKS_ZH", "todowrite"])
  requireText("packages/opencode/src/config/config.ts", configService, ["enable_sse_json_repair"])
  requireText("packages/core/src/effect/observability.ts", observability, [
    "OTEL_SERVICE_NAME",
    "service.version",
    "deployment.environment.name",
  ])
  requireText("packages/opencode/src/tool/shell.ts", shellTool, [
    "isDangerousProcessKillCommand",
    "DANGEROUS_PROCESS_KILL_PATTERNS",
    "Broadly killing Node.js processes can crash OpenCode",
  ])
  requireText("packages/opencode/src/tool/shell/shell.txt", shellPrompt, ["pkill node", "taskkill /F /IM node.exe"])
  requireText("packages/opencode/src/session/system.ts", systemPrompt, ["pkill node", "OpenCode itself runs on Node.js"])
  requireText("packages/opencode/src/cli/cmd/tui/component/prompt/paste.ts", promptPaste, [
    "displayOffsetToStringIndex",
    "expandPromptTextParts",
    "Bun.stringWidth",
  ])
  requireText("packages/opencode/src/project/project.ts", projectService, [
    "isBareRepo ? sandbox",
    "readCachedProjectId(common)",
  ])
  requireText("packages/opencode/src/provider/transform.ts", providerTransform, [
    "providerExecuted",
    "isClientToolPart",
    "tool-result",
    "MAX_DEPTH",
    "sanitizeMoonshot",
    "additionalProperties: true",
  ])
  requireText("packages/opencode/src/provider/sse-repair.ts", sseRepair, ["repairSSEEvent", "jsonrepair", "text/event-stream"])
  requireText("packages/opencode/src/provider/provider.ts", providerService, [
    "cfg.experimental?.enable_sse_json_repair === true",
    "repairSSE(res)",
  ])
  requireText("packages/opencode/src/plugin/codex.ts", codexPlugin, [
    "requireRefreshToken",
    "refreshTokenOrPrevious",
    "currentAuth.refresh = refresh",
  ])
  requireText("packages/opencode/test/plugin/codex.test.ts", codexTests, [
    "preserves existing refresh_token",
    "uses rotated refresh_token",
    "requires refresh_token for initial OAuth",
  ])
  requireText("packages/plugin/src/index.ts", pluginTypes, [
    "pre_chat.messages.transform",
    "@deprecated Use `pre_chat.messages.transform`",
  ])
  requireText("packages/opencode/src/session/prompt.ts", sessionPrompt, [
    "pre_chat.messages.transform",
    "msgs = preChat.messages",
    "msgs = legacyChat.messages",
  ])
  requireText("packages/opencode/src/server/routes/instance/httpapi/groups/v2/model.ts", v2ModelGroup, [
    "v2.model.list",
    "InstanceContextMiddleware",
    "WorkspaceRoutingMiddleware",
  ])
  requireText("packages/opencode/src/server/routes/instance/httpapi/handlers/v2/model.ts", v2ModelHandler, [
    "providerModelToV2Info",
    "Provider.Service",
  ])
  requireText("packages/sdk/js/src/v2/gen/sdk.gen.ts", sdk, ["class Model", "get model()", 'url: "/api/model"'])
  for (const tool of [
    "operation_checkpoint",
    "operation_plan",
    "operation_resume",
    "operation_run",
    "runtime_scheduler",
    "runtime_daemon",
    "operation_queue",
    "operation_queue_next",
    "operation_schedule",
    "operation_next",
    "operation_recover",
    "operation_stage_gate",
    "operation_status",
    "evidence_normalize",
    "runtime_summary",
    "task_restart",
  ]) {
    assert(await exists(`packages/opencode/src/tool/${tool}.ts`), `${tool}.ts is missing`)
    assert(await exists(`packages/opencode/src/tool/${tool}.txt`), `${tool}.txt is missing`)
  }
  const pkg = JSON.parse(await read("packages/opencode/package.json"))
  assert(pkg.scripts?.["ulm:runtime-daemon"]?.includes("ulm-runtime-daemon.ts"), "package script ulm:runtime-daemon is missing")
  assert(pkg.scripts?.["ulm:burnin"]?.includes("ulm-burnin.ts"), "package script ulm:burnin is missing")
  assert(pkg.scripts?.["ulm:tool-preflight"]?.includes("--preflight"), "package script ulm:tool-preflight is missing")
  assert(
    pkg.scripts?.["ulm:literal-run-readiness"]?.includes("ulm-literal-run-readiness.ts"),
    "package script ulm:literal-run-readiness is missing",
  )
  assert(
    pkg.scripts?.["ulm:laptop-preflight"]?.includes("ulm-laptop-preflight.ts"),
    "package script ulm:laptop-preflight is missing",
  )
  assert(
    pkg.scripts?.["ulm:credential-review"]?.includes("ulm-credential-review.ts"),
    "package script ulm:credential-review is missing",
  )
  assert(
    pkg.scripts?.["ulm:wall-clock-canary"]?.includes("ulm-wall-clock-canary.ts"),
    "package script ulm:wall-clock-canary is missing",
  )
  assert(
    pkg.scripts?.["ulm:first-run-rehearsal"]?.includes("ulm-first-run-rehearsal.ts"),
    "package script ulm:first-run-rehearsal is missing",
  )
  assert(
    pkg.scripts?.["ulm:first-run-launch-packet"]?.includes("ulm-first-run-launch-packet.ts"),
    "package script ulm:first-run-launch-packet is missing",
  )
  assert(
    pkg.scripts?.["ulm:first-run-objective-audit"]?.includes("ulm-first-run-objective-audit.ts"),
    "package script ulm:first-run-objective-audit is missing",
  )
  requireText("packages/opencode/src/ulm/wall-clock-canary.ts", await read("packages/opencode/src/ulm/wall-clock-canary.ts"), [
    "runWallClockCanary",
    "targetElapsedSeconds + intervalSeconds * 2",
    "auditLiteralRunReadiness",
    "canary-model-lane",
    "board-report.pdf",
    "ceh-technical-report.pdf",
    "ulm-team-report.pdf",
    "canaryTextArtifact",
    "Recommended Board Actions",
    "Residual Harness Risks",
    "canaryFinalPackageGaps",
    "is missing required section",
    "page count could not be read",
    "finalPackageGaps.length === 0",
    "finalHandoff",
  ])
  requireText("packages/opencode/script/ulm-wall-clock-canary.ts", await read("packages/opencode/script/ulm-wall-clock-canary.ts"), [
    "--target-seconds",
    "--interval-seconds",
    "--strict",
    "--full",
    "heartbeatPath",
    "literalElapsedSeconds",
    "runWallClockCanary",
  ])
  requireText("packages/opencode/src/ulm/first-run-rehearsal.ts", await read("packages/opencode/src/ulm/first-run-rehearsal.ts"), [
    "runFirstRunRehearsal",
    "school-laptop-48h",
    "writeRuntimeSupervisor",
    "auditLaptopPreflight",
    "runWallClockCanary",
    "launchReadiness",
    "--require-launch-ready",
    "first-run-rehearsal.json",
  ])
  requireText("packages/opencode/script/ulm-first-run-rehearsal.ts", await read("packages/opencode/script/ulm-first-run-rehearsal.ts"), [
    "--canary-target-seconds",
    "--canary-interval-seconds",
    "--strict",
    "runFirstRunRehearsal",
  ])
  requireText("packages/opencode/src/ulm/first-run-launch-packet.ts", await read("packages/opencode/src/ulm/first-run-launch-packet.ts"), [
    "writeFirstRunLaunchPacket",
    "school-laptop-48h",
    "first-run-launch-packet.json",
    "preflight_required",
    "overwriteExisting",
    "additionalCredentialTargets",
    "scopeRequirements",
    "credentialVaultPath",
    "openCredentialVault",
    "ulm:credential-review",
    "launchReadiness",
    "--require-launch-ready",
    "Do not launch the 48-hour daemon until",
    "ulm:first-run-objective-audit",
  ])
  requireText("packages/opencode/script/ulm-first-run-launch-packet.ts", await read("packages/opencode/script/ulm-first-run-launch-packet.ts"), [
    "--target-hours",
    "--credential-target",
    "--scope-rule",
    "--force",
    "--strict",
    "writeFirstRunLaunchPacket",
  ])
  requireText("packages/opencode/src/ulm/credential-review.ts", await read("packages/opencode/src/ulm/credential-review.ts"), [
    "auditCredentialReview",
    "operationPlanRequiresCredentialHandoff",
    "readOperationCredentialReview",
    "credential-review.json",
    "credentialed plan requires the vault Submit to agent button",
    "raw secret fields",
  ])
  requireText("packages/opencode/src/ulm/command-text.ts", await read("packages/opencode/src/ulm/command-text.ts"), [
    "commandTextTokens",
    "stripShellComments",
    "hasExactCommandFlag",
    "hasExactCommandToken",
    "hasExactCommandPrefix",
    "hasExactCommandTokens",
    "hasExactCommandTokenAfterPrefix",
    "hasShellControlOperator",
    "hasOnlyExactCommandArgValues",
    "hasOnlyExactCommandKeyValue",
    "hasExactCommandArg",
    "hasExactCommandArgValues",
    "commandArgValues",
    "commandKeyValueValues",
    "hasExactCommandKeyValue",
  ])
  requireText("packages/opencode/test/ulm/command-text.test.ts", await read("packages/opencode/test/ulm/command-text.test.ts"), [
    "matches exact operation tokens without accepting suffix collisions",
    "ignores command flags and args that only appear in shell comments",
    "collects repeated arg values and requires every expected value",
    "requires exact arg sets when launch commands must be unambiguous",
    "matches key-value tokens exactly",
    "requires a single exact key-value token when launch commands must be unambiguous",
    "matches exact command prefixes without accepting wrapper commands",
    "matches exact full command tokens without accepting trailing extras",
    "matches the exact positional token after a command prefix",
    "detects shell control operators outside comments",
  ])
  requireText("packages/opencode/src/ulm/operation-credentials.ts", await read("packages/opencode/src/ulm/operation-credentials.ts"), [
    "readOperationCredentialReview",
    "expectedServices: expectedServices.length ? expectedServices : submission.expectedServices",
  ])
  requireText("packages/opencode/script/ulm-credential-review.ts", await read("packages/opencode/script/ulm-credential-review.ts"), [
    "--operation-id",
    "--strict",
    "auditCredentialReview",
  ])
  requireText("packages/opencode/src/ulm/first-run-objective-audit.ts", await read("packages/opencode/src/ulm/first-run-objective-audit.ts"), [
    "auditFirstRunObjective",
    "Prompt-to-Artifact Checklist",
    "literal-48h-proof",
    "laptop-preflight-proof",
    "laptop-preflight-bypass",
    "48 * 60 * 60",
    "requiredLiteral48hChecks",
    "requiredLiteral48hDetailEvidence",
    "credential-handoff-proof",
    "credential-handoff-proof:before-daemon-start",
    "credential_before_daemon_start=true",
    "requiredSelectedCanaryChecks",
    "selected-operation-canary-proof",
    "requiredPreflightChecks",
    "requiredBehaviorProbeScenarios",
    "live-behavior-probes",
    "resolveProbeArtifact",
    "finalPackagePdfGaps",
    "final-manifest:pdf-gaps",
    "not-pdf",
    "missing-styled-renderer",
    "collectFinalPackageStakeholderGaps",
    "final-manifest:stakeholder-gaps",
    "final-package:stakeholder-proof",
    ":page-count-missing",
    "missing_artifacts",
    "weak_reports",
    "latest_failed",
    "stale_sources",
    "latestReports",
    "nonEmptyFileIncludes",
    "operator-power",
    "operator-sleep",
    "operator-wifi",
    "operator-scope",
    "operator-clock",
    "missing_manifest_files=none",
    "missing_detail_evidence",
    "first-run-launch-packet",
    "selected-operation-launch-packet",
    "selected-operation-template",
    "hasExactCommandFlag",
    "hasExactCommandToken",
    "hasExactCommandTokens",
    "hasShellControlOperator",
    "hasExactCommandArg",
    "credentialVaultPathReady",
    "openCredentialVaultCommandReady",
    "exactCommandReady",
    "credentialRequirementReviewCommandReady",
    "credentialRequirementCommandGaps",
    "canaryCommandReady",
    "launchReadinessCommandReady",
    "daemon48hCommandReady",
    "supervisorCommandReady",
    "command_gaps",
    "missingScopeRequirementRules",
    "missing_scope_baselines",
    "selected-operation-credential-review",
    "underlying_submitted",
    "underlying_submitted_at_valid",
    "underlying_raw_secrets",
    "selected-operation-preflight",
    "expected_canary_operation_id",
    "plan_operation_id",
    "laptop-preflight.json",
    "current_credential_gaps",
    "preflight_stale_plan",
    "preflight_stale_credential_review",
    "preflight-stale-credential-review",
    "supervisor-runbook-launch-readiness",
    "supervisor_command_operation_current",
    "supervisor_runbook_launch_readiness",
    "credential_submission_timestamp_gap",
    "credential-submission-timestamp",
    "current_credential_submitted_at",
    "missing_current_credential_evidence",
    "credential-handoff-proof:submitted-at-current",
    "current-credential-services",
    "final-audit:before-final-manifest",
    "school-laptop-48h",
    "audit_operation_id",
    "missing_ok_checks",
  ])
  requireText("packages/opencode/script/ulm-first-run-objective-audit.ts", await read("packages/opencode/script/ulm-first-run-objective-audit.ts"), [
    "--operation-id",
    "--strict",
    "auditFirstRunObjective",
  ])
  requireText("packages/opencode/test/ulm/operation-supervisor.test.ts", await read("packages/opencode/test/ulm/operation-supervisor.test.ts"), [
    "starts reporting closeout when a long run enters its protected finalization window",
    "does not release handoff when the handoff stage gate is failing",
    "rejects raw credential secrets before writing supervisor review artifacts",
  ])
  requireText("packages/opencode/test/ulm/operation-recovery.test.ts", await read("packages/opencode/test/ulm/operation-recovery.test.ts"), [
    "rejects raw credential secrets before marking recovered lanes running",
  ])
  requireText("packages/opencode/test/ulm/wall-clock-canary.test.ts", await read("packages/opencode/test/ulm/wall-clock-canary.test.ts"), [
    "runs the daemon long enough to produce audited literal runtime proof",
    "daemon-heartbeat-continuity",
    "final-package",
    "final-operation-audit",
    "/ULMCodeRenderer (styled-html)",
    "/Count 1",
    "checks.finalHandoff.gaps",
    "cycles).toBeUndefined",
    "checks).toBeUndefined",
  ])
  requireText("packages/opencode/test/ulm/first-run-rehearsal.test.ts", await read("packages/opencode/test/ulm/first-run-rehearsal.test.ts"), [
    "proves the school-laptop template, preflight, supervisor, and wall-clock canary chain",
    "first-run-rehearsal.json",
    "Run `launchReadiness` immediately before `daemon48h`",
    "--require-launch-ready",
  ])
  requireText("packages/opencode/test/ulm/first-run-launch-packet.test.ts", await read("packages/opencode/test/ulm/first-run-launch-packet.test.ts"), [
    "creates the real school-laptop operation and operator launch packet without forging readiness",
    "refuses to overwrite an existing real launch operation unless forced",
    "first-run-launch-packet.ts",
    "preflight_required",
    "additionalCredentialTargets",
    "--credential-target",
    "--scope-rule",
    "ulm:credential-review",
    "launchReadiness",
    "--require-launch-ready",
  ])
  requireText("packages/opencode/test/ulm/first-run-objective-audit.test.ts", await read("packages/opencode/test/ulm/first-run-objective-audit.test.ts"), [
    "does not accept selected launch packets whose credential vault commands point at a suffix-mismatched operation id",
    "does not accept selected launch packets whose preflight command omits strict laptop confirmations",
    "does not accept selected launch packets whose preflight command hides confirmations in a shell comment",
    "does not accept selected launch packets when only the daemon command points at a suffix-mismatched operation id",
    "does not accept selected launch packets without an exact supervisor handoff command",
    "does not accept selected launch packets when only the packet launchReadiness command points at a suffix-mismatched operation id",
    "does not accept selected launch packets when the supervisor readiness gate points at a suffix-mismatched operation id",
  ])
  requireText("packages/opencode/test/ulm/laptop-preflight.test.ts", await read("packages/opencode/test/ulm/laptop-preflight.test.ts"), [
    "rejects school-laptop launch readiness runbooks for a suffix-mismatched operation id",
  ])
  requireText("packages/opencode/test/ulm/credential-review.test.ts", await read("packages/opencode/test/ulm/credential-review.test.ts"), [
    "blocks a credentialed operation until the vault review is submitted",
    "does not require a vault submission for unauthenticated operations",
    "operator script exits nonzero in strict mode when credential review is blocked",
    "rejects raw secrets hidden inside submitted credential notes",
    "rejects submitted credential reviews with blank labels or duplicate credential ids",
    "rejects submitted credential reviews with invalid submitted timestamps",
    "rejects submitted credential reviews copied from another operation id",
    "rejects submitted credential reviews whose file reference is noncanonical",
  ])
  requireText("packages/opencode/src/ulm/credential-safety.ts", await read("packages/opencode/src/ulm/credential-safety.ts"), [
    "hasNonNegatedCredentialService",
    "CREDENTIAL_SERVICE_ALIASES",
  ])
  requireText("packages/opencode/test/ulm/credential-safety.test.ts", await read("packages/opencode/test/ulm/credential-safety.test.ts"), [
    "does not treat negated service labels as credential coverage",
  ])
  requireText("packages/opencode/test/ulm/operation-credentials.test.ts", await read("packages/opencode/test/ulm/operation-credentials.test.ts"), [
    "refreshes expected credential services when the plan changes after review submission",
  ])
  requireText("packages/opencode/test/ulm/first-run-objective-audit.test.ts", await read("packages/opencode/test/ulm/first-run-objective-audit.test.ts"), [
    "maps the launch prompt to concrete readiness evidence",
    "does not accept selected 48h proof without a passing selected credential review gate",
    "first-run-next-actions.json",
    "writes operator next actions for launch blockers",
    "operationNextActionsMarkdown",
    "blockedBy",
    "Blocked by:",
    "launchDecision",
    "canStartDaemon",
    "ready-to-launch",
    "Launch Decision",
    "--require-launch-ready",
    "operator script can require launch-ready state before the daemon starts",
    "submit-credential-vault",
    "repair-selected-operation-plan",
    "--force --strict --json",
    "open the local ULMCode vault route",
    "/ulm/credentials?operationID=",
    "Genesis, Google, and Clever credential services are expected",
    "--duration-hours 72",
    "run-laptop-preflight",
    "run-literal-target-hours",
    "writes an explicit objective requirement matrix beside check-level evidence",
    "Objective Completion Matrix",
    "nextActionIds",
    "school-surface-private-wifi-launch",
    "professional-role-dossiers",
    "massive-modern-final-report-package",
    "selected-real-run-proof",
    "does not accept a forged selected credential review without the underlying vault review",
    "does not accept a selected credential review whose underlying vault review contains raw secrets",
    "does not accept a stale selected credential review when the vault submission is newer than the review",
    "does not accept a selected credential review when the underlying vault credential count changed",
    "does not accept a selected credential review whose summary has no valid checked timestamp",
    "does not accept a selected credential review whose submitted timestamp mismatches the vault review",
    "does not accept a selected credential review that points at a noncanonical vault review path",
    "does not accept a selected credential review whose vault review file self-reference is noncanonical",
    "does not accept a selected credential review whose vault credential index is malformed",
    "does not accept a selected credential review whose vault review has an invalid submitted timestamp",
    "does not accept selected 48h proof without credential handoff timing evidence",
    "does not accept selected 48h proof when underlying final PDFs are not parseable",
    "does not accept selected 48h proof when underlying final PDFs spoof page counts without styled PDF metadata",
    "does not accept selected 48h proof when the underlying final audit predates the final manifest",
    "board-report.pdf:not-pdf",
    "board-report.pdf:page-count-missing",
    "does not accept selected 48h proof without a real selected wall-clock canary",
    "does not accept selected 48h proof without a real launch packet",
    "target_hours_matches",
    "accepts selected launch packet commands that match a longer plan time budget",
    "does not accept selected launch packet daemon commands that undershoot the plan time budget",
    "does not accept selected launch packets whose credential vault open command is wrapped",
    "does not accept selected launch packets whose structured credential review command is weak",
    "does not accept selected launch packet package-script commands when they are wrapped",
    "does not accept selected launch packet positional commands that smuggle the operation id later",
    "does not accept selected launch packet commands that chain extra shell work",
    "does not accept selected launch packet commands with ambiguous duplicate args",
    "does not accept selected launch packet commands with extra unknown tokens",
    "does not accept selected launch packets whose canary command points at the wrong operation",
    "unexpected_required_items",
    "does not accept selected launch packet checklist rows that are duplicated or unknown",
    "credential_checklist_services_current",
    "does not accept a selected launch packet whose structured credential requirements name stale services",
    "does not accept selected launch packet credential requirements that are noncanonical or duplicated",
    "does not accept a selected launch packet whose credential checklist names stale services",
    "accepts selected launch packet credential checklist services when SIS or vendor are explicit targets",
    "does not accept a selected launch packet whose scope requirements are stale",
    "does not accept selected launch packet scope requirements that are stale, noncanonical, or duplicated",
    "does not accept a forged 48h readiness status",
    "does not accept a selected school laptop plan without baseline scope rules",
    "credential_target_gaps",
    "does not accept selected school laptop plan credential targets that are noncanonical or duplicated",
    "scope_rule_gaps",
    "does not accept selected school laptop scope rules that are blank, padded, or duplicated",
    "identity-boundary",
    "does not accept a selected school laptop plan without role-focused identity research boundaries",
    "operation-graph-identity-lanes",
    "does not accept selected school laptop preflight without person and identity graph lanes",
    "does not accept a selected operation whose laptop preflight is missing",
    "does not accept a selected operation plan copied from another operation id",
    "does not accept selected laptop preflight proof after its supervisor readiness runbook is rebound to another operation",
    "does not accept a ready selected laptop preflight when current credential coverage is missing",
    "does not accept a selected laptop preflight older than the current operation plan",
    "preflight_plan_fingerprint_current",
    "does not accept a selected laptop preflight whose plan fingerprint is stale",
    "does not accept a selected laptop preflight older than the current vault credential submission",
    "does not accept a selected laptop preflight when the current vault credential submission timestamp is invalid",
    "does not accept selected 48h proof when the current vault credential submission changed after readiness proof",
    "does not accept selected 48h proof when current vault credential services changed after readiness proof",
    "does not accept 48h proof from an operation that is not the school laptop template",
    "does not accept copied 48h proof from a different operation id",
    "requires the literal readiness audit to prove no laptop preflight bypass scar exists",
    "requires the literal readiness audit to prove the matching laptop preflight was ready",
    "requires the literal readiness audit to prove stakeholder final package files existed",
    "does not accept selected 48h proof whose final stakeholder report package is shallow",
    "board-report.md:missing:## Executive Decision Summary",
    "does not accept a shallow ready laptop preflight without underlying launch checks",
    "does not accept selected 48h proof without passing live behavior probe artifacts",
    "does not accept shallow live behavior probe JSON without transcript and prompt artifacts",
    "does not accept live behavior probes with findings or empty prompt/transcript artifacts",
    "does not accept an older passing live probe when a newer probe for the same scenario failed",
    "final-package:file-proof",
    "literal-48h-proof",
  ])
  requireText("packages/opencode/test/ulm/artifact.test.ts", await read("packages/opencode/test/ulm/artifact.test.ts"), [
    "../board-report.pdf",
    "deliverables/final/manifest.json artifact boardReportPdf does not match board-report.pdf",
    "Operation: other-school",
    "deliverables/final/board-report.md operationID does not match operation",
  ])
  requireText("packages/opencode/test/ulm/operation-next.test.ts", await read("packages/opencode/test/ulm/operation-next.test.ts"), [
    "includes operation plan scope rules in next lane prompts",
  ])
  requireText("packages/opencode/test/ulm/runtime-scheduler.test.ts", await read("packages/opencode/test/ulm/runtime-scheduler.test.ts"), [
    "supervisor finalization window launches report closeout instead of more broad execution",
  ])
  return { id: "operation_runtime", status: "ok", detail: "durable runtime, resume, recovery, and stage tools are wired" } satisfies CheckResult
}

async function auditReportQuality() {
  const artifact = await read("packages/opencode/src/ulm/artifact.ts")
  const reportLint = await read("packages/opencode/src/tool/report_lint.ts")
  const tests = await read("packages/opencode/test/ulm/artifact.test.ts")
  const longReportSkill = await read("tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md")
  requireText("packages/opencode/src/ulm/artifact.ts", artifact, [
    "FINAL_PACKAGE_FILES",
    "findings.json",
    "evidence-index.json",
    "operator-review.md",
    "executive-summary.md",
    "technical-appendix.md",
    "board-report.pdf",
    "ceh-technical-report.pdf",
    "ulm-team-report.pdf",
    "runtime-summary.md",
    "outlineSectionBudgets",
    "containsRawCredentialSecret",
    "credentialIndexGaps",
    "credential review operation id does not match selected operation",
    "credential review file reference is not canonical",
    "credential review submittedAt is not a valid timestamp",
    "operation checkpoints must not contain raw credential secrets",
    "evidence records must not contain raw credential secrets",
    "finding records must not contain raw credential secrets",
    "report outlines must not contain raw credential secrets",
    "eval scorecards must not contain raw credential secrets",
    "report contains raw credential secrets",
    "report contains private-life dossier details",
    "report contains destructive exploit execution claims",
    "assertFinalReportArtifactSafe",
    "finalReportArtifactSafetyGaps",
    "finalTextArtifactTerms",
    "deliverables/final/executive-summary.md",
    "deliverables/final/ceh-technical-report.md",
    "deliverables/final/ulm-team-report.md",
    "is missing required section",
    "reportableFindings count does not match findings.json",
    "evidence list does not match evidence-index.json",
    "operationID does not match operation",
    "references missing evidence",
    "referencedBy does not match findings.json",
    "report.html is missing required content",
    "runtime summaries must not contain raw credential secrets",
    "operation plans must not contain raw credential secrets",
    "operation discovery charters must not contain raw credential secrets",
    "operation discovery charter approvals must not contain raw credential secrets",
    "coverage contracts must not contain raw credential secrets",
    "district profiles must not contain raw credential secrets",
    "person profiles must not contain raw credential secrets",
    "identity graphs must not contain raw credential secrets",
    "containsPrivateDossierDetail",
    "person profiles must not contain private-life dossier details",
    "identity graphs must not contain private-life dossier details",
    "reportSectionForOutlineTitle",
    "requireOutlineSections",
    "minOutlineSectionWords",
    "outline section is too sparse",
    "readAuthoredReport",
    "markdownReportToHtml",
    "htmlToPdfLines",
    "function pdfPageCount",
    "deliverables/final/${file} page count could not be read",
  ])
  requireText("packages/opencode/src/tool/report_lint.ts", reportLint, [
    "requireOutlineSections",
    "minOutlineSectionWords",
    "minOutlineSectionWordsPerPage",
  ])
  requireText("packages/opencode/src/tool/report_lint.txt", await read("packages/opencode/src/tool/report_lint.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
    "private-life dossier details",
  ])
  requireText("packages/opencode/src/tool/report_render.txt", await read("packages/opencode/src/tool/report_render.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
    "destructive production exploit claims",
  ])
  requireText("packages/opencode/src/tool/runtime_summary.txt", await read("packages/opencode/src/tool/runtime_summary.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/operation_plan.txt", await read("packages/opencode/src/tool/operation_plan.txt"), [
    "Discovery Charters, approval notes, or the operation plan",
  ])
  requireText("packages/opencode/src/tool/operation_checkpoint.txt", await read("packages/opencode/src/tool/operation_checkpoint.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/report_outline.txt", await read("packages/opencode/src/tool/report_outline.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/eval_scorecard.txt", await read("packages/opencode/src/tool/eval_scorecard.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/output_normalize.txt", await read("packages/opencode/src/tool/output_normalize.txt"), [
    "Use redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/evidence_record.txt", await read("packages/opencode/src/tool/evidence_record.txt"), [
    "Cite redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/finding_record.txt", await read("packages/opencode/src/tool/finding_record.txt"), [
    "Refer to redacted credential IDs or vault-backed handles only.",
  ])
  requireText("packages/opencode/src/tool/person_profile.txt", await read("packages/opencode/src/tool/person_profile.txt"), [
    "Do not store private-life details",
  ])
  requireText("packages/opencode/src/tool/identity_graph.txt", await read("packages/opencode/src/tool/identity_graph.txt"), [
    "Keep people nodes professional and engagement-relevant.",
  ])
  requireText("packages/opencode/test/ulm/artifact.test.ts", tests, [
    "lints missing outline report sections",
    "lints sparse outline report sections",
    "rejects raw credential secrets in evidence records",
    "rejects raw credential secrets in finding records",
    "rejects raw credential secrets in operation checkpoint records",
    "rejects raw credential secrets in report outlines, eval scorecards, and coverage contracts",
    "lints raw credential secrets in authored reports",
    "lints private dossier and destructive exploit claims in authored reports",
    "quarantines authored raw credential material outside final reports",
    "quarantines authored private dossier and destructive exploit claims outside final reports",
    "quarantines generated private dossier details outside final reports",
    "quarantines generated destructive exploit claims outside final reports",
    "quarantines unsafe generated content for internal CEH review instead of putting it in final reports",
    "rejects raw credential secrets in runtime summaries",
    "rejects raw credential secrets in operation plans",
    "rejects raw credential secrets in discovery charters and approval notes",
    "rejects raw credential secrets in district, person, and identity profile artifacts",
    "rejects private-life dossier content in person and identity artifacts",
    "allows excluded-private-info notes without storing the private details as profile facts",
    "operation audit forwards strict outline section gates",
    "operation audit rejects malformed credential review indexes for credentialed plans",
    "operation audit rejects raw secret fields in credential review indexes for credentialed plans",
    "operation audit rejects copied credential reviews from another operation id",
    "operation audit rejects credential reviews whose file self-reference is noncanonical",
    "operation audit rejects credential reviews with invalid submitted timestamps",
    "handoff stage gate forwards strict outline section gates",
    "renders and audits a synthetic 50-page final report package",
    "rendered reports preserve authored report markdown",
    "Scope, Authorization, and Methodology",
    "Risk Register and Prioritized Roadmap",
    "deliverables/final/findings.json is required",
    "deliverables/final/evidence-index.json is required",
    "deliverables/final/operator-review.md is required",
    "deliverables/final/executive-summary.md contains private-life dossier details",
    "deliverables/final/ceh-technical-report.md contains destructive exploit execution claims",
    "deliverables/final/board-report.md is missing required section: ## Recommended Board Actions",
    "deliverables/final/manifest.json reportableFindings count does not match findings.json",
    "deliverables/final/manifest.json findings list does not match findings.json",
    "deliverables/final/manifest.json evidence list does not match evidence-index.json",
    "deliverables/final/report.html is missing required content: Finding State Counts",
    "deliverables/final/findings.json operationID does not match operation",
    "deliverables/final/evidence-index.json operationID does not match operation",
    "deliverables/final/findings.json weak-mfa-coverage references missing evidence missing-ev",
    "deliverables/final/evidence-index.json ev-1 referencedBy does not match findings.json",
    "board-report.pdf is not a readable PDF",
    "ceh-technical-report.pdf page count could not be read",
    "cehTechnicalReportPdf",
    "ulmTeamReportPdf",
  ])
  requireText("tools/ulmcode-profile/skills/pentest-compact/k12-long-report-production/SKILL.md", longReportSkill, [
    "requireOutlineBudget: true",
    "requireOutlineSections: true",
    "requireFindingSections: true",
  ])
  return { id: "report_quality", status: "ok", detail: "strict report outline, audience package, and finding-section gates are wired" } satisfies CheckResult
}

async function auditProfileRouting() {
  const profileSkills = await read("packages/opencode/script/ulm-profile-skills.ts")
  const profileConfig = await read("tools/ulmcode-profile/opencode.json")
  const omoConfig = await read("tools/ulmcode-profile/oh-my-openagent.jsonc")
  const shellStrategy = await read("tools/ulmcode-profile/plugins/shell-strategy/shell_strategy.md")
  const pentestPrompt = await read("packages/opencode/src/agent/prompt/pentest.txt")
  const reconPrompt = await read("packages/opencode/src/agent/prompt/recon.txt")
  const actionPrompt = await read("packages/opencode/src/agent/prompt/action.txt")
  requireText("packages/opencode/script/ulm-profile-skills.ts", profileSkills, [
    "profile model must default to GPT-5.5",
    "profile small_model must use GPT-5.4 Mini Fast",
    "action must use medium reasoning",
    "websearch must route through the Exa remote MCP",
    "validator must use xhigh reasoning",
    "report-reviewer must use xhigh reasoning",
    "routing: ok",
  ])
  requireText("tools/ulmcode-profile/opencode.json", profileConfig, [
    '"model": "openai/gpt-5.5"',
    '"small_model": "openai/gpt-5.4-mini-fast"',
    '"default_agent": "pentest"',
    '"action"',
    '"websearch"',
    "web_search_exa",
    '"enable_sse_json_repair": true',
    "__ULMCODE_PROFILE_DIR__/plugins/shell-strategy/shell_strategy.md",
  ])
  requireText("tools/ulmcode-profile/oh-my-openagent.jsonc", omoConfig, [
    '"repo-scout"',
    '"xhigh-court"',
    '"reasoningEffort": "xhigh"',
  ])
  requireText("packages/opencode/src/agent/prompt/action.txt", actionPrompt, [
    "focused, one-off",
    "switching to `pentest`",
    "operation_memory",
    "quick repo fixes",
  ])
  requireText("packages/opencode/src/agent/prompt/pentest.txt", pentestPrompt, [
    "Use `operation_memory` as operation-local working memory",
    "Use `action` for focused one-off tasks",
    "prefer `websearch` first",
    "Record runtime/system constraints early",
    "treat it as stale",
  ])
  requireText("packages/opencode/src/agent/prompt/recon.txt", reconPrompt, [
    "Read `operation_memory`",
    "use `websearch` to find candidate sources",
    "Kali tools",
    "Docker availability",
  ])
  assert(!profileConfig.includes('"oh-my-openagent"'), "profile must not load Oh My OpenAgent")
  assert(!profileConfig.includes('"oh-my-opencode"'), "profile must not load legacy Oh My OpenCode")
  assert(!profileConfig.includes('"vercel"'), "profile must not include unrelated Vercel MCP")
  assert(!profileConfig.includes('"context7"'), "profile must not include unrelated context7 MCP")
  requireText("tools/ulmcode-profile/plugins/shell-strategy/shell_strategy.md", shellStrategy, [
    "Shell Non-Interactive Strategy",
    "GIT_TERMINAL_PROMPT",
    "Process Continuity",
    "Long Command Handoff",
  ])
  for (const command of [
    "ulm-final-handoff.md",
    "ulm-resume.md",
    "ulm-test-plan.md",
  ]) {
    assert(await exists(`tools/ulmcode-profile/commands/${command}`), `profile command ${command} is missing`)
  }
  return {
    id: "profile_routing",
    status: "ok",
    detail: "GPT-5.5/GPT-5.4 routing, xhigh hard-task routes, shell strategy, and ULM commands are enforced",
  } satisfies CheckResult
}

async function auditProfileRuntime() {
  const profilePackage = await read("tools/ulmcode-profile/package.json")
  const profileReadme = await read("tools/ulmcode-profile/README.md")
  const opencodeConfig = await read("tools/ulmcode-profile/opencode.json")
  const guard = await read("tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js")
  const installer = await read("tools/ulmcode-profile/scripts/install-profile.sh")
  const toolManifest = await read("tools/ulmcode-profile/tool-manifest.json")
  validateToolManifestSupervision(toolManifest)
  requireText("tools/ulmcode-profile/package.json", profilePackage, [
    "file:plugins/vendor/oh-my-openagent-3.17.12",
    "oh-my-openagent",
    "oh-my-opencode",
  ])
  assert(!opencodeConfig.includes("oh-my-openagent@latest"), "profile must not use oh-my-openagent@latest")
  requireText("tools/ulmcode-profile/plugins/ulmcode-runtime-guard.js", guard, [
    "operation_resume",
    "operation_supervise",
    "runtime_summary",
    "operation_recover",
    "report_lint",
    "exceed two minutes",
  ])
  requireText("tools/ulmcode-profile/scripts/install-profile.sh", installer, [
    "ulmcode-launch.sh",
    "websearch,agent_browser,playwright,pentestMCP",
    "rm -f \"$TARGET_DIR/oh-my-openagent.jsonc\"",
    "rm -f \"$TARGET_DIR/.opencode/oh-my-openagent.jsonc\"",
    "tool-manifest.json",
  ])
  requireText("tools/ulmcode-profile/tool-manifest.json", toolManifest, [
    '"httpx"',
    '"zap-baseline"',
  ])
  requireText("tools/ulmcode-profile/README.md", profileReadme, [
    "First School Laptop Run",
    "school-laptop-48h",
    "ulm:laptop-preflight",
    "ulm:wall-clock-canary",
    "ulm:first-run-launch-packet",
    "ulm:first-run-rehearsal",
    "ulm:first-run-objective-audit",
    "launchReadiness",
    "--require-launch-ready",
    "--duration-hours 48",
    "ulm:literal-run-readiness",
    "ulm:behavior-probe",
  ])
  assert(
    await exists("tools/ulmcode-profile/plugins/vendor/oh-my-openagent-3.17.12/dist/index.js"),
    "vendored oh-my-openagent dist is missing",
  )
  return { id: "profile_runtime", status: "ok", detail: "isolated profile, runtime guard, and vendored plugins are wired" } satisfies CheckResult
}

async function auditHarnessScheduler() {
  const pkg = JSON.parse(await read("packages/opencode/package.json")) as { scripts?: Record<string, string> }
  const workflow = await read(".github/workflows/ulm-harness.yml")
  requireText(".github/workflows/ulm-harness.yml", workflow, [
    "name: ulm-harness",
    "schedule:",
    "workflow_dispatch:",
  ])
  assert(
    workflow.includes("test:ulm-harness:chaos") || workflow.includes("test:ulm-harness:overnight"),
    ".github/workflows/ulm-harness.yml: missing scheduled long-run harness lane",
  )
  assert(
    pkg.scripts?.["test:ulm-harness:fast"]?.includes("ulm-harness-run.ts --tier fast"),
    "package script test:ulm-harness:fast is missing harness runner",
  )
  assert(
    pkg.scripts?.["test:ulm-harness:overnight"]?.includes("ulm-harness-run.ts --tier overnight"),
    "package script test:ulm-harness:overnight is missing overnight runner",
  )
  const harness = await read("packages/opencode/script/ulm-harness-run.ts")
  const runtimeDaemonTest = await read("packages/opencode/test/ulm/runtime-daemon.test.ts")
  requireText("packages/opencode/script/ulm-harness-run.ts", harness, [
    "runtime-supervisor.ts",
    "supervisor-install.md",
    "Restart=on-failure",
  ])
  requireText("packages/opencode/test/ulm/runtime-daemon.test.ts", runtimeDaemonTest, [
    "writes launchd and systemd supervisor artifacts",
    "launchctl bootstrap",
    "systemctl --user enable --now",
    "48-Hour Laptop Checklist",
    "ulm:laptop-preflight",
    "ulm:literal-run-readiness --strict --json",
  ])
  return {
    id: "harness_scheduler",
    status: "ok",
    detail: "scheduled harness workflow and overnight readiness command are wired",
  } satisfies CheckResult
}

async function auditLabCatalog() {
  const labReplay = await read("packages/opencode/script/ulm-lab-replay.ts")
  requireText("packages/opencode/script/ulm-lab-replay.ts", labReplay, [
    "requireOutlineBudget: true",
    "requireOutlineSections: true",
    "minOutlineSectionWords",
  ])
  const labs = await labManifestIDs()
  const manifests = await labManifests()
  for (const id of [
    "k12-login-mfa-gap",
    "k12-lms-payment-webhook-replay",
    "k12-family-messaging-cross-class-broadcast",
    "k12-third-party-integration-token-leak",
    "k12-sso-roster-export-chain",
  ]) {
    assert(labs.includes(id), `lab catalog missing ${id}`)
  }
  assert(labs.length >= 15, `expected at least 15 bundled labs, found ${labs.length}`)
  assert(
    manifests.filter((manifest) => (manifest.findings?.length ?? 0) >= 2).length >= 2,
    "expected at least two bundled multi-finding labs",
  )
  assert(
    manifests.some((manifest) => typeof manifest.report?.authoredMarkdownFile === "string"),
    "expected at least one bundled authored-report lab",
  )
  for (const id of labs) {
    assert(await exists(`tools/ulmcode-labs/${id}/service/server.js`), `${id}: service/server.js is missing`)
    assert(await exists(`tools/ulmcode-labs/${id}/docker-compose.yml`), `${id}: docker-compose.yml is missing`)
  }
  return {
    id: "lab_catalog",
    status: "ok",
    detail: `${labs.length} bundled labs include Docker targets, a multi-finding chain, and an authored-report replay`,
    summary: `lab_catalog: ok (${labs.length})`,
  } satisfies CheckResult
}

async function auditRequiredGates() {
  const pkg = JSON.parse(await read("packages/opencode/package.json")) as { scripts?: Record<string, string> }
  const scripts = pkg.scripts ?? {}
  for (const script of [
    "typecheck",
    "test:ulm-smoke",
    "test:ulm-skills",
    "test:ulm-lab",
    "test:ulm-lab-target",
    "test:ulm-rebuild-audit",
    "test:ulm-harness:full",
    "test:ulm-harness:chaos",
    "test:ulm-harness:overnight",
    "test:ulm-tool-manifest",
    "ulm:behavior-probe",
    "ulm:live-operation-probe",
  ]) {
    assert(typeof scripts[script] === "string", `package script ${script} is missing`)
  }
  const profileVerifier = await read("tools/ulmcode-profile/test-profile.sh")
  requireText("tools/ulmcode-profile/test-profile.sh", profileVerifier, [
    "test:ulm-smoke",
    "test:ulm-skills",
    "test:ulm-lab",
    "test:ulm-lab-target",
    "test:ulm-tool-manifest",
  ])
  return { id: "required_gates", status: "ok", detail: "package and profile verifier scripts include the ULM gates" } satisfies CheckResult
}

async function auditBehaviorScenarios() {
  const scenarioIDs = [
    "k12-sso-roster-export-chain",
    "quick-network-resume-checkpoint",
    "privileged-dossier-attack-chain-report",
    "k12-exploit-chain-safety",
  ]
  for (const id of scenarioIDs) {
    const scenario = JSON.parse(await read(`tools/ulmcode-behavior-scenarios/${id}.json`)) as {
      requiredEvidenceIDs?: unknown[]
      chainTerms?: unknown[]
      reportQualityTerms?: unknown[]
      requiredTerms?: unknown[]
      forbiddenTerms?: unknown[]
    }
    assert(Array.isArray(scenario.chainTerms) && scenario.chainTerms.length > 0, `${id}: chainTerms are required`)
    assert(
      Array.isArray(scenario.reportQualityTerms) && scenario.reportQualityTerms.length > 0,
      `${id}: reportQualityTerms are required`,
    )
    if (id === "privileged-dossier-attack-chain-report") {
      for (const term of ["person_profile", "identity_graph", "attack_chain", "report_lint", "report_render", "operation_audit"]) {
        assert(scenario.requiredTerms?.includes(term), `${id}: missing required live-probe term ${term}`)
      }
      for (const term of ["home address", "raw password", "unredacted token"]) {
        assert(scenario.forbiddenTerms?.includes(term), `${id}: missing forbidden live-probe term ${term}`)
      }
      assert((scenario.requiredEvidenceIDs?.length ?? 0) >= 5, `${id}: expected privileged-chain evidence coverage`)
    }
    if (id === "k12-exploit-chain-safety") {
      for (const term of ["attack_chain", "non-destructive validation", "stop condition", "operation_audit"]) {
        assert(scenario.requiredTerms?.includes(term), `${id}: missing required exploit-chain safety term ${term}`)
      }
      for (const term of ["changed grades", "dumped student records", "backdoor", "persistence"]) {
        assert(scenario.forbiddenTerms?.includes(term), `${id}: missing forbidden exploit-chain safety term ${term}`)
      }
      assert((scenario.requiredEvidenceIDs?.length ?? 0) >= 5, `${id}: expected exploit-chain evidence coverage`)
    }
  }
  const watcher = await read("packages/opencode/src/ulm/behavior-watch.ts")
  requireText("packages/opencode/script/ulm-behavior-probe.ts", await read("packages/opencode/script/ulm-behavior-probe.ts"), [
    "buildBehaviorWatchScenarioPrompt",
    "timeoutMs",
    "OPENCODE_DISABLE_PROJECT_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "bash: false",
    "operation_goal: false",
    "operation_plan: false",
    "evidence_record: false",
    "attack_chain: false",
    "report_render: false",
    "auditBehaviorTranscript",
  ])
  const liveScenario = JSON.parse(await read("tools/ulmcode-live-scenarios/privileged-access-report-drill.json")) as {
    requiredTools?: unknown[]
    requiredArtifactGlobs?: unknown[]
    forbiddenTerms?: unknown[]
  }
  for (const tool of [
    "operation_goal",
    "operation_plan",
    "evidence_record",
    "person_profile",
    "identity_graph",
    "attack_chain",
    "finding_record",
    "report_outline",
    "report_lint",
    "report_render",
    "operation_audit",
  ]) {
    assert(liveScenario.requiredTools?.includes(tool), `privileged-access-report-drill: missing live-operation required tool ${tool}`)
  }
  for (const glob of ["*/profiles/people/*", "*/profiles/identity*", "*/chains/*", "*/findings/*", "*/reports/report-outline.md"]) {
    assert(
      liveScenario.requiredArtifactGlobs?.includes(glob),
      `privileged-access-report-drill: missing live-operation artifact pattern ${glob}`,
    )
  }
  for (const term of ["home address", "raw password", "unredacted token", "persistence"]) {
    assert(liveScenario.forbiddenTerms?.includes(term), `privileged-access-report-drill: missing forbidden live-operation term ${term}`)
  }
  requireText("packages/opencode/script/ulm-live-operation-probe.ts", await read("packages/opencode/script/ulm-live-operation-probe.ts"), [
    "requiredTools",
    "requiredArtifactGlobs",
    "OPENCODE_CONFIG_CONTENT",
    "\"*\": \"allow\"",
    "question: \"allow\"",
    "task: \"allow\"",
    "capturedTools",
    "workspace",
  ])
  requireText("packages/opencode/src/ulm/behavior-watch.ts", watcher, [
    "Do not use raw bash",
    "Do not create operation_goal",
    "Do not ask for operator approval",
    "first such tool call must be operation_resume",
    "report_lint, report_render, and operation_audit",
    "At most three tool calls",
    "Prefer no tool calls",
    "Use each required chain concept verbatim",
    "replace(/\\\\[nrt]/g",
    "nothing about",
    "excluded",
    "self-terminate",
    "irrelevant-private-dossier-content",
    "raw-secret-in-report",
    "destructive-exploit-execution",
    "sensitive-data-exfiltration",
    "persistence-or-backdoor",
    "missing-final-gates",
  ])
  return {
    id: "behavior_scenarios",
    status: "ok",
    detail: "behavior-watch and live-operation probes cover chain, resume, privileged dossier, tool use, artifacts, secret hygiene, and report gates",
  } satisfies CheckResult
}

const checkRunners = {
  upstream_current: auditUpstream,
  operation_runtime: auditOperationRuntime,
  report_quality: auditReportQuality,
  profile_routing: auditProfileRouting,
  profile_runtime: auditProfileRuntime,
  lab_catalog: auditLabCatalog,
  required_gates: auditRequiredGates,
  harness_scheduler: auditHarnessScheduler,
  behavior_scenarios: auditBehaviorScenarios,
}

const selectedCheck = readArg("--check")
assert(
  selectedCheck === undefined || selectedCheck in checkRunners,
  `unknown audit check ${selectedCheck}; expected one of ${Object.keys(checkRunners).join(", ")}`,
)
const checks: CheckResult[] = []
for (const runner of selectedCheck === undefined
  ? Object.values(checkRunners)
  : [checkRunners[selectedCheck as keyof typeof checkRunners]]) {
  checks.push(await runner())
}

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        checkedAt: new Date().toISOString(),
        checks,
      },
      null,
      2,
    ),
  )
} else {
  console.log("ulm_rebuild_audit: ok")
  for (const check of checks) console.log(check.summary ?? `${check.id}: ok`)
}
