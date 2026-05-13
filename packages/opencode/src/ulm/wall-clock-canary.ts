import fs from "fs/promises"
import path from "path"
import { operationPath, slug, writeOperationPlan, writeRuntimeSummary } from "./artifact"
import { auditLiteralRunReadiness, type LiteralRunReadinessResult } from "./literal-run-readiness"
import { createOperationGoal } from "./operation-goal"
import { writeOperationGraph } from "./operation-graph"
import { runRuntimeDaemon, type RuntimeDaemonResult } from "./runtime-daemon"

export type WallClockCanaryInput = {
  operationID?: string
  targetElapsedSeconds?: number
  intervalSeconds?: number
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
}

export type WallClockCanaryResult = {
  operationID: string
  targetElapsedSeconds: number
  daemon: RuntimeDaemonResult
  readiness: LiteralRunReadinessResult
  files: {
    operationRoot: string
    finalManifest: string
    finalAudit: string
    readinessAudit: string
    readinessMarkdown: string
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function isoAfter(value: string | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + 1000).toISOString()
}

function canaryPdf(pageCount = 1) {
  return `%PDF-1.4\n% /ULMCodeRenderer (styled-html)\n2 0 obj\n<< /Type /Pages /Kids [] /Count ${pageCount} >>\nendobj\n%%EOF\n`
}

function canaryTextArtifact(file: string, operationID: string) {
  const common = `Operation: ${operationID}`
  const byFile: Record<string, string> = {
    "report.html": `<!doctype html>\n<html><body><p>${common}</p><h2>Finding State Counts</h2></body></html>\n`,
    "README.md": `# Canary Proof\n\n${common}\n\n## Files\n## Findings\n## Evidence\n`,
    "findings.json": JSON.stringify({ operationID, counts: {}, reportable: [], retained: [] }, null, 2) + "\n",
    "evidence-index.json": JSON.stringify({ operationID, evidence: [] }, null, 2) + "\n",
    "people-profiles.md": "# People Profiles\n\nNo person profiles were recorded for the canary.\n",
    "identity-graph.json": JSON.stringify({ operationID, nodes: [], edges: [] }, null, 2) + "\n",
    "operator-review.md": `# Operator Review\n\n${common}\n\n## Handoff State\n\nCanary handoff package generated.\n\n## Review Before Client Delivery\n\nVerify canary readiness before relying on the laptop.\n`,
    "executive-summary.md": `# Executive Summary\n\n${common}\n\n## Overview\n\nCanary runtime proof completed.\n\n## Priority Items\n\nNo client findings are produced by the canary.\n`,
    "technical-appendix.md": `# Technical Appendix\n\n${common}\n\n## Scope And Methodology\n\nCanary runtime and package validation only.\n\n## Evidence Index\n\nSee daemon heartbeat and readiness audit.\n`,
    "board-report.md": `# Board Report\n\n${common}\n\n## Executive Decision Summary\n\nCanary readiness proof completed.\n\n## Recommended Board Actions\n\nDo not treat canary output as a client finding report.\n`,
    "ceh-technical-report.md": `# CEH Technical Report\n\n${common}\n\n## Scope And Methodology\n\nCanary runtime validation only.\n\n## Validated Findings\n\nNo findings are produced by the canary.\n\n## Evidence Map\n\nSee scheduler artifacts.\n`,
    "ulm-team-report.md": `# ULMCode Team Report\n\n${common}\n\n## Harness Run State\n\nCanary scheduler and final package proof generated.\n\n## Residual Harness Risks\n\nReview full run readiness separately.\n`,
    "runtime-summary.md": "# Runtime Summary\n\nCanary runtime summary copied into the final package.\n",
  }
  return byFile[file] ?? `# Canary Proof\n\n${common}\n\n${file}\n`
}

function pdfPageCount(pdf: string | undefined) {
  const match = pdf?.match(/\/Type\s*\/Pages\b[\s\S]*?\/Count\s+(\d+)/)
  const pages = Number.parseInt(match?.[1] ?? "", 10)
  return Number.isFinite(pages) && pages > 0 ? pages : undefined
}

async function canaryFinalPackageGaps(input: {
  operationID: string
  operationRoot: string
  finalDir: string
  finalManifest: string
  artifacts: Record<string, string>
}) {
  const gaps: string[] = []
  const requiredArtifacts = [
    "html",
    "pdf",
    "readme",
    "operatorReview",
    "executiveSummary",
    "technicalAppendix",
    "boardReport",
    "boardReportPdf",
    "cehTechnicalReport",
    "cehTechnicalReportPdf",
    "ulmTeamReport",
    "ulmTeamReportPdf",
    "runtimeSummaryMarkdown",
  ]
  const textTerms: Record<string, string[]> = {
    html: ["<!doctype html", "Finding State Counts", "Operation:"],
    readme: ["## Files", "## Findings", "## Evidence"],
    operatorReview: ["## Handoff State", "## Review Before Client Delivery"],
    executiveSummary: ["## Overview", "## Priority Items"],
    technicalAppendix: ["## Scope And Methodology", "## Evidence Index"],
    boardReport: ["## Executive Decision Summary", "## Recommended Board Actions"],
    cehTechnicalReport: ["## Scope And Methodology", "## Validated Findings", "## Evidence Map"],
    ulmTeamReport: ["## Harness Run State", "## Residual Harness Risks"],
  }
  let manifest: { operationID?: string; artifacts?: Record<string, unknown> } | undefined
  try {
    manifest = JSON.parse(await fs.readFile(input.finalManifest, "utf8"))
  } catch {
    gaps.push("final manifest is not readable JSON")
  }
  if (manifest?.operationID !== input.operationID) gaps.push("final manifest operationID does not match canary operation")
  for (const key of requiredArtifacts) {
    const artifact = manifest?.artifacts?.[key]
    if (typeof artifact !== "string" || !artifact.trim()) {
      gaps.push(`final manifest missing artifact: ${key}`)
      continue
    }
    const resolved = path.resolve(input.finalDir, artifact)
    if (!resolved.startsWith(input.finalDir + path.sep)) {
      gaps.push(`final manifest artifact escapes final package: ${key}`)
      continue
    }
    try {
      const body = await fs.readFile(resolved, "utf8")
      if (key.endsWith("Pdf") || key === "pdf") {
        if (!body.startsWith("%PDF-")) gaps.push(`${path.basename(resolved)} is not a readable PDF`)
        if (!body.includes("/ULMCodeRenderer (styled-html)")) gaps.push(`${path.basename(resolved)} missing styled renderer metadata`)
        if (!pdfPageCount(body)) gaps.push(`${path.basename(resolved)} page count could not be read`)
      }
      for (const term of textTerms[key] ?? []) {
        if (!body.includes(term)) gaps.push(`${path.basename(resolved)} is missing required section: ${term}`)
      }
    } catch {
      gaps.push(`final manifest artifact file is missing: ${key}`)
    }
  }
  for (const [key, file] of Object.entries(input.artifacts)) {
    const expected = path.resolve(input.finalDir, file)
    const actual = typeof manifest?.artifacts?.[key] === "string" ? path.resolve(input.finalDir, manifest.artifacts[key]) : undefined
    if (actual && actual !== expected) gaps.push(`final manifest artifact ${key} does not match ${file}`)
  }
  return gaps
}

export async function runWallClockCanary(worktree: string, input: WallClockCanaryInput = {}): Promise<WallClockCanaryResult> {
  const operationID = slug(input.operationID ?? "wall-clock-canary", "wall-clock-canary")
  const targetElapsedSeconds = Math.max(1, Math.floor(input.targetElapsedSeconds ?? 120))
  const intervalSeconds = Math.max(1, Math.floor(input.intervalSeconds ?? 1))
  const operationRoot = operationPath(worktree, operationID)

  await createOperationGoal(worktree, {
    operationID,
    objective: "Wall-clock canary for the unattended ULMCode runtime daemon.",
    targetDurationHours: targetElapsedSeconds / 3600,
  })
  await writeOperationPlan(worktree, {
    operationID,
    phases: [
      {
        stage: "recon",
        objective: "Launch a harmless scheduler lane and keep the daemon heartbeat alive for the canary window.",
        actions: ["Start the scheduler daemon with dry-run lane launches.", "Preserve daemon heartbeat and JSONL log proof."],
        successCriteria: ["Literal-readiness audit passes for the canary target."],
        subagents: ["recon"],
        noSubagents: ["destructive testing"],
      },
    ],
    reportingCloseout: [
      "Run report_lint equivalent canary handoff validation.",
      "Run report_render equivalent canary package validation.",
      "Run runtime_summary accounting before literal-readiness audit.",
    ],
  })
  await writeOperationGraph(worktree, {
    operationID,
    trustLevel: "guided",
    scanProfile: "balanced",
    budgetUSD: 1,
    maxConcurrentLanes: 1,
  })
  await writeRuntimeSummary(worktree, {
    operationID,
    modelCalls: { total: 0, byModel: {} },
    usage: { costUSD: 0, budgetUSD: 1 },
    compaction: { count: 0, pressure: "low" },
    notes: ["Prepared by wall-clock canary before daemon launch."],
  })

  const daemon = await runRuntimeDaemon(worktree, {
    operationID,
    maxRuntimeSeconds: targetElapsedSeconds + intervalSeconds * 2,
    cycleIntervalSeconds: intervalSeconds,
    maxCycles: Math.ceil((targetElapsedSeconds + intervalSeconds * 2) / intervalSeconds) + 1,
    supervisorEnabled: false,
    requireLaptopPreflight: false,
    now: input.now,
    sleep: input.sleep,
    launchModelLane: async (params) => ({ jobID: `canary-model-lane-${params.laneID}` }),
  })

  const finalManifest = path.join(operationRoot, "deliverables", "final", "manifest.json")
  const finalAudit = path.join(operationRoot, "deliverables", "operation-audit.json")
  const finalDir = path.dirname(finalManifest)
  const artifacts = {
    html: "report.html",
    pdf: "report.pdf",
    readme: "README.md",
    findingsJson: "findings.json",
    evidenceIndex: "evidence-index.json",
    peopleProfiles: "people-profiles.md",
    identityGraph: "identity-graph.json",
    operatorReview: "operator-review.md",
    executiveSummary: "executive-summary.md",
    technicalAppendix: "technical-appendix.md",
    boardReport: "board-report.md",
    boardReportPdf: "board-report.pdf",
    cehTechnicalReport: "ceh-technical-report.md",
    cehTechnicalReportPdf: "ceh-technical-report.pdf",
    ulmTeamReport: "ulm-team-report.md",
    ulmTeamReportPdf: "ulm-team-report.pdf",
    runtimeSummaryMarkdown: "runtime-summary.md",
  }
  await fs.mkdir(finalDir, { recursive: true })
  for (const file of Object.values(artifacts)) {
    await fs.writeFile(path.join(finalDir, file), file.endsWith(".pdf") ? canaryPdf() : canaryTextArtifact(file, operationID))
  }
  await writeJson(finalManifest, {
    operationID,
    generatedAt: isoAfter(daemon.endedAt),
    artifacts: {
      heartbeat: path.relative(operationRoot, daemon.heartbeatPath),
      daemonLog: path.relative(operationRoot, daemon.logPath),
      ...artifacts,
    },
  })
  const finalPackageGaps = await canaryFinalPackageGaps({ operationID, operationRoot, finalDir, finalManifest, artifacts })
  await writeJson(finalAudit, {
    operationID,
    ok: finalPackageGaps.length === 0,
    blockers: finalPackageGaps,
    generatedAt: isoAfter(daemon.endedAt),
    checks: {
      finalHandoff: {
        ok: finalPackageGaps.length === 0,
        gaps: finalPackageGaps,
        gates: {},
      },
    },
  })

  const readiness = await auditLiteralRunReadiness(worktree, {
    operationID,
    targetElapsedSeconds,
  })

  return {
    operationID,
    targetElapsedSeconds,
    daemon,
    readiness,
    files: {
      operationRoot,
      finalManifest,
      finalAudit,
      readinessAudit: readiness.auditPath,
      readinessMarkdown: readiness.markdownPath,
    },
  }
}

export function formatWallClockCanary(result: WallClockCanaryResult) {
  return [
    `# Wall-Clock Canary: ${result.operationID}`,
    "",
    `- target_elapsed_seconds: ${result.targetElapsedSeconds}`,
    `- daemon_elapsed_seconds: ${result.daemon.elapsedSeconds}`,
    `- readiness_status: ${result.readiness.status}`,
    `- operation_root: ${result.files.operationRoot}`,
    `- daemon_heartbeat: ${result.daemon.heartbeatPath}`,
    `- daemon_log: ${result.daemon.logPath}`,
    `- readiness_audit: ${result.files.readinessAudit}`,
    `- readiness_markdown: ${result.files.readinessMarkdown}`,
  ].join("\n")
}
