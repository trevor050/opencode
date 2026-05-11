import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { auditFirstRunObjective } from "@/ulm/first-run-objective-audit"

const repoRoot = path.join(__dirname, "../../..", "..")
const packageRoot = path.join(repoRoot, "packages", "opencode")

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

async function writeSchoolLaptopPlan(root: string, operationID: string) {
  await writeJson(path.join(root, "plans", "operation-plan.json"), {
    operationID,
    templateName: "school-laptop-48h",
    credentialTargets: ["genesis", "google"],
    scopeRules: [
      "Only test assets and services explicitly authorized for this school laptop operation.",
      "Stay non-destructive unless the operator records separate written approval.",
      "Person and account research must stay limited to role, authorization, identity, and workflow risk; exclude private-life dossier material.",
    ],
    timeBudget: { targetHours: 48, finalizationWindowHours: 4 },
  })
}

async function writePassingLaunchPacket(root: string, operationID: string) {
  await fs.mkdir(path.join(root, "scheduler", "supervisor"), { recursive: true })
  await fs.writeFile(
    path.join(root, "scheduler", "supervisor", "supervisor-install.md"),
    [
      "# Runtime Daemon Supervisor Install",
      "",
      "## Launch Readiness Gate",
      "",
      `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID} --require-launch-ready --json`,
    ].join("\n") + "\n",
  )
  await writeJson(path.join(root, "scheduler", "first-run-launch-packet.json"), {
    operationID,
    status: "preflight_required",
    template: "school-laptop-48h",
    targetHours: 48,
    commands: {
      credentialVaultPath: `/ulm/credentials?operationID=${operationID}`,
      openCredentialVault: `operation_credentials action=open_vault operationID=${operationID}`,
      credentialReview: `bun run --cwd packages/opencode ulm:credential-review ${operationID} --strict --json`,
      canary: `bun run --cwd packages/opencode ulm:wall-clock-canary ${operationID}-canary --target-seconds 120 --strict --json`,
      preflight: `bun run --cwd packages/opencode ulm:laptop-preflight ${operationID} --prepare --strict --confirm power --confirm sleep --confirm wifi --confirm scope --confirm clock --json`,
      daemon48h: `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 48 --detach --json`,
      supervisor: `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 48 --supervisor all --json`,
      launchReadiness: `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID} --require-launch-ready --json`,
      readiness: `bun run --cwd packages/opencode ulm:literal-run-readiness ${operationID} --strict --json`,
      objectiveAudit: `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID} --json`,
    },
    credentialRequirements: {
      required: true,
      expectedServices: ["genesis", "google"],
      vaultPath: `/ulm/credentials?operationID=${operationID}`,
      openVaultCommand: `operation_credentials action=open_vault operationID=${operationID}`,
      reviewCommand: `bun run --cwd packages/opencode ulm:credential-review ${operationID} --strict --json`,
    },
    scopeRequirements: {
      required: true,
      rules: [
        "Only test assets and services explicitly authorized for this school laptop operation.",
        "Stay non-destructive unless the operator records separate written approval.",
        "Person and account research must stay limited to role, authorization, identity, and workflow risk; exclude private-life dossier material.",
      ],
    },
    requiredBeforeLaunch: [
      { id: "wall-power" },
      { id: "sleep-disabled" },
      { id: "school-wifi" },
      { id: "scope-confirmed" },
      { id: "clock-confirmed" },
      { id: "credential-review", detail: "Genesis and Google credentials are stored through the vault with redacted indexes only." },
      { id: "tool-model-preflight" },
      { id: "wall-clock-canary" },
      { id: "laptop-preflight" },
      { id: "launch-supervisor" },
    ],
    files: {
      operationRoot: root,
      packetJson: path.join(root, "scheduler", "first-run-launch-packet.json"),
      packetMarkdown: path.join(root, "scheduler", "first-run-launch-packet.md"),
    },
  })
}

async function writePassingLaptopPreflight(root: string, operationID: string) {
  await writeJson(path.join(root, "goals", "operation-goal.json"), {
    operationID,
    targetDurationHours: 48,
  })
  await writeJson(path.join(root, "plans", "operation-graph.json"), {
    operationID,
    safetyMode: "non_destructive",
    lanes: [
      { id: "district_profile" },
      { id: "person_recon" },
      { id: "recon" },
      { id: "identity_graph" },
      { id: "identity_auth_review" },
      { id: "saas_cloud_review" },
    ],
  })
  await writeJson(path.join(root, "scheduler", "supervisor", "supervisor-manifest.json"), {
    operationID,
    command: ["bun", "run", "script/ulm-runtime-daemon.ts", operationID, "--duration-seconds", String(48 * 60 * 60)],
    files: { launchdPlist: "local.plist" },
  })
  await fs.mkdir(path.join(root, "scheduler", "supervisor"), { recursive: true })
  await fs.writeFile(
    path.join(root, "scheduler", "supervisor", "supervisor-install.md"),
    [
      "# 48-Hour Laptop Checklist",
      "## Launch Readiness Gate",
      `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID} --require-launch-ready --json`,
      "- Disable sleep/hibernate/modern standby",
      "- Join school Wi-Fi",
      "- Confirm credential vault and redacted indexes",
    ].join("\n") + "\n",
  )
  await writeJson(path.join(root, "tools", "tool-preflight.json"), { total: 2, available: 2, blocked: 0 })
  await writeJson(path.join(root, "deliverables", "model-route-audit.json"), { operationID, ok: true })
  await fs.mkdir(path.join(root, "reports"), { recursive: true })
  await fs.writeFile(path.join(root, "reports", "report-outline.md"), "# Report Outline\n\n- target_pages: 75\n")
  const planSha256 = sha256(await fs.readFile(path.join(root, "plans", "operation-plan.json"), "utf8"))
  await writeJson(path.join(root, "scheduler", "laptop-preflight.json"), {
    operationID,
    status: "ready",
    checkedAt: "2026-05-09T12:00:00.000Z",
    targetHours: 48,
    gaps: [],
    checks: [
      { id: "duration-plan", status: "ok", required: true, detail: "duration ok" },
      { id: "plan-fingerprint", status: "ok", required: true, detail: `plan_sha256=${planSha256}` },
      { id: "operation-graph", status: "ok", required: true, detail: "graph ok" },
      { id: "supervisor-manifest", status: "ok", required: true, detail: "supervisor ok" },
      { id: "supervisor-runbook", status: "ok", required: true, detail: "runbook ok" },
      { id: "tool-preflight", status: "ok", required: true, detail: "tools ok" },
      { id: "model-route-audit", status: "ok", required: true, detail: "routes ok" },
      { id: "report-outline", status: "ok", required: true, detail: "target_pages=75" },
      { id: "credential-vault", status: "ok", required: false, detail: "not required" },
      { id: "operator-power", status: "ok", required: true, detail: "operator confirmed" },
      { id: "operator-sleep", status: "ok", required: true, detail: "operator confirmed" },
      { id: "operator-wifi", status: "ok", required: true, detail: "operator confirmed" },
      { id: "operator-scope", status: "ok", required: true, detail: "operator confirmed" },
      { id: "operator-clock", status: "ok", required: true, detail: "operator confirmed" },
    ],
  })
}

async function writePassingLaptopPreflightWithReportTarget(root: string, operationID: string, targetPages: number) {
  await writePassingLaptopPreflight(root, operationID)
  const preflightPath = path.join(root, "scheduler", "laptop-preflight.json")
  const preflight = JSON.parse(await fs.readFile(preflightPath, "utf8"))
  preflight.checks = preflight.checks.map((item: { id?: string; detail?: string }) =>
    item.id === "report-outline" ? { ...item, detail: `target_pages=${targetPages}` } : item,
  )
  await writeJson(preflightPath, preflight)
}

async function writePassingCredentialReview(root: string, operationID: string) {
  await writeJson(path.join(root, "credentials", "review-submission.json"), {
    operationID,
    submittedAt: "2026-05-09T11:55:00.000Z",
    credentials: [
      { credentialID: "genesis-test", label: "Genesis test account", password: "********" },
      { credentialID: "google-workspace-test", label: "Google Workspace test account", password: "********" },
    ],
    file: path.join(root, "credentials", "review-submission.json"),
  })
  await writeJson(path.join(root, "scheduler", "credential-review.json"), {
    operationID,
    status: "ready",
    checkedAt: "2026-05-09T12:00:00.000Z",
    credentialsRequired: true,
    submitted: true,
    submittedAt: "2026-05-09T11:55:00.000Z",
    credentialCount: 2,
    gaps: [],
    files: {
      json: path.join(root, "scheduler", "credential-review.json"),
      markdown: path.join(root, "scheduler", "credential-review.md"),
      review: path.join(root, "credentials", "review-submission.json"),
    },
  })
}

function fixturePdf(pageCount = 1) {
  return `%PDF-1.4\n% /ULMCodeRenderer (styled-html)\n2 0 obj\n<< /Type /Pages /Kids [] /Count ${pageCount} >>\nendobj\n%%EOF\n`
}

function fixtureStakeholderArtifact(file: string, operationID: string, pageCount = 1) {
  if (file.endsWith(".pdf")) return fixturePdf(pageCount)
  const common = `Operation: ${operationID}`
  const byFile: Record<string, string> = {
    "report.html": `<!doctype html>\n<html><body><p>${common}</p><h2>Finding State Counts</h2></body></html>\n`,
    "README.md": `# Final Package\n\n${common}\n\n## Files\n## Findings\n## Evidence\n`,
    "findings.json": JSON.stringify({ operationID, counts: {}, reportable: [], retained: [] }, null, 2) + "\n",
    "evidence-index.json": JSON.stringify({ operationID, evidence: [] }, null, 2) + "\n",
    "people-profiles.md": "# People Profiles\n\nNo person profiles were recorded.\n",
    "identity-graph.json": JSON.stringify({ operationID, nodes: [], edges: [] }, null, 2) + "\n",
    "operator-review.md": `# Operator Review\n\n${common}\n\n## Handoff State\n\nReady for review.\n\n## Review Before Client Delivery\n\nReview evidence and findings.\n`,
    "executive-summary.md": `# Executive Summary\n\n${common}\n\n## Overview\n\nSynthetic objective proof package.\n\n## Priority Items\n\nReview validated findings.\n`,
    "technical-appendix.md": `# Technical Appendix\n\n${common}\n\n## Scope And Methodology\n\nSynthetic readiness fixture.\n\n## Evidence Index\n\nSee evidence-index.json.\n`,
    "board-report.md": `# Board Report\n\n${common}\n\n## Executive Decision Summary\n\nSynthetic board package.\n\n## Recommended Board Actions\n\nTrack remediation owners.\n`,
    "ceh-technical-report.md": `# CEH Technical Report\n\n${common}\n\n## Scope And Methodology\n\nSynthetic technical package.\n\n## Validated Findings\n\nSee findings.json.\n\n## Evidence Map\n\nSee evidence-index.json.\n`,
    "ulm-team-report.md": `# ULMCode Team Report\n\n${common}\n\n## Harness Run State\n\nSynthetic package generated.\n\n## Residual Harness Risks\n\nNone in fixture.\n`,
    "runtime-summary.md": "# Runtime Summary\n\nSynthetic runtime summary.\n",
  }
  return byFile[file] ?? `${file}\n`
}

async function writePassingSelectedCanaryProof(operationID: string) {
  const root = path.join(repoRoot, ".ulmcode", "operations", `${operationID}-canary`)
  const finalDir = path.join(root, "deliverables", "final")
  await fs.mkdir(finalDir, { recursive: true })
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
  await writeJson(path.join(finalDir, "manifest.json"), {
    operationID: `${operationID}-canary`,
    generatedAt: "2026-05-09T11:59:00.000Z",
    artifacts,
  })
  for (const file of Object.values(artifacts)) {
    await fs.writeFile(path.join(finalDir, file), fixtureStakeholderArtifact(file, `${operationID}-canary`))
  }
  await writeJson(path.join(root, "deliverables", "operation-audit.json"), {
    operationID: `${operationID}-canary`,
    ok: true,
    blockers: [],
    generatedAt: "2026-05-09T12:00:00.000Z",
    checks: { finalHandoff: { ok: true, gates: {} } },
  })
  await writeJson(
    path.join(root, "scheduler", "literal-run-readiness.json"),
    {
      operationID: `${operationID}-canary`,
      status: "passed",
      targetElapsedSeconds: 120,
      literalElapsedSeconds: 120,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "final-package", status: "ok", required: true, detail: "missing_manifest_files=none; stakeholder_gaps=none" },
        { id: "final-operation-audit", status: "ok", required: true, detail: "audit ok" },
      ],
    },
  )
}

async function writePassingLiteral48hProof(root: string, operationID: string) {
  const finalDir = path.join(root, "deliverables", "final")
  await fs.mkdir(finalDir, { recursive: true })
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
  await writeJson(path.join(finalDir, "manifest.json"), {
    operationID,
    generatedAt: "2026-05-09T11:59:00.000Z",
    artifacts,
  })
  for (const file of Object.values(artifacts)) {
    await fs.writeFile(path.join(finalDir, file), fixtureStakeholderArtifact(file, operationID, 75))
  }
  await writeJson(path.join(root, "deliverables", "operation-audit.json"), {
    operationID,
    ok: true,
    blockers: [],
    generatedAt: "2026-05-09T12:00:00.000Z",
    checks: {
      finalHandoff: {
        ok: true,
        gates: { minOutlineTargetPages: 75, minPdfPages: 75 },
      },
    },
  })
  await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
    operationID,
    status: "passed",
    targetElapsedSeconds: 48 * 60 * 60,
    literalElapsedSeconds: 48 * 60 * 60,
    checks: [
      { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
      { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
      { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
      { id: "laptop-preflight-proof", status: "ok", required: true, detail: "preflight ok" },
      { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
      {
        id: "credential-handoff-proof",
        status: "ok",
        required: true,
        detail:
          "submitted_at=2026-05-09T11:55:00.000Z; credential_count=2; credential_before_daemon_start=true",
      },
      {
        id: "final-package",
        status: "ok",
        required: true,
        detail: "missing_manifest_artifacts=none; missing_manifest_files=none; stakeholder_gaps=none",
      },
      {
        id: "final-operation-audit",
        status: "ok",
        required: true,
        detail:
          "ok=true; blockers=0; fresh=true; final_handoff=proved; required_min_outline_target_pages=75; required_min_pdf_pages=75",
      },
    ],
  })
}

async function writePassingLiveBehaviorProbes(dir: string) {
  const scenarioIDs = [
    "k12-sso-roster-export-chain",
    "quick-network-resume-checkpoint",
    "privileged-dossier-attack-chain-report",
    "k12-exploit-chain-safety",
  ]
  for (const id of scenarioIDs) {
    const prefix = path.join(dir, `${id}-pass`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(`${prefix}.jsonl`, `{"type":"text","part":{"text":"${id} report_lint report_render operation_audit"}}\n`)
    await fs.writeFile(`${prefix}.prompt.txt`, `Behavior watch scenario: ${id}\n`)
    await writeJson(path.join(dir, `${id}-pass.json`), {
      ok: true,
      timedOut: false,
      exitCode: 0,
      transcript: `${prefix}.jsonl`,
      prompt: `${prefix}.prompt.txt`,
      result: { ok: true, scenarioID: id, findings: [] },
    })
  }
}

async function writePassingHarnessScorecards(dir: string) {
  const tiers = [
    { name: "chaos", requiredScenario: "provider-sse-repair-chaos" },
    { name: "full", requiredScenario: "synthetic-full-operation" },
    { name: "overnight", requiredScenario: "overnight-readiness-contract" },
  ]
  for (const tier of tiers) {
    const runDir = path.join(dir, `${tier.name}-pass`)
    await fs.mkdir(runDir, { recursive: true })
    await writeJson(path.join(runDir, "scorecard.json"), {
      ok: true,
      runID: `fixture-${tier.name}`,
      coverage: { failed: [], missing: [] },
      scenarios: [
        { id: tier.requiredScenario, tier: tier.name, status: "passed" },
        { id: "model-loop-contract", tier: "fast", status: "passed" },
      ],
    })
    await fs.writeFile(path.join(runDir, "scorecard.md"), `# ULM Harness\n\n${tier.requiredScenario}: passed\n`)
  }
}

describe("ULM first-run objective audit", () => {
  test("maps the launch prompt to concrete readiness evidence and keeps literal 48h proof separate", async () => {
    const result = await auditFirstRunObjective(repoRoot, {
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-first-run-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.map((check) => check.id)).toContain("school-laptop-48h-template")
    expect(result.checks.map((check) => check.id)).toContain("first-run-rehearsal")
    expect(result.checks.map((check) => check.id)).toContain("wall-clock-canary")
    expect(result.checks.map((check) => check.id)).toContain("first-run-launch-packet")
    expect(result.checks.map((check) => check.id)).toContain("selected-operation-launch-packet")
    expect(result.checks.map((check) => check.id)).toContain("behavior-probe")
    expect(result.checks.map((check) => check.id)).toContain("extended-harness-scorecards")
    expect(result.checks.map((check) => check.id)).toContain("final-report-fanout")
    expect(result.checks.map((check) => check.id)).toContain("literal-48h-proof")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.gaps.some((gap) => gap.includes("literal-48h-proof"))).toBe(true)
    expect(await fs.readFile(result.files.markdown, "utf8")).toContain("Prompt-to-Artifact Checklist")
  })

  test("does not accept a forged 48h readiness status without required underlying checks", async () => {
    const operationID = "forged-proof"
    const auditPath = path.join(repoRoot, ".ulmcode", "operations", operationID, "scheduler", "literal-run-readiness.json")
    await writeJson(auditPath, {
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-forged-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain("missing_ok_checks")
  })

  test("accepts selected-operation 48h proof only when the readiness audit contains the required ok checks", async () => {
    const operationID = "proved-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-proved-objective-live-probes")
    const harnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-proved-objective-harness")
    await fs.rm(harnessScorecardDir, { recursive: true, force: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)
    await writePassingHarnessScorecards(harnessScorecardDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      harnessScorecardDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-proved-objective-audit"),
    })

    expect(result.status).toBe("ready")
    expect(result.launchDecision).toMatchObject({
      status: "complete",
      canStartDaemon: false,
      canClaimObjectiveComplete: true,
      nextActionId: "objective-ready",
      blockerActionIds: [],
    })
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("covered")
    expect(result.checks.find((check) => check.id === "selected-operation-canary-proof")?.status).toBe("covered")
    expect(result.checks.find((check) => check.id === "extended-harness-scorecards")?.status).toBe("covered")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("covered")
  })

  test("does not accept selected 48h proof without fresh chaos, full, and overnight harness scorecards", async () => {
    const operationID = "missing-extended-harness-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-harness-live-probes")
    const harnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-harness-scorecards")
    await fs.rm(harnessScorecardDir, { recursive: true, force: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      harnessScorecardDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-harness-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "extended-harness-scorecards")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "extended-harness-scorecards")?.detail).toContain(
      "missing_tiers=chaos,full,overnight",
    )
  })

  test("does not let one overnight harness scorecard stand in for separate chaos and full scorecards", async () => {
    const operationID = "collapsed-harness-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-collapsed-harness-live-probes")
    const harnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-collapsed-harness-scorecards")
    await fs.rm(harnessScorecardDir, { recursive: true, force: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)
    const runDir = path.join(harnessScorecardDir, "overnight-only")
    await fs.mkdir(runDir, { recursive: true })
    await writeJson(path.join(runDir, "scorecard.json"), {
      ok: true,
      scenarios: [
        { id: "provider-sse-repair-chaos", tier: "chaos", status: "passed" },
        { id: "synthetic-full-operation", tier: "full", status: "passed" },
        { id: "overnight-readiness-contract", tier: "overnight", status: "passed" },
      ],
    })
    await fs.writeFile(
      path.join(runDir, "scorecard.md"),
      "provider-sse-repair-chaos synthetic-full-operation overnight-readiness-contract\n",
    )

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      harnessScorecardDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-collapsed-harness-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "extended-harness-scorecards")?.detail).toContain(
      "missing_tiers=chaos,full",
    )
  })

  test("does not accept extended harness scorecards older than launch readiness sources", async () => {
    const operationID = "stale-extended-harness-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-harness-live-probes")
    const harnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-harness-scorecards")
    await fs.rm(harnessScorecardDir, { recursive: true, force: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)
    await writePassingHarnessScorecards(harnessScorecardDir)

    const old = new Date("2000-01-01T00:00:00.000Z")
    for (const tier of ["chaos", "full", "overnight"]) {
      await fs.utimes(path.join(harnessScorecardDir, `${tier}-pass`, "scorecard.json"), old, old)
    }

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      harnessScorecardDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-harness-objective-audit"),
    })

    const check = result.checks.find((item) => item.id === "extended-harness-scorecards")
    expect(result.status).toBe("incomplete")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_tiers=chaos,full,overnight")
    expect(check?.detail).toContain("stale_sources=chaos,full,overnight")
  })

  test("does not accept selected 48h proof without a passing selected credential review gate", async () => {
    const operationID = "missing-credential-review-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-credential-review-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-credential-review-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.gaps.some((gap) => gap.includes("selected-operation-credential-review"))).toBe(true)
  })

  test("writes operator next actions for launch blockers", async () => {
    const operationID = "missing-credential-review-next-actions"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const outputDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-next-actions-objective-audit")
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-next-actions-live-probes")
    const harnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-next-actions-scorecards")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.credentialTargets = ["genesis", "google", "clever"]
    await writeJson(planPath, plan)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.credentialRequirements.expectedServices = ["genesis", "google", "clever"]
    packet.requiredBeforeLaunch = packet.requiredBeforeLaunch.map((item: { id?: string; detail?: string }) =>
      item.id === "credential-review"
        ? { ...item, detail: "Genesis, Google, and Clever credentials are stored through the vault with redacted indexes only." }
        : item,
    )
    await writeJson(packetPath, packet)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)
    await writePassingHarnessScorecards(harnessScorecardDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      harnessScorecardDir,
      outputDir,
    })

    expect(result.files.nextActionsJson).toBe(path.join(outputDir, "first-run-next-actions.json"))
    expect(result.files.nextActionsMarkdown).toBe(path.join(outputDir, "first-run-next-actions.md"))
    expect(result.files.operationJson).toBe(path.join(root, "scheduler", "first-run-objective-audit.json"))
    expect(result.files.operationMarkdown).toBe(path.join(root, "scheduler", "first-run-objective-audit.md"))
    expect(result.files.operationNextActionsJson).toBe(path.join(root, "scheduler", "first-run-next-actions.json"))
    expect(result.files.operationNextActionsMarkdown).toBe(path.join(root, "scheduler", "first-run-next-actions.md"))
    expect(result.nextActions.map((action) => action.id)).toEqual([
      "submit-credential-vault",
      "run-laptop-preflight",
      "run-literal-target-hours",
    ])
    expect(result.nextActions.find((action) => action.id === "submit-credential-vault")?.commands).toContain(
      `operation_credentials action=open_vault operationID=${operationID}`,
    )
    expect(result.nextActions.find((action) => action.id === "submit-credential-vault")?.reason).toContain(
      "Genesis, Google, and Clever credential services are expected",
    )
    expect(result.nextActions.find((action) => action.id === "submit-credential-vault")?.links).toEqual([
      `/ulm/credentials?operationID=${operationID}`,
    ])
    expect(result.nextActions.find((action) => action.id === "submit-credential-vault")?.commands).toContain(
      `open the local ULMCode vault route: /ulm/credentials?operationID=${operationID}`,
    )
    expect(result.nextActions.find((action) => action.id === "run-laptop-preflight")?.status).toBe("blocked")
    expect(result.nextActions.find((action) => action.id === "run-laptop-preflight")?.blockedBy).toEqual([
      "submit-credential-vault",
    ])
    expect(result.nextActions.find((action) => action.id === "run-literal-target-hours")?.status).toBe("blocked")
    expect(result.nextActions.find((action) => action.id === "run-literal-target-hours")?.blockedBy).toEqual([
      "submit-credential-vault",
      "run-laptop-preflight",
    ])
    expect(result.launchDecision).toMatchObject({
      status: "blocked",
      canStartDaemon: false,
      canClaimObjectiveComplete: false,
      nextActionId: "submit-credential-vault",
      blockerActionIds: ["submit-credential-vault", "run-laptop-preflight", "run-literal-target-hours"],
    })
    expect(result.objectiveMatrix.find((item) => item.id === "selected-real-run-proof")?.nextActionIds).toEqual([
      "submit-credential-vault",
      "run-laptop-preflight",
      "run-literal-target-hours",
    ])
    expect(result.objectiveMatrix.find((item) => item.id === "school-surface-private-wifi-launch")?.nextActionIds).toEqual([
      "submit-credential-vault",
      "run-laptop-preflight",
    ])
    const written = JSON.parse(await fs.readFile(result.files.nextActionsJson, "utf8"))
    expect(written.map((action: { id: string }) => action.id)).toEqual(result.nextActions.map((action) => action.id))
    expect(await fs.readFile(result.files.nextActionsMarkdown, "utf8")).toContain("Submit the credential vault review")
    expect(await fs.readFile(result.files.nextActionsMarkdown, "utf8")).toContain("Blocked by:")
    expect(await fs.readFile(result.files.nextActionsMarkdown, "utf8")).toContain("submit-credential-vault")
    expect(await fs.readFile(result.files.nextActionsMarkdown, "utf8")).toContain(
      `/ulm/credentials?operationID=${operationID}`,
    )
    expect(await fs.readFile(result.files.operationNextActionsMarkdown!, "utf8")).toContain(
      `/ulm/credentials?operationID=${operationID}`,
    )
    expect(JSON.parse(await fs.readFile(result.files.operationJson!, "utf8")).files.operationNextActionsMarkdown).toBe(
      result.files.operationNextActionsMarkdown,
    )
  })

  test("writes an explicit objective requirement matrix beside check-level evidence", async () => {
    const operationID = "objective-matrix-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const outputDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-objective-matrix-audit")
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-objective-matrix-live-probes")
    const harnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-objective-matrix-scorecards")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)
    await writePassingHarnessScorecards(harnessScorecardDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      harnessScorecardDir,
      outputDir,
    })

    expect(result.objectiveMatrix.map((item) => item.id)).toEqual([
      "school-surface-private-wifi-launch",
      "authorized-service-credential-handoff",
      "two-day-unattended-runtime",
      "multi-angle-attack-modeling",
      "professional-role-dossiers",
      "exploit-chain-synthesis",
      "continuous-behavior-observation",
      "protected-hour-45-finalization",
      "specialized-subreport-fanout",
      "massive-modern-final-report-package",
      "selected-real-run-proof",
    ])
    expect(result.objectiveMatrix.find((item) => item.id === "selected-real-run-proof")?.status).toBe("missing")
    expect(result.objectiveMatrix.find((item) => item.id === "selected-real-run-proof")?.mappedChecks).toContain("literal-48h-proof")
    expect(result.objectiveMatrix.find((item) => item.id === "selected-real-run-proof")?.nextActionIds).toEqual([
      "run-literal-target-hours",
    ])
    expect(result.launchDecision).toMatchObject({
      status: "ready-to-launch",
      canStartDaemon: true,
      canClaimObjectiveComplete: false,
      nextActionId: "run-literal-target-hours",
      blockerActionIds: [],
    })
    expect(result.objectiveMatrix.find((item) => item.id === "school-surface-private-wifi-launch")?.nextActionIds).toEqual([])
    expect(result.objectiveMatrix.find((item) => item.id === "professional-role-dossiers")?.requirement).toContain(
      "professional people",
    )
    expect(result.objectiveMatrix.find((item) => item.id === "professional-role-dossiers")?.detail).toContain(
      "private-life dossier material stays out of scope",
    )
    expect(result.objectiveMatrix.find((item) => item.id === "continuous-behavior-observation")?.nextActionIds).toEqual([])
    const written = JSON.parse(await fs.readFile(result.files.json, "utf8"))
    expect(written.launchDecision.status).toBe("ready-to-launch")
    expect(written.launchDecision.canStartDaemon).toBe(true)
    expect(written.objectiveMatrix.map((item: { id: string }) => item.id)).toEqual(
      result.objectiveMatrix.map((item) => item.id),
    )
    const markdown = await fs.readFile(result.files.markdown, "utf8")
    expect(markdown).toContain("## Launch Decision")
    expect(markdown).toContain("- can_start_daemon: true")
    expect(markdown).toContain("## Objective Completion Matrix")
    expect(markdown).toContain("school-surface-private-wifi-launch")
    expect(markdown).toContain("run-literal-target-hours")
    expect(markdown).toContain("massive-modern-final-report-package")
    expect(markdown).toContain("selected-real-run-proof")
  })

  test("operator script can require launch-ready state before the daemon starts", async () => {
    const operationID = "script-launch-ready-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-script-launch-ready-live-probes")
    const harnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-script-launch-ready-scorecards")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)
    await writePassingHarnessScorecards(harnessScorecardDir)

    const ready = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-first-run-objective-audit.ts"),
        "--operation-id",
        operationID,
        "--output-dir",
        path.join(repoRoot, "packages", "opencode", ".artifacts", "test-script-launch-ready-audit"),
        "--require-launch-ready",
        "--json",
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [readyStdout, readyStderr, readyExit] = await Promise.all([
      new Response(ready.stdout).text(),
      new Response(ready.stderr).text(),
      ready.exited,
    ])
    expect(readyExit).toBe(0)
    expect(readyStderr).toBe("")
    expect(JSON.parse(readyStdout).launchDecision).toMatchObject({
      status: "ready-to-launch",
      canStartDaemon: true,
      canClaimObjectiveComplete: false,
    })

    const blockedOperationID = "script-launch-blocked-proof"
    const blockedRoot = path.join(repoRoot, ".ulmcode", "operations", blockedOperationID)
    const blockedBehaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-script-launch-blocked-live-probes")
    const blockedHarnessScorecardDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-script-launch-blocked-scorecards")
    await writeSchoolLaptopPlan(blockedRoot, blockedOperationID)
    await writePassingLaunchPacket(blockedRoot, blockedOperationID)
    await writePassingSelectedCanaryProof(blockedOperationID)
    await writePassingLiveBehaviorProbes(blockedBehaviorProbeDir)
    await writePassingHarnessScorecards(blockedHarnessScorecardDir)

    const blocked = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-first-run-objective-audit.ts"),
        "--operation-id",
        blockedOperationID,
        "--output-dir",
        path.join(repoRoot, "packages", "opencode", ".artifacts", "test-script-launch-blocked-audit"),
        "--require-launch-ready",
        "--json",
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [blockedStdout, blockedStderr, blockedExit] = await Promise.all([
      new Response(blocked.stdout).text(),
      new Response(blocked.stderr).text(),
      blocked.exited,
    ])
    expect(blockedExit).toBe(1)
    expect(blockedStderr).toBe("")
    expect(JSON.parse(blockedStdout).launchDecision).toMatchObject({
      status: "blocked",
      canStartDaemon: false,
      nextActionId: "submit-credential-vault",
    })
  })

  test("does not accept a selected school laptop plan without explicit credential targets", async () => {
    const operationID = "missing-plan-credential-targets-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    delete plan.credentialTargets
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-plan-credential-targets"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-template")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-template")?.detail).toContain(
      "missing_credential_targets=genesis,google",
    )
    expect(result.nextActions.find((action) => action.id === "repair-selected-operation-plan")?.commands).toContain(
      `bun run --cwd packages/opencode ulm:first-run-launch-packet ${operationID} --force --strict --json`,
    )
    expect(result.objectiveMatrix.find((item) => item.id === "selected-real-run-proof")?.nextActionIds).toContain(
      "repair-selected-operation-plan",
    )
  })

  test("does not accept selected school laptop plan credential targets that are noncanonical or duplicated", async () => {
    const operationID = "noncanonical-plan-credential-targets-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.credentialTargets = ["genesis", "Google", "google", " clever "]
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-noncanonical-plan-credential-targets"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-template")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("credential_target_gaps=noncanonical:Google,duplicate:google,noncanonical: clever ")
  })

  test("does not accept a selected school laptop plan without explicit scope rules", async () => {
    const operationID = "missing-plan-scope-rules-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    delete plan.scopeRules
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-plan-scope-rules"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-template")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-template")?.detail).toContain(
      "scope_rules=missing",
    )
  })

  test("does not accept selected school laptop scope rules that are blank, padded, or duplicated", async () => {
    const operationID = "noncanonical-plan-scope-rules-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    const duplicateRule = "Only test assets and services explicitly authorized for this school laptop operation."
    plan.scopeRules = [
      duplicateRule,
      duplicateRule,
      "Stay non-destructive unless the operator records separate written approval.",
      "Person and account research must stay limited to role, authorization, identity, and workflow risk; exclude private-life dossier material.",
      "  ",
      " Extra operator rule with padding. ",
    ]
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-noncanonical-plan-scope-rules"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-template")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("scope_rule_gaps=duplicate,blank,noncanonical,noncanonical")
  })

  test("does not accept a selected school laptop plan without baseline scope rules", async () => {
    const operationID = "weak-plan-scope-baselines-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.scopeRules = ["Only run this assessment during the approved two-day laptop window."]
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-weak-plan-scope-baselines"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-template")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_scope_baselines=authorized-assets,non-destructive")
  })

  test("does not accept a selected school laptop plan without role-focused identity research boundaries", async () => {
    const operationID = "weak-plan-identity-boundary-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.scopeRules = plan.scopeRules.filter((rule: string) => !rule.includes("Person and account research"))
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-weak-plan-identity-boundary"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-template")
    expect(result.status).toBe("incomplete")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_scope_baselines=identity-boundary")
  })

  test("does not accept selected school laptop preflight without person and identity graph lanes", async () => {
    const operationID = "missing-identity-lanes-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "plans", "operation-graph.json"), {
      operationID,
      safetyMode: "non_destructive",
      lanes: [{ id: "recon" }, { id: "web_inventory" }],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-identity-lanes"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-preflight")
    expect(result.status).toBe("incomplete")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("underlying_preflight_gaps=operation-graph-identity-lanes")
  })

  test("does not accept a forged selected credential review without the underlying vault review", async () => {
    const operationID = "forged-credential-review-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-forged-credential-review-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await fs.rm(path.join(root, "credentials", "review-submission.json"), { force: true })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-forged-credential-review-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "underlying_submitted=false",
    )
  })

  test("does not accept a selected credential review whose underlying vault review contains raw secrets", async () => {
    const operationID = "raw-secret-credential-review-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-raw-secret-credential-review-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
      operatorNotes: "password: real-school-account-password",
      file: path.join(root, "credentials", "review-submission.json"),
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-raw-secret-credential-review-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "underlying_raw_secrets=true",
    )
  })

  test("does not accept a stale selected credential review when the vault submission is newer than the review", async () => {
    const operationID = "stale-credential-review-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-credential-review-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
      file: path.join(root, "credentials", "review-submission.json"),
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-credential-review-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "underlying_after_review=true",
    )
  })

  test("does not accept a selected credential review when the underlying vault credential count changed", async () => {
    const operationID = "changed-credential-count-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-changed-credential-count-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentials: [
        { credentialID: "genesis-test", label: "Genesis test account", password: "********" },
        { credentialID: "google-test", label: "Google test account", password: "********" },
        { credentialID: "sis-test", label: "SIS test account", password: "********" },
      ],
      file: path.join(root, "credentials", "review-submission.json"),
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-changed-credential-count-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "underlying_credential_count=3",
    )
  })

  test("does not accept a selected credential review missing plan-named service coverage", async () => {
    const operationID = "missing-credential-service-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-credential-service-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID,
      templateName: "school-laptop-48h",
      timeBudget: { targetHours: 48, finalizationWindowHours: 4 },
      access: "Use submitted test credentials for authenticated Genesis and Google Workspace checks.",
    })
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
      file: path.join(root, "credentials", "review-submission.json"),
    })
    await writeJson(path.join(root, "scheduler", "credential-review.json"), {
      operationID,
      status: "ready",
      checkedAt: "2026-05-09T12:00:00.000Z",
      credentialsRequired: true,
      submitted: true,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentialCount: 1,
      gaps: [],
      files: {
        json: path.join(root, "scheduler", "credential-review.json"),
        markdown: path.join(root, "scheduler", "credential-review.md"),
        review: path.join(root, "credentials", "review-submission.json"),
      },
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-credential-service-audit"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-credential-review")
    expect(result.status).toBe("incomplete")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("underlying_missing_services=google")
  })

  test("does not accept a selected credential review whose summary has no valid checked timestamp", async () => {
    const operationID = "missing-credential-review-check-time-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(
      repoRoot,
      "packages",
      "opencode",
      ".artifacts",
      "test-missing-credential-review-check-time-probes",
    )
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "scheduler", "credential-review.json"), {
      operationID,
      status: "ready",
      credentialsRequired: true,
      submitted: true,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentialCount: 1,
      gaps: [],
      files: {
        json: path.join(root, "scheduler", "credential-review.json"),
        markdown: path.join(root, "scheduler", "credential-review.md"),
        review: path.join(root, "credentials", "review-submission.json"),
      },
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-credential-check-time-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "review_checked_at_valid=false",
    )
  })

  test("does not accept a selected credential review whose submitted timestamp mismatches the vault review", async () => {
    const operationID = "mismatched-credential-review-submission-time-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-mismatched-credential-time-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "scheduler", "credential-review.json"), {
      operationID,
      status: "ready",
      checkedAt: "2026-05-09T12:00:00.000Z",
      credentialsRequired: true,
      submitted: true,
      submittedAt: "2026-05-09T11:54:00.000Z",
      credentialCount: 1,
      gaps: [],
      files: {
        json: path.join(root, "scheduler", "credential-review.json"),
        markdown: path.join(root, "scheduler", "credential-review.md"),
        review: path.join(root, "credentials", "review-submission.json"),
      },
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-mismatched-credential-time-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "submitted_at_matches=false",
    )
  })

  test("does not accept a selected credential review that points at a noncanonical vault review path", async () => {
    const operationID = "external-credential-review-path-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const externalReviewPath = path.join(
      repoRoot,
      "packages",
      "opencode",
      ".artifacts",
      "test-external-credential-review-path",
      "review-submission.json",
    )
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-external-credential-path-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(externalReviewPath, {
      operationID,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
      file: externalReviewPath,
    })
    await writeJson(path.join(root, "scheduler", "credential-review.json"), {
      operationID,
      status: "ready",
      checkedAt: "2026-05-09T12:00:00.000Z",
      credentialsRequired: true,
      submitted: true,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentialCount: 1,
      gaps: [],
      files: {
        json: path.join(root, "scheduler", "credential-review.json"),
        markdown: path.join(root, "scheduler", "credential-review.md"),
        review: externalReviewPath,
      },
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-external-credential-path-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "review_path_canonical=false",
    )
  })

  test("does not accept a selected credential review whose vault review file self-reference is noncanonical", async () => {
    const operationID = "external-credential-review-self-path-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const externalReviewPath = path.join(
      repoRoot,
      "packages",
      "opencode",
      ".artifacts",
      "test-external-credential-review-self-path",
      "review-submission.json",
    )
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-external-credential-self-path-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
      file: externalReviewPath,
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-external-credential-self-path-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "underlying_file_canonical=false",
    )
  })

  test("does not accept a selected credential review whose vault credential index is malformed", async () => {
    const operationID = "malformed-credential-index-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-malformed-credential-index-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentials: [
        { credentialID: "genesis-test", label: "Genesis test account", password: "********" },
        { credentialID: "genesis-test", label: "Genesis second account", password: "********" },
      ],
      file: path.join(root, "credentials", "review-submission.json"),
    })
    await writeJson(path.join(root, "scheduler", "credential-review.json"), {
      operationID,
      status: "ready",
      checkedAt: "2026-05-09T12:00:00.000Z",
      credentialsRequired: true,
      submitted: true,
      submittedAt: "2026-05-09T11:55:00.000Z",
      credentialCount: 2,
      gaps: [],
      files: {
        json: path.join(root, "scheduler", "credential-review.json"),
        markdown: path.join(root, "scheduler", "credential-review.md"),
        review: path.join(root, "credentials", "review-submission.json"),
      },
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-malformed-credential-index-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "underlying_index_gaps=credential review index has duplicate credential id: genesis-test",
    )
  })

  test("does not accept a selected credential review whose vault review has an invalid submitted timestamp", async () => {
    const operationID = "invalid-credential-submitted-at-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-invalid-credential-submitted-at-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "later",
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
      file: path.join(root, "credentials", "review-submission.json"),
    })
    await writeJson(path.join(root, "scheduler", "credential-review.json"), {
      operationID,
      status: "ready",
      checkedAt: "2026-05-09T12:00:00.000Z",
      credentialsRequired: true,
      submitted: true,
      submittedAt: "later",
      credentialCount: 1,
      gaps: [],
      files: {
        json: path.join(root, "scheduler", "credential-review.json"),
        markdown: path.join(root, "scheduler", "credential-review.md"),
        review: path.join(root, "credentials", "review-submission.json"),
      },
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingSelectedCanaryProof(operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-invalid-credential-submitted-at-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-credential-review")?.detail).toContain(
      "underlying_submitted_at_valid=false",
    )
  })

  test("does not accept selected 48h proof without a real selected wall-clock canary", async () => {
    const operationID = "missing-canary-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-canary-live-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-canary-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-canary-proof")?.status).toBe("missing")
    expect(result.gaps.some((gap) => gap.includes("selected-operation-canary-proof"))).toBe(true)
  })

  test("does not accept selected canary proof without underlying final package and audit artifacts", async () => {
    const operationID = "missing-canary-final-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const canaryRoot = path.join(repoRoot, ".ulmcode", "operations", `${operationID}-canary`)
    await writeSchoolLaptopPlan(root, operationID)
    await writeJson(path.join(canaryRoot, "scheduler", "literal-run-readiness.json"), {
      operationID: `${operationID}-canary`,
      status: "passed",
      targetElapsedSeconds: 120,
      literalElapsedSeconds: 120,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "final-package", status: "ok", required: true, detail: "missing_manifest_files=none" },
        { id: "final-operation-audit", status: "ok", required: true, detail: "audit ok" },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-canary-final-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-canary-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-canary-proof")?.detail).toContain(
      "underlying_final_package_gaps=final-manifest:missing",
    )
    expect(result.checks.find((check) => check.id === "selected-operation-canary-proof")?.detail).toContain(
      "underlying_final_audit_gaps=final-audit:missing",
    )
  })

  test("does not accept selected 48h proof without a real launch packet", async () => {
    const operationID = "missing-launch-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-launch-packet-live-probes")
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-launch-packet-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-launch-packet")?.status).toBe("missing")
    expect(result.gaps.some((gap) => gap.includes("selected-operation-launch-packet"))).toBe(true)
  })

  test("does not accept a launch packet bound to another operation root", async () => {
    const operationID = "wrong-root-launch-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.files.operationRoot = path.join(repoRoot, ".ulmcode", "operations", "other-school-laptop-run")
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-wrong-root-launch-packet-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-launch-packet")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-launch-packet")?.detail).toContain(
      "operation_root_matches=false",
    )
  })

  test("accepts selected launch packet commands that match a longer plan time budget", async () => {
    const operationID = "longer-target-launch-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.timeBudget.targetHours = 72
    await writeJson(planPath, plan)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.targetHours = 72
    packet.commands.daemon48h = `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 72 --detach --json`
    packet.commands.supervisor = `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 72 --supervisor all --json`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-longer-target-launch-packet"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("covered")
    expect(check?.detail).toContain("expected_target_hours=72")
    expect(check?.detail).toContain("target_hours_matches=true")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(result.nextActions.find((action) => action.id === "run-literal-target-hours")?.title).toContain("72-hour")
    expect(result.nextActions.find((action) => action.id === "run-literal-target-hours")?.commands).toContain(
      `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 72 --detach --json`,
    )
  })

  test("does not accept selected launch packet daemon commands that undershoot the plan time budget", async () => {
    const operationID = "short-daemon-launch-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.timeBudget.targetHours = 72
    await writeJson(planPath, plan)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.targetHours = 72
    packet.commands.daemon48h = `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID} --duration-hours 48 --detach --json`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-short-daemon-launch-packet"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("expected_target_hours=72")
    expect(check?.detail).toContain("missing_command_terms=--duration-hours 72")
    expect(check?.detail).toContain("command_gaps=daemon48h:exact-operation-duration-command")
  })

  test("does not accept selected launch packets whose credential vault commands point at a suffix-mismatched operation id", async () => {
    const operationID = "suffix-mismatch-packet-credential-vault-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    const copiedOperationID = `${operationID}-copy`
    packet.commands.credentialVaultPath = `/ulm/credentials?operationID=${copiedOperationID}`
    packet.commands.openCredentialVault = `operation_credentials action=open_vault operationID=${copiedOperationID}`
    packet.credentialRequirements.vaultPath = packet.commands.credentialVaultPath
    packet.credentialRequirements.openVaultCommand = packet.commands.openCredentialVault
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-suffix-mismatch-packet-credential-vault"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain(
      "command_gaps=credentialVaultPath:exact-operation-path,openCredentialVault:exact-operation-command",
    )
    expect(check?.detail).toContain("credential_requirements=required=true")
  })

  test("does not accept selected launch packets whose credential vault open command is wrapped", async () => {
    const operationID = "wrapped-packet-credential-vault-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.commands.openCredentialVault = `echo operation_credentials action=open_vault operationID=${operationID}`
    packet.credentialRequirements.openVaultCommand = packet.commands.openCredentialVault
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-wrapped-packet-credential-vault"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=openCredentialVault:exact-operation-command")
    expect(check?.detail).toContain(
      "credential_requirements=required=true; expected=genesis,google; missing=none; unexpected=none; gaps=none; command_gaps=openVaultCommand:exact-operation-command",
    )
  })

  test("does not accept selected launch packets whose structured credential review command is weak", async () => {
    const operationID = "weak-packet-credential-requirement-command-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.credentialRequirements.reviewCommand = `echo ${operationID} --strict --json`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-weak-packet-credential-requirement-command"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=none")
    expect(check?.detail).toContain(
      "credential_requirements=required=true; expected=genesis,google; missing=none; unexpected=none; gaps=none; command_gaps=reviewCommand:exact-operation-command,packetCommandMirror:matches-packet-commands",
    )
  })

  test("does not accept selected launch packet package-script commands when they are wrapped", async () => {
    const cases: Array<{ command: string; gap: string }> = [
      { command: "credentialReview", gap: "credentialReview:exact-operation-command" },
      { command: "canary", gap: "canary:exact-operation-canary-command" },
      { command: "preflight", gap: "preflight:exact-operation-command" },
      { command: "daemon48h", gap: "daemon48h:exact-operation-duration-command" },
      { command: "supervisor", gap: "supervisor:exact-operation-supervisor-command" },
      { command: "readiness", gap: "readiness:exact-operation-command" },
      { command: "objectiveAudit", gap: "objectiveAudit:exact-operation-command" },
      { command: "launchReadiness", gap: "launchReadiness:exact-operation-readiness-command" },
    ]

    for (const item of cases) {
      const operationID = `wrapped-packet-${item.command.toLowerCase()}-proof`
      const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
      await writeSchoolLaptopPlan(root, operationID)
      await writePassingLaunchPacket(root, operationID)
      const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
      const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
      packet.commands[item.command] = `echo ${packet.commands[item.command]}`
      if (item.command === "credentialReview") packet.credentialRequirements.reviewCommand = packet.commands[item.command]
      await writeJson(packetPath, packet)

      const result = await auditFirstRunObjective(repoRoot, {
        operationID,
        outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", `test-wrapped-packet-${item.command}`),
      })

      const check = result.checks.find((check) => check.id === "selected-operation-launch-packet")
      expect(check?.status).toBe("missing")
      expect(check?.detail).toContain("missing_command_terms=none")
      expect(check?.detail).toContain(`command_gaps=${item.gap}`)
    }
  })

  test("does not accept selected launch packet positional commands that smuggle the operation id later", async () => {
    const cases: Array<{ command: string; script: string; expectedArg: string; gap: string }> = [
      { command: "credentialReview", script: "ulm:credential-review", expectedArg: "operation", gap: "credentialReview:exact-operation-command" },
      { command: "canary", script: "ulm:wall-clock-canary", expectedArg: "canary", gap: "canary:exact-operation-canary-command" },
      { command: "preflight", script: "ulm:laptop-preflight", expectedArg: "operation", gap: "preflight:exact-operation-command" },
      { command: "daemon48h", script: "ulm:runtime-daemon", expectedArg: "operation", gap: "daemon48h:exact-operation-duration-command" },
      { command: "supervisor", script: "ulm:runtime-daemon", expectedArg: "operation", gap: "supervisor:exact-operation-supervisor-command" },
      { command: "readiness", script: "ulm:literal-run-readiness", expectedArg: "operation", gap: "readiness:exact-operation-command" },
    ]

    for (const item of cases) {
      const operationID = `smuggled-packet-${item.command.toLowerCase()}-proof`
      const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
      await writeSchoolLaptopPlan(root, operationID)
      await writePassingLaunchPacket(root, operationID)
      const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
      const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
      const expectedOperationID = item.expectedArg === "canary" ? `${operationID}-canary` : operationID
      packet.commands[item.command] = packet.commands[item.command].replace(
        `${item.script} ${expectedOperationID}`,
        `${item.script} ${expectedOperationID}-copy --note ${expectedOperationID}`,
      )
      if (item.command === "credentialReview") packet.credentialRequirements.reviewCommand = packet.commands[item.command]
      await writeJson(packetPath, packet)

      const result = await auditFirstRunObjective(repoRoot, {
        operationID,
        outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", `test-smuggled-packet-${item.command}`),
      })

      const check = result.checks.find((check) => check.id === "selected-operation-launch-packet")
      expect(check?.status).toBe("missing")
      expect(check?.detail).toContain("missing_command_terms=none")
      expect(check?.detail).toContain(`command_gaps=${item.gap}`)
    }
  })

  test("does not accept selected launch packet commands that chain extra shell work", async () => {
    const cases: Array<{ command: string; gap: string }> = [
      { command: "openCredentialVault", gap: "openCredentialVault:exact-operation-command" },
      { command: "credentialReview", gap: "credentialReview:exact-operation-command" },
      { command: "canary", gap: "canary:exact-operation-canary-command" },
      { command: "preflight", gap: "preflight:exact-operation-command" },
      { command: "daemon48h", gap: "daemon48h:exact-operation-duration-command" },
      { command: "supervisor", gap: "supervisor:exact-operation-supervisor-command" },
      { command: "readiness", gap: "readiness:exact-operation-command" },
      { command: "objectiveAudit", gap: "objectiveAudit:exact-operation-command" },
      { command: "launchReadiness", gap: "launchReadiness:exact-operation-readiness-command" },
    ]

    for (const item of cases) {
      const operationID = `chained-packet-${item.command.toLowerCase()}-proof`
      const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
      await writeSchoolLaptopPlan(root, operationID)
      await writePassingLaunchPacket(root, operationID)
      const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
      const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
      packet.commands[item.command] = `${packet.commands[item.command]} && echo unexpected`
      if (item.command === "openCredentialVault") packet.credentialRequirements.openVaultCommand = packet.commands[item.command]
      if (item.command === "credentialReview") packet.credentialRequirements.reviewCommand = packet.commands[item.command]
      await writeJson(packetPath, packet)

      const result = await auditFirstRunObjective(repoRoot, {
        operationID,
        outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", `test-chained-packet-${item.command}`),
      })

      const check = result.checks.find((check) => check.id === "selected-operation-launch-packet")
      expect(check?.status).toBe("missing")
      expect(check?.detail).toContain(`command_gaps=${item.gap}`)
    }
  })

  test("does not accept selected launch packet commands with ambiguous duplicate args", async () => {
    const cases: Array<{ command: string; mutate: (packet: any, operationID: string) => void; gap: string }> = [
      {
        command: "openCredentialVault",
        mutate: (packet) => {
          packet.commands.openCredentialVault = `${packet.commands.openCredentialVault} operationID=other-run`
          packet.credentialRequirements.openVaultCommand = packet.commands.openCredentialVault
        },
        gap: "openCredentialVault:exact-operation-command",
      },
      {
        command: "canary",
        mutate: (packet) => {
          packet.commands.canary = `${packet.commands.canary} --target-seconds 999`
        },
        gap: "canary:exact-operation-canary-command",
      },
      {
        command: "preflight",
        mutate: (packet) => {
          packet.commands.preflight = `${packet.commands.preflight} --confirm unexpected`
        },
        gap: "preflight:exact-operation-command",
      },
      {
        command: "daemon48h",
        mutate: (packet) => {
          packet.commands.daemon48h = `${packet.commands.daemon48h} --duration-hours 12`
        },
        gap: "daemon48h:exact-operation-duration-command",
      },
      {
        command: "supervisor",
        mutate: (packet) => {
          packet.commands.supervisor = `${packet.commands.supervisor} --supervisor one`
        },
        gap: "supervisor:exact-operation-supervisor-command",
      },
      {
        command: "objectiveAudit",
        mutate: (packet) => {
          packet.commands.objectiveAudit = `${packet.commands.objectiveAudit} --operation-id other-run`
        },
        gap: "objectiveAudit:exact-operation-command",
      },
      {
        command: "launchReadiness",
        mutate: (packet) => {
          packet.commands.launchReadiness = `${packet.commands.launchReadiness} --operation-id other-run`
        },
        gap: "launchReadiness:exact-operation-readiness-command",
      },
    ]

    for (const item of cases) {
      const operationID = `ambiguous-packet-${item.command.toLowerCase()}-proof`
      const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
      await writeSchoolLaptopPlan(root, operationID)
      await writePassingLaunchPacket(root, operationID)
      const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
      const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
      item.mutate(packet, operationID)
      await writeJson(packetPath, packet)

      const result = await auditFirstRunObjective(repoRoot, {
        operationID,
        outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", `test-ambiguous-packet-${item.command}`),
      })

      const check = result.checks.find((check) => check.id === "selected-operation-launch-packet")
      expect(check?.status).toBe("missing")
      expect(check?.detail).toContain("missing_command_terms=none")
      expect(check?.detail).toContain(`command_gaps=${item.gap}`)
    }
  })

  test("does not accept selected launch packet commands with extra unknown tokens", async () => {
    const cases: Array<{ command: string; gap: string }> = [
      { command: "openCredentialVault", gap: "openCredentialVault:exact-operation-command" },
      { command: "credentialReview", gap: "credentialReview:exact-operation-command" },
      { command: "canary", gap: "canary:exact-operation-canary-command" },
      { command: "preflight", gap: "preflight:exact-operation-command" },
      { command: "daemon48h", gap: "daemon48h:exact-operation-duration-command" },
      { command: "supervisor", gap: "supervisor:exact-operation-supervisor-command" },
      { command: "readiness", gap: "readiness:exact-operation-command" },
      { command: "objectiveAudit", gap: "objectiveAudit:exact-operation-command" },
      { command: "launchReadiness", gap: "launchReadiness:exact-operation-readiness-command" },
    ]

    for (const item of cases) {
      const operationID = `extra-token-packet-${item.command.toLowerCase()}-proof`
      const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
      await writeSchoolLaptopPlan(root, operationID)
      await writePassingLaunchPacket(root, operationID)
      const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
      const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
      packet.commands[item.command] = `${packet.commands[item.command]} --future-footgun true`
      if (item.command === "openCredentialVault") packet.credentialRequirements.openVaultCommand = packet.commands[item.command]
      if (item.command === "credentialReview") packet.credentialRequirements.reviewCommand = packet.commands[item.command]
      await writeJson(packetPath, packet)

      const result = await auditFirstRunObjective(repoRoot, {
        operationID,
        outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", `test-extra-token-packet-${item.command}`),
      })

      const check = result.checks.find((check) => check.id === "selected-operation-launch-packet")
      expect(check?.status).toBe("missing")
      expect(check?.detail).toContain(`command_gaps=${item.gap}`)
    }
  })

  test("does not accept selected launch packets whose preflight command omits strict laptop confirmations", async () => {
    const operationID = "weak-packet-preflight-command-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.commands.preflight = `bun run --cwd packages/opencode ulm:laptop-preflight ${operationID} --prepare --confirm power --confirm wifi`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-weak-packet-preflight-command"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=preflight:exact-operation-command")
  })

  test("does not accept selected launch packets whose canary command points at the wrong operation", async () => {
    const operationID = "wrong-packet-canary-command-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.commands.canary = `bun run --cwd packages/opencode ulm:wall-clock-canary ${operationID}-copy-canary --target-seconds 120 --strict --json`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-wrong-packet-canary-command"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=canary:exact-operation-canary-command")
  })

  test("does not accept selected launch packets whose preflight command hides confirmations in a shell comment", async () => {
    const operationID = "commented-packet-preflight-command-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.commands.preflight = `bun run --cwd packages/opencode ulm:laptop-preflight ${operationID} --prepare --strict --confirm power # --confirm sleep --confirm wifi --confirm scope --confirm clock`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-commented-packet-preflight-command"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=preflight:exact-operation-command")
  })

  test("does not accept selected launch packets when only the daemon command points at a suffix-mismatched operation id", async () => {
    const operationID = "suffix-mismatch-packet-daemon-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.commands.daemon48h = `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID}-copy --duration-hours 48 --detach --json`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-suffix-mismatch-packet-daemon"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=daemon48h:exact-operation-duration-command")
    expect(check?.detail).toContain("supervisor_runbook_launch_readiness=true")
  })

  test("does not accept selected launch packets without an exact supervisor handoff command", async () => {
    const operationID = "weak-packet-supervisor-command-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.commands.supervisor = `bun run --cwd packages/opencode ulm:runtime-daemon ${operationID}-copy --duration-hours 48 --supervisor all --detach --json`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-weak-packet-supervisor-command"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=supervisor:exact-operation-supervisor-command")
  })

  test("does not accept selected launch packets without the pre-daemon launch readiness gate", async () => {
    const operationID = "missing-launch-readiness-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    delete packet.commands.launchReadiness
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-launch-readiness-packet"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=--require-launch-ready")
    expect(check?.detail).toContain("command_gaps=launchReadiness:exact-operation-readiness-command")
    expect(result.nextActions.find((action) => action.id === "create-launch-packet")?.commands).toContain(
      `bun run --cwd packages/opencode ulm:first-run-launch-packet ${operationID} --strict --json`,
    )
  })

  test("does not accept selected launch packets when only the packet launchReadiness command points at a suffix-mismatched operation id", async () => {
    const operationID = "suffix-mismatch-packet-launch-readiness-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.commands.launchReadiness = `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID}-copy --require-launch-ready --json`
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-suffix-mismatch-packet-launch-readiness"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing_command_terms=none")
    expect(check?.detail).toContain("command_gaps=launchReadiness:exact-operation-readiness-command")
    expect(check?.detail).toContain("supervisor_runbook_launch_readiness=true")
  })

  test("does not accept selected launch packets with stale supervisor runbooks missing the launch readiness gate", async () => {
    const operationID = "stale-supervisor-runbook-launch-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await fs.writeFile(
      path.join(root, "scheduler", "supervisor", "supervisor-install.md"),
      ["# Runtime Daemon Supervisor Install", "", "## Pre-Launch Gate", "", "Run laptop preflight before launch."].join("\n") + "\n",
    )

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-supervisor-runbook-launch-packet"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("supervisor_runbook_launch_readiness=false")
    expect(result.nextActions.find((action) => action.id === "create-launch-packet")?.commands).toContain(
      `bun run --cwd packages/opencode ulm:first-run-launch-packet ${operationID} --strict --json`,
    )
  })

  test("does not accept selected launch packets when the supervisor readiness gate points at a suffix-mismatched operation id", async () => {
    const operationID = "suffix-mismatch-supervisor-runbook-launch-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    await fs.writeFile(
      path.join(root, "scheduler", "supervisor", "supervisor-install.md"),
      [
        "# Runtime Daemon Supervisor Install",
        "",
        "## Launch Readiness Gate",
        "",
        "```sh",
        `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID}-copy --require-launch-ready --json`,
        "```",
      ].join("\n") + "\n",
    )

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-suffix-mismatch-supervisor-runbook"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("supervisor_runbook_launch_readiness=false")
    expect(result.nextActions.find((action) => action.id === "create-launch-packet")?.commands).toContain(
      `bun run --cwd packages/opencode ulm:first-run-launch-packet ${operationID} --strict --json`,
    )
  })

  test("does not accept an old selected launch packet without structured credential requirements", async () => {
    const operationID = "old-launch-packet-credential-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    delete packet.credentialRequirements
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-old-launch-packet-credential-proof"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-launch-packet")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-launch-packet")?.detail).toContain(
      "credential_requirements=missing",
    )
  })

  test("does not accept an old selected launch packet without structured scope requirements", async () => {
    const operationID = "old-launch-packet-scope-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    delete packet.scopeRequirements
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-old-launch-packet-scope-proof"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-launch-packet")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-launch-packet")?.detail).toContain(
      "scope_requirements=missing",
    )
  })

  test("does not accept selected launch packet checklist rows that are duplicated or unknown", async () => {
    const operationID = "stale-launch-packet-checklist-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.requiredBeforeLaunch.push({ id: "wall-power", detail: "Duplicate wall power row." })
    packet.requiredBeforeLaunch.push({ id: "stale-sis-vendor-review", detail: "Old generic SIS/vendor checklist row." })
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-launch-packet-checklist"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("unexpected_required_items=stale-sis-vendor-review")
    expect(check?.detail).toContain("duplicate_required_items=wall-power")
  })

  test("does not accept a selected launch packet whose structured credential requirements name stale services", async () => {
    const operationID = "stale-launch-packet-credential-requirements-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.credentialRequirements.expectedServices = ["genesis", "google", "sis", "vendor"]
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-launch-packet-credential-requirements"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("unexpected=sis,vendor")
  })

  test("does not accept selected launch packet credential requirements that are noncanonical or duplicated", async () => {
    const operationID = "noncanonical-launch-packet-credential-requirements-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.credentialRequirements.expectedServices = ["genesis", "Google", "google", " clever "]
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(
        repoRoot,
        "packages",
        "opencode",
        ".artifacts",
        "test-noncanonical-launch-packet-credential-requirements",
      ),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("unexpected=Google, clever ")
    expect(check?.detail).toContain("gaps=noncanonical:Google,duplicate:google,noncanonical: clever ")
  })

  test("does not accept a selected launch packet whose credential checklist names stale services", async () => {
    const operationID = "stale-launch-packet-credential-checklist-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.requiredBeforeLaunch = packet.requiredBeforeLaunch.map((item: { id?: string; detail?: string }) =>
      item.id === "credential-review"
        ? {
            ...item,
            detail: "Genesis, Google, SIS, and vendor credentials are stored through the vault with redacted indexes only.",
          }
        : item,
    )
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-launch-packet-credential-checklist"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("credential_checklist_services_current=false")
  })

  test("accepts selected launch packet credential checklist services when SIS or vendor are explicit targets", async () => {
    const operationID = "explicit-sis-vendor-launch-packet-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.credentialTargets = ["genesis", "google", "sis", "vendor"]
    await writeJson(planPath, plan)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    packet.credentialRequirements.expectedServices = ["genesis", "google", "sis", "vendor"]
    packet.requiredBeforeLaunch = packet.requiredBeforeLaunch.map((item: { id?: string; detail?: string }) =>
      item.id === "credential-review"
        ? {
            ...item,
            detail: "Genesis, Google, SIS, and vendor credentials are stored through the vault with redacted indexes only.",
          }
        : item,
    )
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-explicit-sis-vendor-launch-packet"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("covered")
    expect(check?.detail).toContain("credential_checklist_services_current=true")
    expect(check?.detail).toContain("credential_checklist_unexpected=none")
  })

  test("does not accept a selected launch packet whose scope requirements are stale", async () => {
    const operationID = "stale-launch-packet-scope-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.scopeRules.push("Only run authenticated checks against the approved Genesis and Google test accounts.")
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-launch-packet-scope-proof"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("missing=Only run authenticated checks against the approved Genesis and Google test accounts.")
  })

  test("does not accept selected launch packet scope requirements that are stale, noncanonical, or duplicated", async () => {
    const operationID = "noncanonical-launch-packet-scope-requirements-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaunchPacket(root, operationID)
    const packetPath = path.join(root, "scheduler", "first-run-launch-packet.json")
    const packet = JSON.parse(await fs.readFile(packetPath, "utf8"))
    const firstRule = packet.scopeRequirements.rules[0]
    packet.scopeRequirements.rules = [
      ...packet.scopeRequirements.rules,
      firstRule,
      "  ",
      " Extra stale scope rule with padding. ",
    ]
    await writeJson(packetPath, packet)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-noncanonical-launch-packet-scope"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-launch-packet")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("unexpected=   |  Extra stale scope rule with padding. ")
    expect(check?.detail).toContain("gaps=duplicate,blank,noncanonical,noncanonical")
  })

  test("does not accept a selected operation whose laptop preflight is missing", async () => {
    const operationID = "missing-preflight-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLiteral48hProof(root, operationID)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-preflight-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.status).toBe("missing")
    expect(result.gaps.some((gap) => gap.includes("selected-operation-preflight"))).toBe(true)
  })

  test("does not accept selected school laptop preflight proof with a shallow 50 page report target", async () => {
    const operationID = "shallow-report-preflight-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflightWithReportTarget(root, operationID, 50)
    await writePassingLiteral48hProof(root, operationID)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-report-preflight-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.detail).toContain(
      "report_outline_target_pages=50",
    )
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.detail).toContain(
      "required_min_report_target_pages=75",
    )
  })

  test("does not accept selected laptop preflight proof without the underlying launch artifacts", async () => {
    const operationID = "forged-preflight-underlying-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writeJson(path.join(root, "scheduler", "laptop-preflight.json"), {
      operationID,
      status: "ready",
      targetHours: 48,
      gaps: [],
      checks: [
        { id: "duration-plan", status: "ok", required: true, detail: "duration ok" },
        { id: "operation-graph", status: "ok", required: true, detail: "graph ok" },
        { id: "supervisor-manifest", status: "ok", required: true, detail: "supervisor ok" },
        { id: "supervisor-runbook", status: "ok", required: true, detail: "runbook ok" },
        { id: "tool-preflight", status: "ok", required: true, detail: "tools ok" },
        { id: "model-route-audit", status: "ok", required: true, detail: "routes ok" },
        { id: "report-outline", status: "ok", required: true, detail: "target_pages=75" },
        { id: "credential-vault", status: "ok", required: true, detail: "vault ok" },
        { id: "operator-power", status: "ok", required: true, detail: "operator confirmed" },
        { id: "operator-sleep", status: "ok", required: true, detail: "operator confirmed" },
        { id: "operator-wifi", status: "ok", required: true, detail: "operator confirmed" },
        { id: "operator-scope", status: "ok", required: true, detail: "operator confirmed" },
        { id: "operator-clock", status: "ok", required: true, detail: "operator confirmed" },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-forged-preflight-underlying-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.detail).toContain(
      "underlying_preflight_gaps=operation-graph,operation-graph-identity-lanes,duration-plan,supervisor-manifest,supervisor-runbook,supervisor-runbook-launch-readiness,tool-preflight,model-route-audit,report-outline",
    )
  })

  test("does not accept selected laptop preflight proof after its supervisor readiness runbook is rebound to another operation", async () => {
    const operationID = "stale-preflight-supervisor-readiness-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await fs.writeFile(
      path.join(root, "scheduler", "supervisor", "supervisor-install.md"),
      [
        "# 48-Hour Laptop Checklist",
        "## Launch Readiness Gate",
        `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operationID}-copy --require-launch-ready --json`,
        "- Disable sleep/hibernate/modern standby",
        "- Join school Wi-Fi",
        "- Confirm credential vault and redacted indexes",
      ].join("\n") + "\n",
    )

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-preflight-supervisor-readiness"),
    })

    const check = result.checks.find((item) => item.id === "selected-operation-preflight")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("supervisor_runbook_launch_readiness=false")
    expect(check?.detail).toContain("underlying_preflight_gaps=supervisor-runbook-launch-readiness")
  })

  test("does not accept a ready selected laptop preflight when current credential coverage is missing", async () => {
    const operationID = "stale-preflight-credential-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-preflight-credential-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-preflight")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("current_credential_gaps=genesis,google")
  })

  test("does not accept a selected laptop preflight older than the current operation plan", async () => {
    const operationID = "stale-preflight-plan-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.writtenAt = "2026-05-09T12:05:00.000Z"
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-preflight-plan-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-preflight")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("preflight_stale_plan=true")
  })

  test("does not accept a selected laptop preflight whose plan fingerprint is stale", async () => {
    const operationID = "stale-preflight-plan-fingerprint-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    const planPath = path.join(root, "plans", "operation-plan.json")
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"))
    plan.scopeRules.push("Only use submitted test accounts for authenticated workflow checks.")
    await writeJson(planPath, plan)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-preflight-plan-fingerprint-audit"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-preflight")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("preflight_plan_fingerprint_current=false")
    expect(check?.detail).toContain("underlying_preflight_gaps=preflight-plan-fingerprint")
  })

  test("does not accept a selected laptop preflight older than the current vault credential submission", async () => {
    const operationID = "stale-preflight-vault-submit-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    const reviewPath = path.join(root, "credentials", "review-submission.json")
    const review = JSON.parse(await fs.readFile(reviewPath, "utf8"))
    review.submittedAt = "2026-05-09T12:05:00.000Z"
    await writeJson(reviewPath, review)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-preflight-vault-submit-audit"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-preflight")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("preflight_stale_credential_review=true")
    expect(check?.detail).toContain("underlying_preflight_gaps=preflight-stale-credential-review")
  })

  test("does not accept a selected laptop preflight when the current vault credential submission timestamp is invalid", async () => {
    const operationID = "invalid-preflight-vault-submit-time-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    const reviewPath = path.join(root, "credentials", "review-submission.json")
    const review = JSON.parse(await fs.readFile(reviewPath, "utf8"))
    review.submittedAt = "after lunch"
    await writeJson(reviewPath, review)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-invalid-preflight-vault-submit-time"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "selected-operation-preflight")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("credential_submitted_at_valid=false")
    expect(check?.detail).toContain("credential_submission_timestamp_gap=true")
    expect(check?.detail).toContain("underlying_preflight_gaps=credential-submission-timestamp")
  })

  test("does not accept a selected operation plan copied from another operation id", async () => {
    const operationID = "copied-plan-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID: "other-school-laptop-run",
      templateName: "school-laptop-48h",
      timeBudget: { targetHours: 48, finalizationWindowHours: 4 },
    })
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-copied-plan-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-template")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-template")?.detail).toContain(
      "plan_operation_id=other-school-laptop-run",
    )
  })

  test("does not accept 48h proof from an operation that is not the school laptop template", async () => {
    const operationID = "wrong-template-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID,
      templateName: "internal-network",
      timeBudget: { targetHours: 48 },
    })
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID,
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
        { id: "final-package", status: "ok", required: true, detail: "package ok" },
        { id: "final-operation-audit", status: "ok", required: true, detail: "audit ok" },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-wrong-template-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-template")?.status).toBe("missing")
    expect(result.gaps.some((gap) => gap.includes("selected-operation-template"))).toBe(true)
  })

  test("does not accept copied 48h proof from a different operation id", async () => {
    const operationID = "copied-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID: "other-school-laptop-run",
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
        { id: "final-package", status: "ok", required: true, detail: "package ok" },
        { id: "final-operation-audit", status: "ok", required: true, detail: "audit ok" },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-copied-proof-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "audit_operation_id=other-school-laptop-run",
    )
  })

  test("does not accept selected 48h proof whose final audit omits 75 page handoff gates", async () => {
    const operationID = "shallow-final-audit-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID,
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-proof", status: "ok", required: true, detail: "preflight ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
      { id: "final-package", status: "ok", required: true, detail: "missing_manifest_artifacts=none; missing_manifest_files=none" },
        {
          id: "final-operation-audit",
          status: "ok",
          required: true,
          detail: "audit ok; required_min_outline_target_pages=50; required_min_pdf_pages=50",
        },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-final-audit-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-operation-audit:outline-75",
    )
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-operation-audit:pdf-75",
    )
  })

  test("does not accept selected 48h proof whose final package omits manifest artifact coverage", async () => {
    const operationID = "shallow-final-package-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID,
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-proof", status: "ok", required: true, detail: "preflight ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
        { id: "final-package", status: "ok", required: true, detail: "missing_manifest_files=none" },
        {
          id: "final-operation-audit",
          status: "ok",
          required: true,
          detail:
            "ok=true; blockers=0; fresh=true; final_handoff=proved; required_min_outline_target_pages=75; required_min_pdf_pages=75",
        },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-final-package-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-package:artifact-proof",
    )
  })

  test("does not accept selected 48h proof whose final stakeholder report package is shallow", async () => {
    const operationID = "shallow-stakeholder-package-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    await fs.writeFile(path.join(root, "deliverables", "final", "board-report.md"), "# Board Report\n")

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-stakeholder-package-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "board-report.md:missing:## Executive Decision Summary",
    )
  })

  test("does not accept selected 48h proof when underlying final PDFs are not parseable", async () => {
    const operationID = "unparseable-final-pdf-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    await fs.writeFile(path.join(root, "deliverables", "final", "board-report.pdf"), "%PDF-1.4\n% /ULMCodeRenderer (styled-html)\n%%EOF\n")

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-unparseable-final-pdf-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-manifest:pdf-gaps=board-report.pdf:page-count-missing",
    )
  })

  test("does not accept selected 48h proof when underlying final PDFs spoof page counts without styled PDF metadata", async () => {
    const operationID = "spoofed-final-pdf-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    await fs.writeFile(path.join(root, "deliverables", "final", "board-report.pdf"), "plain text /Type /Pages /Count 75\n")

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-spoofed-final-pdf-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-manifest:pdf-gaps=board-report.pdf:not-pdf",
    )
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "board-report.pdf:missing-styled-renderer",
    )
  })

  test("does not accept selected 48h proof when the underlying final audit predates the final manifest", async () => {
    const operationID = "stale-underlying-final-audit-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    const manifestPath = path.join(root, "deliverables", "final", "manifest.json")
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    manifest.generatedAt = "2026-05-09T12:05:00.000Z"
    await writeJson(manifestPath, manifest)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-underlying-final-audit"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "literal-48h-proof")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("underlying_final_audit_gaps=final-audit:before-final-manifest")
  })

  test("does not accept selected 48h proof whose final audit omits freshness and handoff proof", async () => {
    const operationID = "shallow-final-audit-status-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID,
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-proof", status: "ok", required: true, detail: "preflight ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
        {
          id: "final-package",
          status: "ok",
          required: true,
          detail: "missing_manifest_artifacts=none; missing_manifest_files=none",
        },
        {
          id: "final-operation-audit",
          status: "ok",
          required: true,
          detail: "required_min_outline_target_pages=75; required_min_pdf_pages=75",
        },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-final-audit-status-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-operation-audit:ok",
    )
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-operation-audit:blockers",
    )
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-operation-audit:fresh",
    )
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "final-operation-audit:handoff",
    )
  })

  test("does not accept selected 48h proof without credential handoff timing evidence", async () => {
    const operationID = "missing-literal-credential-timing-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)

    const auditPath = path.join(root, "scheduler", "literal-run-readiness.json")
    const audit = JSON.parse(await fs.readFile(auditPath, "utf8")) as { checks?: Array<{ id?: string; detail?: string }> }
    const credentialCheck = audit?.checks?.find((check) => check.id === "credential-handoff-proof")
    if (credentialCheck) credentialCheck.detail = "submitted_at=2026-05-08T19:55:00.000Z; credential_count=2"
    await writeJson(auditPath, audit)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-literal-credential-timing"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "credential-handoff-proof:before-daemon-start",
    )
  })

  test("does not accept selected 48h proof when the current vault credential submission changed after readiness proof", async () => {
    const operationID = "stale-literal-credential-submit-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    const reviewPath = path.join(root, "credentials", "review-submission.json")
    const review = JSON.parse(await fs.readFile(reviewPath, "utf8"))
    review.submittedAt = "2026-05-09T12:05:00.000Z"
    await writeJson(reviewPath, review)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-literal-credential-submit"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "literal-48h-proof")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("current_credential_submitted_at=2026-05-09T12:05:00.000Z")
    expect(check?.detail).toContain("missing_current_credential_evidence=credential-handoff-proof:submitted-at-current")
  })

  test("does not accept selected 48h proof when current vault credential services changed after readiness proof", async () => {
    const operationID = "stale-literal-credential-service-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingCredentialReview(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    const reviewPath = path.join(root, "credentials", "review-submission.json")
    const review = JSON.parse(await fs.readFile(reviewPath, "utf8"))
    review.credentials = [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }]
    await writeJson(reviewPath, review)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-literal-credential-services"),
    })

    expect(result.status).toBe("incomplete")
    const check = result.checks.find((item) => item.id === "literal-48h-proof")
    expect(check?.status).toBe("missing")
    expect(check?.detail).toContain("current_credential_gaps=google")
    expect(check?.detail).toContain("missing_current_credential_evidence=current-credential-services=google")
  })

  test("does not accept selected 48h proof without underlying final package and audit artifacts", async () => {
    const operationID = "missing-underlying-final-artifacts"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID,
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-proof", status: "ok", required: true, detail: "preflight ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
        {
          id: "final-package",
          status: "ok",
          required: true,
          detail: "missing_manifest_artifacts=none; missing_manifest_files=none",
        },
        {
          id: "final-operation-audit",
          status: "ok",
          required: true,
          detail:
            "ok=true; blockers=0; fresh=true; final_handoff=proved; required_min_outline_target_pages=75; required_min_pdf_pages=75",
        },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-underlying-final-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "underlying_final_package_gaps=final-manifest:missing",
    )
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain(
      "underlying_final_audit_gaps=final-audit:missing",
    )
  })

  test("requires the literal readiness audit to prove no laptop preflight bypass scar exists", async () => {
    const operationID = "missing-bypass-check-proof"
    const auditPath = path.join(repoRoot, ".ulmcode", "operations", operationID, "scheduler", "literal-run-readiness.json")
    await writeJson(auditPath, {
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "final-package", status: "ok", required: true, detail: "package ok" },
        { id: "final-operation-audit", status: "ok", required: true, detail: "audit ok" },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-bypass-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain("laptop-preflight-bypass")
  })

  test("requires the literal readiness audit to prove the matching laptop preflight was ready", async () => {
    const operationID = "missing-literal-preflight-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID,
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
        { id: "final-package", status: "ok", required: true, detail: "package ok" },
        { id: "final-operation-audit", status: "ok", required: true, detail: "audit ok" },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-literal-preflight-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain("laptop-preflight-proof")
  })

  test("requires the literal readiness audit to prove stakeholder final package files existed", async () => {
    const operationID = "missing-final-package-file-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writeJson(path.join(root, "scheduler", "literal-run-readiness.json"), {
      operationID,
      status: "passed",
      targetElapsedSeconds: 48 * 60 * 60,
      literalElapsedSeconds: 48 * 60 * 60,
      checks: [
        { id: "literal-runtime-proof", status: "ok", required: true, detail: "elapsed ok" },
        { id: "daemon-heartbeat-continuity", status: "ok", required: true, detail: "continuity ok" },
        { id: "literal-work-proof", status: "ok", required: true, detail: "work ok" },
        { id: "laptop-preflight-proof", status: "ok", required: true, detail: "preflight ok" },
        { id: "laptop-preflight-bypass", status: "ok", required: true, detail: "no bypass scar" },
        { id: "final-package", status: "ok", required: true, detail: "package ok" },
        { id: "final-operation-audit", status: "ok", required: true, detail: "audit ok" },
      ],
    })

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-final-package-file-proof"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "literal-48h-proof")?.detail).toContain("final-package:file-proof")
  })

  test("does not accept a shallow ready laptop preflight without underlying launch checks", async () => {
    const operationID = "shallow-preflight-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    await writeSchoolLaptopPlan(root, operationID)
    await writeJson(path.join(root, "scheduler", "laptop-preflight.json"), {
      operationID,
      status: "ready",
      targetHours: 48,
      checks: [],
      gaps: [],
    })
    await writePassingLiteral48hProof(root, operationID)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-preflight-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "selected-operation-preflight")?.detail).toContain(
      "missing_ok_checks",
    )
  })

  test("does not accept selected 48h proof without passing live behavior probe artifacts", async () => {
    const operationID = "missing-live-probe-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-live-probes")
    await fs.rm(behaviorProbeDir, { recursive: true, force: true })
    await fs.mkdir(behaviorProbeDir, { recursive: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-missing-live-probe-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.detail).toContain(
      "missing_passed_scenarios",
    )
  })

  test("does not accept shallow live behavior probe JSON without transcript and prompt artifacts", async () => {
    const operationID = "shallow-live-probe-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-live-probes")
    await fs.rm(behaviorProbeDir, { recursive: true, force: true })
    await fs.mkdir(behaviorProbeDir, { recursive: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    for (const id of [
      "k12-sso-roster-export-chain",
      "quick-network-resume-checkpoint",
      "privileged-dossier-attack-chain-report",
      "k12-exploit-chain-safety",
    ]) {
      await writeJson(path.join(behaviorProbeDir, `${id}-shallow.json`), {
        ok: true,
        timedOut: false,
        result: { ok: true, scenarioID: id, findings: [] },
      })
    }

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-shallow-live-probe-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.detail).toContain("missing_artifacts")
  })

  test("does not accept live behavior probes with findings or empty prompt/transcript artifacts", async () => {
    const operationID = "weak-live-probe-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-weak-live-probes")
    await fs.rm(behaviorProbeDir, { recursive: true, force: true })
    await fs.mkdir(behaviorProbeDir, { recursive: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    for (const id of [
      "k12-sso-roster-export-chain",
      "quick-network-resume-checkpoint",
      "privileged-dossier-attack-chain-report",
      "k12-exploit-chain-safety",
    ]) {
      const prefix = path.join(behaviorProbeDir, `${id}-weak`)
      await fs.writeFile(`${prefix}.jsonl`, "")
      await fs.writeFile(`${prefix}.prompt.txt`, "")
      await writeJson(path.join(behaviorProbeDir, `${id}-weak.json`), {
        ok: true,
        timedOut: false,
        transcript: `${prefix}.jsonl`,
        prompt: `${prefix}.prompt.txt`,
        result: {
          ok: true,
          scenarioID: id,
          findings: [{ id: "weak-chain-narrative", severity: "warning", detail: "fixture" }],
        },
      })
    }

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-weak-live-probe-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.detail).toContain("weak_reports")
  })

  test("does not accept an older passing live probe when a newer probe for the same scenario failed", async () => {
    const operationID = "stale-live-probe-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-live-probes")
    await fs.rm(behaviorProbeDir, { recursive: true, force: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const failedScenario = "quick-network-resume-checkpoint"
    const failedPrefix = path.join(behaviorProbeDir, `${failedScenario}-latest-fail`)
    await fs.writeFile(`${failedPrefix}.jsonl`, `${failedScenario} latest failure transcript\n`)
    await fs.writeFile(`${failedPrefix}.prompt.txt`, `Behavior watch scenario: ${failedScenario}\n`)
    await writeJson(path.join(behaviorProbeDir, `${failedScenario}-latest-fail.json`), {
      ok: false,
      timedOut: false,
      transcript: `${failedPrefix}.jsonl`,
      prompt: `${failedPrefix}.prompt.txt`,
      result: {
        ok: false,
        scenarioID: failedScenario,
        findings: [{ id: "broad-operation-artifact-search", severity: "error", detail: "fixture" }],
      },
    })
    const newest = new Date("2030-01-01T00:00:00.000Z")
    await fs.utimes(path.join(behaviorProbeDir, `${failedScenario}-latest-fail.json`), newest, newest)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-stale-live-probe-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.detail).toContain("latest_failed")
  })

  test("does not accept live behavior probes older than their watcher or scenario sources", async () => {
    const operationID = "source-stale-live-probe-proof"
    const root = path.join(repoRoot, ".ulmcode", "operations", operationID)
    const behaviorProbeDir = path.join(repoRoot, "packages", "opencode", ".artifacts", "test-source-stale-live-probes")
    await fs.rm(behaviorProbeDir, { recursive: true, force: true })
    await writeSchoolLaptopPlan(root, operationID)
    await writePassingLaptopPreflight(root, operationID)
    await writePassingLiteral48hProof(root, operationID)
    await writePassingLiveBehaviorProbes(behaviorProbeDir)

    const staleScenario = "k12-sso-roster-export-chain"
    const staleJson = path.join(behaviorProbeDir, `${staleScenario}-pass.json`)
    const old = new Date("2000-01-01T00:00:00.000Z")
    await fs.utimes(staleJson, old, old)

    const result = await auditFirstRunObjective(repoRoot, {
      operationID,
      behaviorProbeDir,
      outputDir: path.join(repoRoot, "packages", "opencode", ".artifacts", "test-source-stale-live-probe-objective-audit"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.status).toBe("missing")
    expect(result.checks.find((check) => check.id === "live-behavior-probes")?.detail).toContain("stale_sources")
  })
})
