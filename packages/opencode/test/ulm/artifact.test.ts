import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Bus } from "@/bus"
import { WithInstance } from "@/project/with-instance"
import {
  buildOperationAudit,
  buildOperationResumeBrief,
  buildOperationStageGate,
  formatOperationAudit,
  formatOperationStatusDashboard,
  formatOperationResumeBrief,
  listOperationStatuses,
  lintReport,
  readOperationStatus,
  renderReport,
  validateFinding,
  writeFinding,
  writeDistrictProfile,
  writeEvidence,
  writeIdentityGraph,
  writeOperationCheckpoint,
  writeOperationPlan,
  writeOperationDiscoveryCharter,
  approveOperationDiscoveryCharter,
  writeEvalScorecard,
  writeCoverageContract,
  writePersonProfile,
  writeReportOutline,
  writeRuntimeSummary,
  closeOperationStatuses,
  operationPath,
} from "@/ulm/artifact"
import { bindOperationSession } from "@/ulm/operation-context"
import { OperationEvent } from "@/ulm/event"
import { createOperationGoal } from "@/ulm/operation-goal"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { disposeAllInstances } from "../fixture/fixture"

async function tmpdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "ulm-artifact-"))
}

function executionBlocks(input: { minutes: number; laneID?: string; stage?: "recon" | "validation" | "reporting" | "handoff" }) {
  const laneID = input.laneID ?? "recon"
  const stage = input.stage ?? "recon"
  const blockMinutes = input.minutes >= 480 ? 60 : 30
  const count = Math.ceil(input.minutes / blockMinutes)
  return Array.from({ length: count }, (_, index) => ({
    id: `block-${index + 1}`,
    stage,
    laneID,
    title: `Bounded ${stage} work block ${index + 1}`,
    startMinute: index * blockMinutes,
    durationMinutes: blockMinutes,
    objective: `Complete bounded ${stage} work block ${index + 1}.`,
    actions: [`Run the scoped ${stage} action for block ${index + 1}.`],
    successCriteria: [`Block ${index + 1} records evidence, blockers, or a safe fallback.`],
    fallbackWork: [`If the primary action stalls, run the narrower safe fallback for block ${index + 1}.`],
    subagents: stage === "reporting" ? ["report-writer"] : [laneID],
    expectedArtifacts: [`work-blocks/block-${index + 1}.md`],
  }))
}

async function completeGraphForHandoff(worktree: string, operationID = "school") {
  const graph = await writeOperationGraph(worktree, { operationID, budgetUSD: 10 })
  const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
  const root = path.join(worktree, ".ulmcode", "operations", operationID)
  for (const lane of parsed.lanes) {
    lane.status = "complete"
    for (const artifact of lane.expectedArtifacts) {
      const target = path.join(root, artifact.replace(/\/+$/g, ""))
      if (artifact.endsWith("/")) {
        await fs.mkdir(target, { recursive: true })
        await fs.writeFile(path.join(target, ".keep"), "complete\n")
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true })
        try {
          const stat = await fs.stat(target)
          if (stat.size > 0) continue
        } catch {}
        await fs.writeFile(
          target,
          artifact.endsWith(".json")
            ? "{}\n"
            : artifact === "reports/report.md"
              ? [
                  "# Assessment Report",
                  "",
                  "## Executive Summary",
                  "complete ".repeat(20),
                  "## Scope, Authorization, and Methodology",
                  "complete ".repeat(20),
                  "## District Profile and Environment Overview",
                  "complete ".repeat(20),
                  "## People, Roles, and Identity Graph",
                  "complete ".repeat(20),
                  "## Attack Path Narrative",
                  "complete ".repeat(20),
                  "## Findings Detail",
                  "complete ".repeat(20),
                  "## Risk Register and Prioritized Roadmap",
                  "complete ".repeat(20),
                  "## Coverage, Browser Evidence, and Testing Limits",
                  "complete ".repeat(20),
                  "## Validation Limits and Known Unknowns",
                  "complete ".repeat(20),
                  "## Evidence Map",
                  "complete ".repeat(20),
                  "## Operator Handoff Checklist",
                  "complete ".repeat(20),
                  "## Appendix: Raw Evidence Index",
                  "complete ".repeat(20),
                ].join("\n")
              : "complete\n",
        )
      }
    }
  }
  await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2))
  await fs.mkdir(path.join(root, "lane-complete"), { recursive: true })
  for (const lane of parsed.lanes) {
    await fs.writeFile(
      path.join(root, "lane-complete", `${lane.id}.json`),
      JSON.stringify(
        {
          operationID,
          laneID: lane.id,
          status: "complete",
          completedAt: new Date().toISOString(),
          summary: `${lane.id} complete.`,
          artifacts: lane.expectedArtifacts,
          evidenceRefs: ["ev-1"],
        },
        null,
        2,
      ),
    )
  }
  await writeCoverageContract(worktree, {
    operationID,
    status: "released",
    goals: ["All required handoff lanes completed."],
    minimumEvidence: ["Lane completion proofs and report artifacts exist."],
    requiredLanes: parsed.lanes.map((lane: { id: string }) => lane.id),
    allowedSkippedLanes: [],
    fallbackRules: ["No fallback required for synthetic handoff fixture."],
    retryRules: ["No retry required for synthetic handoff fixture."],
    subagentOpportunities: ["Report review lanes."],
    reportGates: ["report_lint finalHandoff=true"],
    releaseNotes: ["Synthetic test fixture released coverage."],
  })
}

describe("ULM artifact ledger", () => {
  test("stores operation artifacts under cwd when a non-git run reports worktree root", async () => {
    const previous = process.cwd()
    const parent = await tmpdir()
    const dir = path.join(parent, "probe-workspace")
    try {
      await fs.mkdir(path.join(parent, ".ulmcode", "operations"), { recursive: true })
      await fs.mkdir(dir, { recursive: true })
      process.chdir(dir)
      const realDir = await fs.realpath(dir)

      expect(operationPath("/", "Synthetic Run")).toBe(path.join(realDir, ".ulmcode", "operations", "synthetic-run"))
    } finally {
      process.chdir(previous)
      await fs.rm(parent, { recursive: true, force: true })
    }
  })

  afterEach(() => disposeAllInstances())

  test("writes resumable operation checkpoints", async () => {
    const worktree = await tmpdir()
    const result = await writeOperationCheckpoint(worktree, {
      operationID: "School Assessment",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon lane started.",
      nextActions: ["Map exposed services"],
      activeTasks: ["task-1"],
      evidence: [{ id: "ev-1", path: "evidence/raw/nmap.txt", summary: "Initial scan" }],
    })

    expect(result.record.operationID).toBe("school-assessment")
    expect(await fs.readFile(path.join(result.root, "status.md"), "utf8")).toContain("Recon lane started.")
    expect(await fs.readFile(path.join(result.root, "events.jsonl"), "utf8")).toContain('"type":"checkpoint"')
  })

  test("preserves checkpoint objective on operation updates", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "School Assessment",
      objective: "Authorized school assessment",
      stage: "intake",
      status: "running",
      summary: "Initial checkpoint.",
    })

    const result = await writeOperationCheckpoint(worktree, {
      operationID: "School Assessment",
      stage: "recon",
      status: "running",
      summary: "Recon update without restating objective.",
    })

    expect(result.record.objective).toBe("Authorized school assessment")
    expect(result.record.stage).toBe("recon")
  })

  test("publishes operation update events after durable writes", async () => {
    const worktree = await tmpdir()
    const received: Array<{ operationID: string; artifact: string; path?: string }> = []

    await WithInstance.provide({
      directory: worktree,
      fn: async () => {
        const unsubscribe = Bus.subscribe(OperationEvent.Updated, (evt) => {
          received.push(evt.properties)
        })
        await Bun.sleep(10)
        await writeOperationCheckpoint(worktree, {
          operationID: "School Assessment",
          objective: "Authorized school assessment",
          stage: "recon",
          status: "running",
          summary: "Recon lane started.",
        })
        await Bun.sleep(10)
        unsubscribe()
      },
    })

    expect(received).toContainEqual(
      expect.objectContaining({
        operationID: "school-assessment",
        artifact: "checkpoint",
        operation: expect.objectContaining({
          stage: "recon",
          status: "running",
          summary: "Recon lane started.",
        }),
        findings: { total: 0 },
        evidence: { total: 0 },
      }),
    )
  })

  test("requires evidence before validated findings", () => {
    const gaps = validateFinding({
      operationID: "school",
      title: "Weak MFA coverage",
      state: "validated",
      severity: "high",
      confidence: 0.8,
      affectedAssets: ["IdP"],
      evidence: [],
      description: "MFA is not enforced for administrators.",
    })

    expect(gaps).toContain("validated findings require at least one evidence reference")
  })

  test("writes durable evidence records and raw content", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon is collecting evidence.",
    })

    const result = await writeEvidence(worktree, {
      operationID: "school",
      title: "IdP policy export",
      kind: "command_output",
      summary: "Policy export shows privileged MFA is optional.",
      command: "idpctl policy export --json",
      content: '{"adminMfa":"optional"}',
    })

    expect(await fs.readFile(result.rawPath!, "utf8")).toContain("adminMfa")
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).path).toBe("evidence/raw/idp-policy-export.txt")
    expect((await readOperationStatus(worktree, "school")).evidence.total).toBe(1)
  })

  test("rejects raw credential secrets in evidence records", async () => {
    const worktree = await tmpdir()

    await expect(
      writeEvidence(worktree, {
        operationID: "school",
        title: "Genesis login proof",
        kind: "note",
        summary: "Captured credential issue for follow-up.",
        content: "genesis password: Summer2026!",
      }),
    ).rejects.toThrow("evidence records must not contain raw credential secrets")
  })

  test("rejects raw credential secrets in finding records", async () => {
    const worktree = await tmpdir()

    await expect(
      writeFinding(worktree, {
        operationID: "school",
        title: "Genesis admin credential exposure",
        state: "candidate",
        severity: "high",
        confidence: 0.8,
        affectedAssets: ["Genesis"],
        evidence: [],
        description: "The admin login worked with password: Summer2026!",
      }),
    ).rejects.toThrow("finding records must not contain raw credential secrets")
  })

  test("lints findings before report handoff", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const result = await lintReport(worktree, "school")
    expect(result.ok).toBe(true)
    expect(result.counts.reportReady).toBe(1)
  })

  test("writes operation eval scorecards for objective harness scoring", async () => {
    const worktree = await tmpdir()
    const result = await writeEvalScorecard(worktree, {
      operationID: "school",
      target: "District portal lab",
      sandbox: "local-docker",
      allowedProfiles: ["non_destructive"],
      successCriteria: ["validated finding reproduced", "report rendered"],
      artifactRequirements: ["evidence-index.json", "deliverables/final/report.html"],
      mitreTags: ["T1190"],
      budget: { maxHours: 10, maxUSD: 25 },
      metrics: {
        passed: true,
        timeToFirstSignalMs: 1200,
        validatedFindings: 2,
        falsePositives: 0,
        toolFailures: 1,
        retries: 2,
        costUSD: 3.25,
        reportQuality: "passed",
      },
    })

    const record = JSON.parse(await fs.readFile(result.json, "utf8"))
    const markdown = await fs.readFile(result.markdown, "utf8")

    expect(result.operationID).toBe("school")
    expect(record.metrics.validatedFindings).toBe(2)
    expect(record.mitreTags).toEqual(["T1190"])
    expect(markdown).toContain("# ULM Eval Scorecard")
    expect(markdown).toContain("validated finding reproduced")
    expect((await readOperationStatus(worktree, "school")).evalScorecard).toBe(true)
  })

  test("rejects raw credential secrets in operation checkpoint records", async () => {
    const worktree = await tmpdir()

    await expect(
      writeOperationCheckpoint(worktree, {
        operationID: "school",
        objective: "Authorized district assessment",
        stage: "intake",
        status: "blocked",
        summary: "Waiting on vault submission.",
        nextActions: ["Use credential handle cred-admin-1, not raw secrets."],
        blockers: ["Operator pasted password: Summer2026! into chat."],
      }),
    ).rejects.toThrow("operation checkpoints must not contain raw credential secrets")
  })

  test("rejects raw credential secrets in report outlines, eval scorecards, and coverage contracts", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized district assessment",
      stage: "reporting",
      status: "running",
      summary: "Report prep.",
      nextActions: [],
      blockers: [],
    })

    await expect(
      writeReportOutline(worktree, {
        operationID: "school\nAdmin token: raw-token-123",
        targetPages: 10,
        designProfile: "premium",
        audience: "board",
      }),
    ).rejects.toThrow("report outlines must not contain raw credential secrets")

    await expect(
      writeEvalScorecard(worktree, {
        operationID: "school",
        target: "District portal lab",
        successCriteria: ["validated finding reproduced"],
        notes: ["operator password: Summer2026!"],
        metrics: {
          passed: false,
          validatedFindings: 0,
          falsePositives: 0,
          toolFailures: 0,
          retries: 0,
          reportQuality: "failed",
        },
      }),
    ).rejects.toThrow("eval scorecards must not contain raw credential secrets")

    await expect(
      writeCoverageContract(worktree, {
        operationID: "school",
        goals: ["Assess the authorized environment."],
        minimumEvidence: ["Credential password: Summer2026!"],
        requiredLanes: ["recon"],
        allowedSkippedLanes: [],
        fallbackRules: [],
        retryRules: [],
        subagentOpportunities: [],
        reportGates: [],
      }),
    ).rejects.toThrow("coverage contracts must not contain raw credential secrets")
  })

  test("uses the operation goal objective in report outlines", async () => {
    const worktree = await tmpdir()
    await createOperationGoal(worktree, {
      operationID: "school",
      objective: "Authorized report outline rehearsal",
      targetDurationHours: 48,
    })

    const result = await writeReportOutline(worktree, {
      operationID: "school",
      targetPages: 18,
      designProfile: "board-ready",
      audience: "mixed",
    })

    expect(await fs.readFile(result.file, "utf8")).toContain("- objective: Authorized report outline rehearsal")
  })

  test("lints reportable findings that cite unrecorded evidence", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-missing", path: "evidence/raw/missing.txt" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const result = await lintReport(worktree, "school")
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("weak-mfa-coverage: evidence reference ev-missing is not recorded")
  })

  test("lints overlapping report-ready findings before they pad final reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-google-delegation",
      title: "Google Workspace delegated group export",
      kind: "file",
      summary: "Delegated admins can reset student passwords, move OUs, and approve SIS sync accounts.",
      path: "evidence/raw/ev-google-delegation.txt",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "normalized-text-ev-google-delegation-txt",
      title: "Normalized Google Workspace delegated group export",
      kind: "file",
      summary: "Normalized evidence for delegated Google Workspace group export.",
      path: "evidence/raw/ev-google-delegation.txt",
    })
    await writeFinding(worktree, {
      operationID: "school",
      findingID: "finding-google-delegated-admin-risk",
      title: "Google Workspace delegated admin powers create broad student identity lifecycle risk",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["application:google-workspace", "group:delegated-admins"],
      evidence: [
        {
          id: "ev-google-delegation",
          path: ".ulmcode/operations/school/evidence/ev-google-delegation.json",
        },
      ],
      description:
        "Delegated Google Workspace roles permit student password resets, OU movement, group review, and SIS sync account approval.",
      impact:
        "Compromise or misuse of this delegated admin path can affect student identity lifecycle operations across password, OU, group, and SIS sync workflows.",
      remediation:
        "Reduce delegated admin scope, separate SIS sync approval, enforce MFA, and review group membership on a recurring cadence.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      findingID: "finding-google-delegated-admin-blast-radius",
      title: "Google delegated admin powers create student identity lifecycle blast radius",
      state: "report_ready",
      severity: "medium",
      confidence: 0.88,
      affectedAssets: ["app-google-workspace", "person-avery-stone"],
      evidence: [{ id: "normalized-text-ev-google-delegation-txt", path: "evidence/raw/ev-google-delegation.txt" }],
      description:
        "Delegated Google Workspace admin rights allow student password resets, OU moves, group review, and SIS sync approval.",
      impact:
        "The delegated admin blast radius spans student identity lifecycle controls, including passwords, OUs, groups, and SIS sync workflows.",
      remediation:
        "Review delegated role membership, reduce scope, require MFA, and separate approval for SIS sync account actions.",
    })

    const result = await lintReport(worktree, "school")
    expect(result.ok).toBe(false)
    expect(
      result.gaps.some(
        (gap) =>
          gap.includes("finding-google-delegated-admin-risk") &&
          gap.includes("finding-google-delegated-admin-blast-radius") &&
          gap.includes("appear overlapping; merge them or split the evidence"),
      ),
    ).toBe(true)
  })

  test("writes a dense report outline and catches sparse reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 40 })
    expect(await fs.readFile(outline.file, "utf8")).toContain("target_pages: 40")

    await fs.writeFile(path.join(outline.root, "reports", "report.md"), "too short")
    const result = await lintReport(worktree, "school", { requireReport: true, minWords: 100 })
    expect(result.ok).toBe(false)
    expect(result.gaps.some((gap) => gap.includes("too sparse"))).toBe(true)
    expect(result.repairHints).toContain(
      "Report text is 98 words short of the minimum. Add at least 248 additional substantive, evidence-backed words to reports/report.md before rerunning report_lint; do not make tiny incremental edits.",
    )
  })

  test("lints reports that miss the outline page budget", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), `# Report\n\n${"detail ".repeat(150)}`)

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineBudget: true,
      minOutlineWordsPerPage: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("report misses outline budget: 152 words, expected at least 400 for 4 target pages")
    expect(result.repairHints).toContain(
      "Report text is 248 words short of the outline budget. Add at least 398 additional substantive, evidence-backed words to reports/report.md before rendering again; do not make tiny incremental edits.",
    )

    await writeReportOutline(worktree, { operationID: "school", targetPages: 50 })
    const largeDeficit = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineBudget: true,
      minOutlineWordsPerPage: 300,
    })
    expect(largeDeficit.repairHints).toContain(
      "Report text is 14848 words short of the outline budget. Add at least 15148 additional substantive, evidence-backed words to reports/report.md before rendering again; do not make tiny incremental edits. For a deficit this large, rewrite or delegate a report-expansion task in one bulk pass; patching a few paragraphs at a time will fail this gate.",
    )
  })

  test("lints reserved page padding in authored reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      [
        "# Report",
        "",
        "This report includes evidence-backed analysis.",
        "",
        '<div style="min-height: 10in; page-break-after: always;"><h3>Reserved Render Page A01</h3><p>Reserved for future authorized evidence expansion.</p></div>',
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", { requireReport: true })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("report contains placeholder or reserved-page padding")
    expect(result.repairHints).toContain(
      "Remove reserved-page, placeholder, or render-padding sections from reports/report.md. Long reports must grow through substantive, evidence-backed analysis, worksheets, appendices, remediation plans, and validation guidance, not blank or reserved pages.",
    )
  })

  test("lints raw credential secrets in authored reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    await fs.mkdir(path.join(worktree, ".ulmcode", "operations", "school", "reports"), { recursive: true })
    await fs.writeFile(
      path.join(worktree, ".ulmcode", "operations", "school", "reports", "report.md"),
      "# Report\n\nThe final appendix includes genesis password: Summer2026!",
    )

    const result = await lintReport(worktree, "school", { requireReport: true })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("report contains raw credential secrets")
    expect(result.repairHints).toContain(
      "Remove secret-shaped values from reports/report.md. Final reports may cite redacted credential handles such as cred-*-redacted, but raw passwords, tokens, cookies, API keys, or generated placeholder secrets belong only in internal review quarantine artifacts.",
    )
  })

  test("lints private dossier and destructive exploit claims in authored reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      [
        "# Report",
        "",
        "The person_profile dossier includes home address and spouse details.",
        "The exploit was run against production and changed grades to demonstrate impact.",
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", { requireReport: true })

    expect(result.gaps).toContain("report contains private-life dossier details")
    expect(result.gaps).toContain("report contains destructive exploit execution claims")
  })

  test("lints unprofessional stakeholder tone in authored reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      [
        "# Report",
        "",
        "The evidence map prevents weak report handoff, which is the whole damn point of a good report gate.",
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", { requireReport: true })

    expect(result.gaps).toContain("report contains unprofessional stakeholder tone")
    expect(result.repairHints).toContain(
      "Rewrite casual, meme-like, profane, or jokey language in reports/report.md into board-ready professional wording, then rerun report_lint.",
    )
  })

  test("allows authored reports to state private dossier details were excluded", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      [
        "# Report",
        "",
        "The professional people/account model excludes home addresses, family information, unrelated social media, and other irrelevant personal details.",
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", { requireReport: true })

    expect(result.gaps).not.toContain("report contains private-life dossier details")
  })

  test("allows hypothetical synthetic export risk language in authored reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Synthetic export policy",
      kind: "http_response",
      summary: "Synthetic export policy fixture.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Cross-district export risk",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["Synthetic export API"],
      evidence: [{ id: "ev-1" }],
      description: "A compromised session could export sensitive student support data in this synthetic replay.",
      impact: "The synthetic finding models possible sensitive data exposure without claiming destructive proof.",
      remediation: "Restrict export fields by role and purpose.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      "# Report\n\nA compromised administrator could export sensitive student support data in this synthetic risk model.",
    )

    const result = await lintReport(worktree, "school", { requireReport: true })

    expect(result.gaps).not.toContain("report contains destructive exploit execution claims")
  })

  test("allows access-rights language near explicit no-student-records boundaries", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      [
        "# Report",
        "",
        "Synthetic Genesis role export rights were present. No student records are present in the evidence.",
        "The stale integration token creates roster export risk, but no restricted record collection occurred.",
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", { requireReport: true })

    expect(result.gaps).not.toContain("report contains destructive exploit execution claims")
  })

  test("lints long-run reports with undersized outline target pages", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), `# Report\n\n${"detail ".repeat(1300)}`)

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineBudget: true,
      minOutlineTargetPages: 50,
      minOutlineWordsPerPage: 10,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("reports/report-outline.md target_pages is too small: 4, expected at least 50")
  })

  test("final handoff lint defaults to 50 target pages for 20h plans", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.mkdir(path.join(outline.root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(outline.root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID: "school", timeBudget: { targetHours: 20 } }, null, 2) + "\n",
    )
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), `# Report\n\n${"detail ".repeat(1300)}`)

    const result = await lintReport(worktree, "school", {
      finalHandoff: true,
      minOutlineWordsPerPage: 10,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("reports/report-outline.md target_pages is too small: 4, expected at least 50")
  })

  test("final handoff lint defaults to 75 target pages for school-laptop-48h plans", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 12 })
    await fs.mkdir(path.join(outline.root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(outline.root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID: "school", templateName: "school-laptop-48h", timeBudget: { targetHours: 48 } }, null, 2) +
        "\n",
    )
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), `# Report\n\n${"detail ".repeat(3000)}`)

    const result = await lintReport(worktree, "school", {
      finalHandoff: true,
      minOutlineWordsPerPage: 10,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("reports/report-outline.md target_pages is too small: 12, expected at least 75")
  })

  test("report outline cannot shrink below the school-laptop-48h page floor", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Report drafting.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID: "school", templateName: "school-laptop-48h", timeBudget: { targetHours: 48 } }, null, 2) +
        "\n",
    )

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 12 })
    const text = await fs.readFile(outline.file, "utf8")

    expect(outline.targetPages).toBe(75)
    expect(text).toContain("- target_pages: 75")
  })

  test("lints missing outline report sections even when total report is long", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      ["# Report", "", "## Methodology", "methodology ".repeat(500)].join("\n"),
    )

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("Executive Summary: outline section is missing")
    expect(result.repairHints).toContain(
      'Add a matching "Executive Summary" heading and section to reports/report.md, then rerun report_lint.',
    )
  })

  test("lints sparse outline report sections even when total report is long", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      [
        "# Report",
        "",
        "## Executive Summary",
        "Too thin.",
        "",
        "## Scope, Authorization, and Methodology",
        "methodology ".repeat(500),
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("Executive Summary: outline section is too sparse: 2 words, expected at least 25")
    expect(result.repairHints).toContain(
      'Expand the "Executive Summary" section in reports/report.md by at least 123 additional evidence-backed words, then rerun report_lint; do not make tiny incremental edits.',
    )
  })

  test("counts child subsections toward authored outline section budgets", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    const filler = (label: string) => `${label} ${"evidence backed narrative ".repeat(20)}`
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      [
        "# Report",
        "",
        "## Executive Summary",
        filler("Executive summary"),
        "",
        "## Scope, Authorization, and Methodology",
        filler("Methodology"),
        "",
        "## Environment Overview",
        filler("Environment"),
        "",
        "## Attack Path Narrative",
        filler("Attack path"),
        "",
        "## Findings Detail",
        "Intro.",
        "",
        "### weak-mfa-coverage: Weak MFA coverage",
        filler("Finding detail"),
        "",
        "## Risk Register and Prioritized Roadmap",
        filler("Roadmap"),
        "",
        "## Coverage, Browser Evidence, and Testing Limits",
        filler("Coverage"),
        "",
        "## Validation Limits and Known Unknowns",
        filler("Validation"),
        "",
        "## Evidence Map",
        filler("Evidence"),
        "",
        "## Operator Handoff Checklist",
        filler("Handoff"),
        "",
        "## Appendix: Raw Evidence Index",
        filler("Appendix"),
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })
    expect(result.gaps).not.toContain("Findings Detail: outline section is too sparse: 1 words, expected at least 25")
    expect(result.ok).toBe(true)
  })

  test("lints sparse per-finding report sections even when total report is long", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report.md"),
      [
        "# Report",
        "",
        "## Methodology",
        "methodology ".repeat(150),
        "",
        "## Weak MFA coverage",
        "Admins lack MFA.",
      ].join("\n"),
    )

    const result = await lintReport(worktree, "school", {
      requireReport: true,
      minWords: 100,
      requireFindingSections: true,
      minFindingWords: 50,
    })
    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("weak-mfa-coverage: report section is too sparse: 3 words, expected at least 50")
    expect(result.repairHints).toContain(
      "Expand the finding section for weak-mfa-coverage by at least 147 additional evidence-backed words, preserving evidence references; do not make tiny incremental edits.",
    )
  })

  test("reads operation status for resumable runs", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
    })

    const status = await readOperationStatus(worktree, "school")
    expect(status.operation?.stage).toBe("validation")
    expect(status.findings.total).toBe(0)
    expect(status.lastEvents).toHaveLength(1)
  })

  test("reads operation graph and lane proof health in operation status", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon running.",
    })
    const graph = await writeOperationGraph(worktree, { operationID: "school", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes.find((lane: { id: string }) => lane.id === "recon").status = "complete"
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2))

    const status = await readOperationStatus(worktree, "school")

    expect(status.graph?.lanes.byStatus.complete).toBe(1)
    expect(status.graph?.lanes.missingProofs).toContain("recon")
  })

  test("explains invalid lane completion proof details in status and final handoff lint", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Handoff running.",
    })
    const graph = await writeOperationGraph(worktree, { operationID: "school", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes.find((lane: { id: string }) => lane.id === "recon").status = "complete"
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2))
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "lane-complete"), { recursive: true })
    await fs.writeFile(
      path.join(root, "lane-complete", "recon.json"),
      JSON.stringify(
        {
          laneID: "recon",
          artifacts: ["evidence/raw/missing.xml"],
        },
        null,
        2,
      ),
    )

    const status = await readOperationStatus(worktree, "school")
    const lint = await lintReport(worktree, "school", { finalHandoff: true })

    expect(status.graph?.lanes.invalidProofs).toContain("recon")
    expect(status.graph?.lanes.invalidProofReasons.recon).toContain("operationID must be school")
    expect(status.graph?.lanes.invalidProofReasons.recon).toContain("status must be complete")
    expect(lint.gaps).toContainEqual(
      expect.stringContaining(
        "operation lane recon has invalid completion proof: operationID must be school; status must be complete; summary is required; artifact is missing or empty: evidence/raw/missing.xml",
      ),
    )
  })

  test("lists operation statuses for CLI dashboards", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "beta",
      objective: "Beta school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon running.",
    })
    await writeOperationCheckpoint(worktree, {
      operationID: "alpha",
      objective: "Alpha school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Handoff complete.",
    })

    const statuses = await listOperationStatuses(worktree)
    expect(statuses.map((status) => status.operationID)).toEqual(["alpha", "beta"])
    expect(statuses[0]?.operation?.status).toBe("complete")
    expect(statuses[1]?.operation?.stage).toBe("recon")
  })

  test("includes session bindings in operation status for chat-scoped desktop panels", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon running.",
    })
    await bindOperationSession(worktree, {
      sessionID: "chat-1" as any,
      operationID: "school",
      source: "operation_goal",
      now: "2026-05-09T12:00:00.000Z",
    })

    const status = await readOperationStatus(worktree, "school")

    expect(status.sessions).toEqual([
      {
        sessionID: "chat-1",
        operationID: "school",
        source: "operation_goal",
        boundAt: "2026-05-09T12:00:00.000Z",
      },
    ])
  })

  test("pauses active operations from the desktop close action", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
      blockers: ["waiting for scope window"],
      activeTasks: ["task-1"],
    })

    const result = await closeOperationStatuses(worktree)
    const status = await readOperationStatus(worktree, "school")

    expect(result.closed).toEqual(["school"])
    expect(status.operation?.status).toBe("paused")
    expect(status.operation?.blockers).toEqual(["waiting for scope window"])
    expect(status.operation?.activeTasks).toEqual([])
  })

  test("formats a compact operation status dashboard", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      riskLevel: "high",
      summary: "Validation running.",
      nextActions: ["Promote confirmed findings"],
      blockers: ["Waiting on VPN window"],
      activeTasks: ["task-recon-1"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 3, byModel: { "gpt-5.5": 2, "gpt-5.4-mini": 1 } },
      usage: { totalTokens: 4200, costUSD: 0.75, remainingUSD: 9.25 },
      backgroundTasks: [
        { id: "task-recon-1", agent: "recon", status: "running", summary: "Enumerating login surface." },
      ],
      notes: ["runtime blind spot: background task task-old has no readable session ledger."],
    })

    const dashboard = formatOperationStatusDashboard(await readOperationStatus(worktree, "school"))
    expect(dashboard).toContain("school - validation/running")
    expect(dashboard).toContain("risk: high")
    expect(dashboard).toContain("findings: 1 total")
    expect(dashboard).toContain("evidence: 1 total")
    expect(dashboard).toContain("runtime: 3 calls, 4200 tokens, $0.75")
    expect(dashboard).toContain("models: gpt-5.5=2, gpt-5.4-mini=1")
    expect(dashboard).toContain("- task-recon-1 running (recon)")
    expect(dashboard).toContain("runtime_notes:")
    expect(dashboard).toContain("- runtime blind spot: background task task-old has no readable session ledger.")
    expect(dashboard).toContain("blockers:")
  })

  test("renders final report deliverables", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Testing identified one report-ready finding.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      assumptions: ["Testing is authorized."],
      phases: [
        {
          stage: "reporting",
          objective: "Finalize report.",
          actions: ["Render deliverables"],
          successCriteria: ["Manifest includes handoff artifacts"],
          subagents: ["report-writer"],
          noSubagents: ["risk acceptance"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Legacy TLS suspicion",
      state: "rejected",
      severity: "medium",
      confidence: 0.2,
      affectedAssets: ["vpn.example.edu"],
      evidence: [],
      description: "Initial suspicion was rejected during validation.",
    })
    await writePersonProfile(worktree, {
      operationID: "school",
      name: "Avery Stone",
      role: "District administrator",
      organization: "Example District",
      roleCategory: "technology",
      whyTheyMatter: "Owns privileged access remediation.",
      likelyAccess: ["Identity provider administration"],
      publicContacts: [],
      sources: [{ title: "role export", path: "evidence/raw/role.txt", summary: "Professional role context only." }],
      validationIdeas: ["Review privileged access ownership."],
      excludedPrivateInfo: ["Home address and family details are out of scope and were not collected."],
    })

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const html = await fs.readFile(result.html, "utf8")
    expect(html).toContain("Weak MFA coverage")
    expect(html).toContain("Evidence Index")
    expect(html).toContain("Legacy TLS suspicion")
    expect(html).toContain('role="doc-toc"')
    expect(html).toContain("Table Of Contents")
    expect(html).toContain("report-cover")
    expect(html).toContain("metric-card")
    expect(html).toContain("roadmap-card")
    expect(html).toContain("evidence-card")
    expect(html).not.toContain("<thead><tr><th>Candidate</th>")
    const pdf = await fs.readFile(result.pdf, "utf8")
    expect(pdf).toStartWith("%PDF-")
    expect(pdf).toContain("Scope, Authorization, and Methodology")
    expect(pdf).toContain("Risk Register and Prioritized Roadmap")
    const readme = await fs.readFile(result.readme, "utf8")
    expect(readme).toContain("Assessment Report")
    expect(readme).toContain("Non-Reportable Findings")
    expect(readme).toContain("findings.json")
    const findingsJson = JSON.parse(await fs.readFile(result.findingsJson, "utf8"))
    expect(findingsJson.reportable[0]?.findingID).toBe("weak-mfa-coverage")
    expect(findingsJson.retained[0]?.findingID).toBe("legacy-tls-suspicion")
    const evidenceIndex = JSON.parse(await fs.readFile(result.evidenceIndex, "utf8"))
    expect(evidenceIndex.evidence[0]?.referencedBy).toEqual(["weak-mfa-coverage"])
    expect(await fs.readFile(result.operatorReview, "utf8")).toContain("runtime summary present: no")
    expect(await fs.readFile(result.executiveSummary, "utf8")).toContain("Weak MFA coverage")
    expect(await fs.readFile(result.technicalAppendix, "utf8")).toContain("ev-1")
    expect(await fs.readFile(result.boardReport, "utf8")).toContain("Recommended Board Actions")
    expect(await fs.readFile(result.boardReportPdf, "utf8")).toStartWith("%PDF-")
    expect(await fs.readFile(result.cehTechnicalReport, "utf8")).toContain("CEH Technical Report")
    expect(await fs.readFile(result.cehTechnicalReportPdf, "utf8")).toStartWith("%PDF-")
    expect(await fs.readFile(result.ulmTeamReport, "utf8")).toContain("Harness Run State")
    expect(await fs.readFile(result.ulmTeamReportPdf, "utf8")).toStartWith("%PDF-")
    expect(await fs.readFile(result.runtimeSummaryMarkdown, "utf8")).toContain("No runtime summary was recorded")
    const peopleProfiles = await fs.readFile(path.join(result.finalDir, "people-profiles.md"), "utf8")
    expect(peopleProfiles).toContain("District administrator")
    expect(peopleProfiles).not.toContain("Home address")
    const manifest = JSON.parse(await fs.readFile(result.manifest, "utf8"))
    expect(manifest.findings).toEqual(["weak-mfa-coverage"])
    expect(manifest.nonReportableFindings).toEqual(["legacy-tls-suspicion"])
    expect(manifest.artifacts.operationPlan).toContain("operation-plan.json")
    expect(manifest.artifacts.findingsJson).toBe(result.findingsJson)
    expect(manifest.artifacts.evidenceIndex).toBe(result.evidenceIndex)
    expect(manifest.artifacts.operatorReview).toBe(result.operatorReview)
    expect(manifest.artifacts.executiveSummary).toBe(result.executiveSummary)
    expect(manifest.artifacts.technicalAppendix).toBe(result.technicalAppendix)
    expect(manifest.artifacts.boardReport).toBe(result.boardReport)
    expect(manifest.artifacts.boardReportPdf).toBe(result.boardReportPdf)
    expect(manifest.artifacts.cehTechnicalReport).toBe(result.cehTechnicalReport)
    expect(manifest.artifacts.cehTechnicalReportPdf).toBe(result.cehTechnicalReportPdf)
    expect(manifest.artifacts.ulmTeamReport).toBe(result.ulmTeamReport)
    expect(manifest.artifacts.ulmTeamReportPdf).toBe(result.ulmTeamReportPdf)
    expect(manifest.artifacts.runtimeSummaryMarkdown).toBe(result.runtimeSummaryMarkdown)
    expect(manifest.counts.findings).toBe(2)
    expect(manifest.counts.reportableFindings).toBe(1)
    expect(manifest.counts.byState.rejected).toBe(1)
    expect(manifest.counts.evidence).toBe(1)
    const status = await readOperationStatus(worktree, "school")
    expect(status.reports.pdf).toBe(true)
    expect(status.reports.readme).toBe(true)
    expect(status.reports.manifest).toBe(true)

    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 5, byModel: { "gpt-5.5": 5 } },
      compaction: { count: 0, pressure: "low" },
      fetches: { total: 2, repeatedTargets: [] },
      backgroundTasks: [],
    })
    expect(await fs.readFile(result.runtimeSummaryMarkdown, "utf8")).toContain("gpt-5.5")
    const rerendered = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    expect(await fs.readFile(rerendered.runtimeSummaryMarkdown, "utf8")).toContain("gpt-5.5")
    await completeGraphForHandoff(worktree)
    const handoffLint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(handoffLint.ok).toBe(true)

    if (result.manifest.startsWith("/var/")) {
      const privateVarManifest = JSON.parse(await fs.readFile(result.manifest, "utf8"))
      for (const [key, value] of Object.entries(privateVarManifest.artifacts)) {
        if (typeof value === "string" && value.startsWith("/var/")) {
          privateVarManifest.artifacts[key] = value.replace(/^\/var\//, "/private/var/")
        }
      }
      await fs.writeFile(result.manifest, JSON.stringify(privateVarManifest, null, 2) + "\n")
      const privateVarLint = await lintReport(worktree, "school", { finalHandoff: true })
      expect(privateVarLint.ok).toBe(true)
    }
  })

  test("final package integrity accepts evidence references matched by path", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "normalized-text-ev-1-json",
      title: "Normalized IdP policy export",
      kind: "note",
      summary: "Normalized MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const rendered = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const evidenceIndex = JSON.parse(await fs.readFile(rendered.evidenceIndex, "utf8"))
    expect(evidenceIndex.evidence.find((item: { id: string }) => item.id === "normalized-text-ev-1-json")?.referencedBy).toEqual([
      "weak-mfa-coverage",
    ])

    const lint = await lintReport(worktree, "school", { requireRenderedDeliverables: true })

    expect(lint.gaps).not.toContain(
      "deliverables/final/evidence-index.json normalized-text-ev-1-json referencedBy does not match findings.json",
    )
  })

  test("quarantines authored raw credential material outside final reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await fs.mkdir(path.join(worktree, ".ulmcode", "operations", "school", "reports"), { recursive: true })
    await fs.writeFile(
      path.join(worktree, ".ulmcode", "operations", "school", "reports", "report.md"),
      "# Report\n\nThe appendix includes genesis password: Summer2026!",
    )

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })

    expect(await fs.readFile(result.html, "utf8")).not.toContain("Summer2026")
    expect(
      await fs.readFile(path.join(worktree, ".ulmcode", "operations", "school", "deliverables", "internal-review", "sensitive-leads.md"), "utf8"),
    ).toContain("Summer2026")
  })

  test("quarantines authored private dossier and destructive exploit claims outside final reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    await fs.mkdir(path.join(worktree, ".ulmcode", "operations", "school", "reports"), { recursive: true })
    await fs.writeFile(
      path.join(worktree, ".ulmcode", "operations", "school", "reports", "report.md"),
      "# Report\n\nThe person_profile section lists a home address. We ran the exploit against production and changed grades.",
    )

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })

    const html = await fs.readFile(result.html, "utf8")
    expect(html).not.toContain("home address")
    expect(html).not.toContain("changed grades")
    const internalReview = await fs.readFile(
      path.join(worktree, ".ulmcode", "operations", "school", "deliverables", "internal-review", "sensitive-leads.md"),
      "utf8",
    )
    expect(internalReview).toContain("home address")
    expect(internalReview).toContain("changed grades")
  })

  test("quarantines generated private dossier details outside final reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    const operationPath = path.join(worktree, ".ulmcode", "operations", "school", "operation.json")
    const operation = JSON.parse(await fs.readFile(operationPath, "utf8"))
    operation.summary = "The stakeholder packet includes a home address from unrelated personal social media."
    await fs.writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`)
    await fs.mkdir(path.join(worktree, ".ulmcode", "operations", "school", "reports"), { recursive: true })
    await fs.writeFile(
      path.join(worktree, ".ulmcode", "operations", "school", "reports", "report.md"),
      "# Report\n\nClean authored report body.",
    )

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })

    expect(await fs.readFile(result.executiveSummary, "utf8")).not.toContain("home address")
    const internalReview = await fs.readFile(
      path.join(worktree, ".ulmcode", "operations", "school", "deliverables", "internal-review", "sensitive-leads.md"),
      "utf8",
    )
    expect(internalReview).toContain("home address")
  })

  test("quarantines generated destructive exploit claims outside final reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "Reporting started.",
    })
    const operationPath = path.join(worktree, ".ulmcode", "operations", "school", "operation.json")
    const operation = JSON.parse(await fs.readFile(operationPath, "utf8"))
    operation.summary = "The team ran the exploit against production and changed grades."
    await fs.writeFile(operationPath, `${JSON.stringify(operation, null, 2)}\n`)
    await fs.mkdir(path.join(worktree, ".ulmcode", "operations", "school", "reports"), { recursive: true })
    await fs.writeFile(
      path.join(worktree, ".ulmcode", "operations", "school", "reports", "report.md"),
      "# Report\n\nClean authored report body.",
    )

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })

    expect(await fs.readFile(result.executiveSummary, "utf8")).not.toContain("changed grades")
    const internalReview = await fs.readFile(
      path.join(worktree, ".ulmcode", "operations", "school", "deliverables", "internal-review", "sensitive-leads.md"),
      "utf8",
    )
    expect(internalReview).toContain("changed grades")
  })

  test("quarantines unsafe generated content for internal CEH review instead of putting it in final reports", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "reporting",
      status: "running",
      summary: "The team ran the exploit against production and changed grades.",
    })
    await fs.mkdir(path.join(worktree, ".ulmcode", "operations", "school", "reports"), { recursive: true })
    await fs.writeFile(
      path.join(worktree, ".ulmcode", "operations", "school", "reports", "report.md"),
      "# Report\n\nClean authored report body.",
    )

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })

    expect(await fs.readFile(result.executiveSummary, "utf8")).not.toContain("changed grades")
    expect(await fs.readFile(result.technicalAppendix, "utf8")).not.toContain("changed grades")
    const internalReview = await fs.readFile(
      path.join(worktree, ".ulmcode", "operations", "school", "deliverables", "internal-review", "sensitive-leads.md"),
      "utf8",
    )
    expect(internalReview).toContain("deliverables/final/executive-summary.md")
    expect(internalReview).toContain("changed grades")
  })

  test("final handoff lint rejects corrupt rendered package integrity", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Testing identified one report-ready finding.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      assumptions: ["Testing is authorized."],
      phases: [
        {
          stage: "reporting",
          objective: "Finalize report.",
          actions: ["Render deliverables"],
          successCriteria: ["Manifest includes handoff artifacts"],
          subagents: ["report-writer"],
          noSubagents: ["risk acceptance"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 5, byModel: { "gpt-5.5": 5 } },
      compaction: { count: 0, pressure: "low" },
      fetches: { total: 2, repeatedTargets: [] },
      backgroundTasks: [],
    })
    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const renderedPdf = await fs.readFile(result.pdf, "utf8")
    expect(renderedPdf).toContain("/ULMCodeRenderer (styled-html)")
    expect(renderedPdf).toContain(" re f")
    await completeGraphForHandoff(worktree)

    const cleanLint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(cleanLint.ok).toBe(true)

    await fs.writeFile(result.pdf, "not a pdf\n")
    let lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/report.pdf is not a readable PDF")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(result.boardReportPdf, "not a pdf\n")
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/board-report.pdf is not a readable PDF")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(result.pdf, "%PDF-1.4\n1 0 obj\n<< /BaseFont /Helvetica >>\nendobj\n%%EOF\n")
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/report.pdf was rendered by the legacy text-only renderer")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(
      result.pdf,
      "%PDF-1.4\n% /ULMCodeRenderer (styled-html)\n2 0 obj\n<< /Type /Pages /Kids [] /Count 1 >>\nendobj\n%%EOF\n",
    )
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.gaps).not.toContain("deliverables/final/report.pdf has 1 pages, expected at least 2")
    lint = await lintReport(worktree, "school", { finalHandoff: true, minPdfPages: 2 })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/report.pdf has 1 pages, expected at least 2")
    expect(lint.repairHints).toContain(
      "Main PDF is 1 page short. Add at least 450 words of substantive stakeholder-useful appendix, remediation, validation, or operator-handoff content to reports/report.md, then run report_render and rerun report_lint with the same gates. Do not add blank, reserved, placeholder, or render-padding pages.",
    )
    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true, minPdfPages: 2 })
    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain("final_handoff: deliverables/final/report.pdf has 1 pages, expected at least 2")
    expect(audit.checks.finalHandoff.gates?.minPdfPages).toBe(2)

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(
      result.cehTechnicalReportPdf,
      "%PDF-1.4\n% /ULMCodeRenderer (styled-html)\n%%EOF\n",
    )
    lint = await lintReport(worktree, "school", { finalHandoff: true, minPdfPages: 2 })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/ceh-technical-report.pdf page count could not be read")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(
      result.ulmTeamReportPdf,
      "%PDF-1.4\n% /ULMCodeRenderer (styled-html)\n2 0 obj\n<< /Type /Pages /Kids [] /Count 1 >>\nendobj\n%%EOF\n",
    )
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/ulm-team-report.pdf has 1 pages, expected at least 2")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(
      result.manifest,
      JSON.stringify({ operationID: "school", artifacts: { html: "/tmp/missing.html" }, counts: {} }, null, 2),
    )
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/manifest.json missing artifact path: pdf")
    expect(lint.gaps).toContain("deliverables/final/manifest.json artifact html does not match report.html")
    expect(lint.repairHints).toContain(
      "Rendered final package artifacts are out of sync. Do not hand-edit deliverables/final generated files; fix source artifacts if needed, run report_render, then run runtime_summary and report_lint again.",
    )

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const escapedBoardPdf = path.join(path.dirname(result.boardReportPdf), "..", "board-report.pdf")
    await fs.writeFile(escapedBoardPdf, await fs.readFile(result.boardReportPdf, "utf8"))
    const escapedManifest = JSON.parse(await fs.readFile(result.manifest, "utf8"))
    escapedManifest.artifacts.boardReportPdf = "../board-report.pdf"
    await fs.writeFile(result.manifest, JSON.stringify(escapedManifest, null, 2) + "\n")
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/manifest.json artifact boardReportPdf does not match board-report.pdf")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const copiedBoardReport = (await fs.readFile(result.boardReport, "utf8")).replace("Operation: school", "Operation: other-school")
    await fs.writeFile(result.boardReport, copiedBoardReport)
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/board-report.md operationID does not match operation")
    expect(lint.repairHints).toContain(
      "Rendered final package artifacts are out of sync. Do not hand-edit deliverables/final generated files; fix source artifacts if needed, run report_render, then run runtime_summary and report_lint again.",
    )

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(result.executiveSummary, "# Executive Summary\n\nIncludes a home address.\n")
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/executive-summary.md contains private-life dossier details")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(result.cehTechnicalReport, "# CEH Technical Report\n\nWe dumped student records to prove impact.\n")
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/ceh-technical-report.md contains destructive exploit execution claims")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(result.boardReport, "# Board Report\n\nToo short.\n")
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain(
      "deliverables/final/board-report.md is missing required section: ## Recommended Board Actions",
    )

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const manifest = JSON.parse(await fs.readFile(result.manifest, "utf8"))
    manifest.counts.reportableFindings = 99
    manifest.findings = ["invented-finding"]
    manifest.evidence = []
    await fs.writeFile(result.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/manifest.json reportableFindings count does not match findings.json")
    expect(lint.gaps).toContain("deliverables/final/manifest.json findings list does not match findings.json")
    expect(lint.gaps).toContain("deliverables/final/manifest.json evidence list does not match evidence-index.json")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await fs.writeFile(result.html, "<!doctype html><html><body>empty</body></html>\n")
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/report.html is missing required content: school")
    expect(lint.gaps).toContain("deliverables/final/report.html is missing required content: Finding State Counts")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const findingsJson = JSON.parse(await fs.readFile(result.findingsJson, "utf8"))
    findingsJson.operationID = "copied-other-operation"
    await fs.writeFile(result.findingsJson, `${JSON.stringify(findingsJson, null, 2)}\n`)
    const evidenceIndex = JSON.parse(await fs.readFile(result.evidenceIndex, "utf8"))
    evidenceIndex.operationID = "copied-other-operation"
    await fs.writeFile(result.evidenceIndex, `${JSON.stringify(evidenceIndex, null, 2)}\n`)
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/findings.json operationID does not match operation")
    expect(lint.gaps).toContain("deliverables/final/evidence-index.json operationID does not match operation")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const finalFindings = JSON.parse(await fs.readFile(result.findingsJson, "utf8"))
    finalFindings.reportable[0].evidence = [{ id: "missing-ev" }]
    await fs.writeFile(result.findingsJson, `${JSON.stringify(finalFindings, null, 2)}\n`)
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/findings.json weak-mfa-coverage references missing evidence missing-ev")

    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const tamperedEvidenceIndex = JSON.parse(await fs.readFile(result.evidenceIndex, "utf8"))
    tamperedEvidenceIndex.evidence[0].referencedBy = []
    await fs.writeFile(result.evidenceIndex, `${JSON.stringify(tamperedEvidenceIndex, null, 2)}\n`)
    lint = await lintReport(worktree, "school", { finalHandoff: true })
    expect(lint.ok).toBe(false)
    expect(lint.gaps).toContain("deliverables/final/evidence-index.json ev-1 referencedBy does not match findings.json")
  })

  test("rendered reports satisfy outline section lint", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Testing identified one report-ready finding.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      assumptions: ["Testing is authorized."],
      phases: [
        {
          stage: "reporting",
          objective: "Finalize report.",
          actions: ["Render deliverables"],
          successCriteria: ["Manifest includes handoff artifacts"],
          subagents: ["report-writer"],
          noSubagents: ["risk acceptance"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export shows privileged enforcement is optional.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await writeRuntimeSummary(worktree, { operationID: "school" })
    await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    await completeGraphForHandoff(worktree)

    const lint = await lintReport(worktree, "school", {
      finalHandoff: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 15,
    })

    expect(lint.ok).toBe(true)
  })

  test("renders and audits a synthetic 50-page final report package", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized 48-hour school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Long-form synthetic handoff is ready for review.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      planningApproval: {
        status: "approved",
        discoveryCharterPath: ".ulmcode/operations/school/plans/discovery-charter.json",
        approver: "test-operator",
        notes: ["Synthetic 50-page report package proof approved for deterministic testing."],
      },
      discoveryCharter: {
        purpose: "Prove the long-run report package can satisfy 48-hour handoff gates.",
        researchQuestions: ["Can synthetic evidence produce a 50-page final package?"],
        reconInvestments: ["Use recorded synthetic evidence only."],
        operatorQuestions: ["Confirm this is a deterministic test fixture."],
        candidateDeepWorkLanes: ["Long report drafting", "CEH review", "Board summary"],
        decisionCriteriaForFullPlan: ["Final handoff audit passes with 50-page gates."],
      },
      timeBudget: {
        targetHours: 48,
        finalizationWindowHours: 4,
        allocations: [
          { stage: "recon", hours: 12, work: "Map authorized school network and identity surfaces." },
          { stage: "validation", hours: 28, work: "Validate chained findings with bounded non-destructive evidence." },
          { stage: "reporting", hours: 8, work: "Produce board, CEH, and ULMCode handoff reports." },
        ],
        durationFit: {
          confidence: "duration_sized",
          evidence: ["Synthetic long-report proof exercises a 50-page final handoff gate."],
          overflowBacklog: ["Continue lower-priority validation lanes only after protected finalization starts."],
        },
        executionBlocks: executionBlocks({ minutes: 44 * 60, laneID: "finding_validation", stage: "validation" }),
      },
      coverageContract: {
        status: "released",
        goals: ["Synthetic long report package is complete."],
        minimumEvidence: ["Report-ready finding, evidence, runtime summary, graph proofs, and final deliverables exist."],
        requiredLanes: ["reporting"],
        allowedSkippedLanes: [],
        fallbackRules: ["No fallback required for deterministic report fixture."],
        retryRules: ["Re-render report if PDF page count is short."],
        subagentOpportunities: ["Report writer", "CEH reviewer", "Board reviewer"],
        reportGates: ["report_lint finalHandoff=true", "operation_audit finalHandoff=true"],
        releaseNotes: ["Synthetic long-report package released by test fixture."],
      },
      phases: [
        {
          stage: "reporting",
          objective: "Finalize the synthetic long report package.",
          actions: ["Run report_lint", "Run report_render", "Run operation_audit"],
          successCriteria: ["50-page PDF and stakeholder reports pass final handoff lint"],
          subagents: ["report-writer", "ceh-reviewer", "board-report-reviewer"],
          noSubagents: ["operator approval"],
        },
      ],
      reportingCloseout: [
        "Run report_lint finalHandoff=true",
        "Run report_render",
        "Run runtime_summary",
        "Run operation_audit",
      ],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Synthetic IdP policy export",
      kind: "file",
      summary: "Synthetic policy export supports the privileged MFA finding.",
      path: "evidence/raw/synthetic-idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak privileged MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["Synthetic IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/synthetic-idp-policy.json" }],
      description: "The synthetic policy export shows privileged MFA is optional for administrators.",
      impact: "Administrator session compromise is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts and sensitive exports.",
    })
    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 50 })
    const outlineBody = await fs.readFile(outline.file, "utf8")
    expect(outlineBody).toContain("- design_profile: premium")
    expect(outlineBody).toContain("Tables are for compact comparable data")
    const sectionTitles = Array.from(outlineBody.matchAll(/^\s*-\s+(.+):\s*\d+\s+pages?\b/gim)).map(
      (match) => match[1]!,
    )
    const sectionText = [
      "validated evidence-backed observation",
      "authorized methodology",
      "bounded non-destructive validation",
      "remediation sequencing",
      "residual risk",
      "operator handoff",
      "stakeholder decision context",
      "technical appendix detail",
    ].join(" ")
    const reportBody = [
      "# Synthetic 50 Page Final Report",
      "",
      ...sectionTitles.flatMap((title) => [
        `## ${title}`,
        "",
        `${sectionText} `.repeat(350),
        "",
      ]),
    ].join("\n")
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), reportBody)
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 24, byModel: { "gpt-5.5": 18, "gpt-5.4-mini": 6 } },
      usage: { totalTokens: 250000, costUSD: 12, remainingUSD: 18 },
      compaction: { count: 2, pressure: "moderate" },
      fetches: { total: 40, repeatedTargets: [] },
      backgroundTasks: [
        {
          id: "report:long-form",
          agent: "report-writer",
          status: "stale",
          summary: "Report writer lost its runtime ledger after final package render.",
        },
      ],
      notes: [
        "runtime blind spot: background task report:long-form (report-writer) has no readable session ledger or runtime snapshot; token/cost totals may be undercounted.",
      ],
    })
    const rendered = await renderReport(worktree, { operationID: "school", title: "Synthetic 50 Page Final Report" })
    await completeGraphForHandoff(worktree)

    const audit = await buildOperationAudit(worktree, "school", {
      finalHandoff: true,
      requireOutlineBudget: true,
      requireOutlineSections: true,
      minOutlineTargetPages: 50,
      minOutlineWordsPerPage: 20,
      minOutlineSectionWords: 200,
      minPdfPages: 50,
    })

    expect(audit.blockers).toEqual([])
    expect(audit.ok).toBe(true)
    expect(audit.checks.resume.ok).toBe(true)
    expect(audit.checks.finalHandoff.gates?.minOutlineTargetPages).toBe(50)
    expect(audit.checks.finalHandoff.gates?.minPdfPages).toBe(50)
    expect(await fs.readFile(rendered.boardReportPdf, "utf8")).toStartWith("%PDF-")
    expect(await fs.readFile(rendered.cehTechnicalReportPdf, "utf8")).toStartWith("%PDF-")
    expect(await fs.readFile(rendered.ulmTeamReportPdf, "utf8")).toStartWith("%PDF-")
  })

  test("rendered reports preserve authored report markdown", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Testing identified one report-ready finding.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      phases: [
        {
          stage: "reporting",
          objective: "Finalize authored report.",
          actions: ["Run report_lint", "Run report_render", "Run runtime_summary"],
          successCriteria: ["Authored report content is preserved"],
          subagents: ["report-writer"],
          noSubagents: ["handoff approval"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 2 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      [
        "# Authored Assessment Report",
        "",
        "## Custom Risk Narrative",
        "",
        "This authored report should survive report_render instead of being replaced by the synthetic template.",
        "",
        "## Findings Detail",
        "",
        "### weak-mfa-coverage: Weak MFA coverage",
        "",
        "This authored finding section should render as a designed finding card, not as plain loose prose.",
      ].join("\n"),
    )

    const result = await renderReport(worktree, { operationID: "school", title: "Assessment Report" })
    const html = await fs.readFile(result.html, "utf8")
    const pdf = await fs.readFile(result.pdf, "utf8")

    expect(html).toContain("Custom Risk Narrative")
    expect(html).toContain("This authored report should survive report_render")
    expect(html).toContain("authored-section authored-general")
    expect(html).toContain("authored-section authored-findings-detail")
    expect(html).toContain("finding authored-finding")
    expect(pdf).toContain("Custom Risk Narrative")
  })

  test("writes runtime summaries for long operation handoff", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
      nextActions: ["Finish exploit reproduction", "Promote confirmed findings"],
      activeTasks: ["task-recon-1"],
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 12, byModel: { "gpt-5.5": 8, "gpt-5.4-mini": 4 } },
      usage: {
        inputTokens: 9000,
        outputTokens: 3000,
        reasoningTokens: 1500,
        totalTokens: 13500,
        costUSD: 2.45,
        budgetUSD: 10,
        remainingUSD: 7.55,
        byAgent: {
          pentest: { calls: 5, totalTokens: 8000, costUSD: 1.6 },
          recon: { calls: 7, totalTokens: 5500, costUSD: 0.85 },
        },
      },
      compaction: { count: 2, pressure: "moderate", lastSummary: "Earlier recon was compacted." },
      fetches: { total: 9, repeatedTargets: ["https://example.edu/login"] },
      backgroundTasks: [
        { id: "task-recon-1", agent: "recon", status: "running", summary: "Enumerating login surface." },
      ],
      notes: ["Continue from operation_status before launching new lanes."],
    })

    expect(JSON.parse(await fs.readFile(result.json, "utf8")).modelCalls.byModel["gpt-5.5"]).toBe(8)
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).usage.byAgent.pentest.totalTokens).toBe(8000)
    const markdown = await fs.readFile(result.markdown, "utf8")
    expect(markdown).toContain("task-recon-1")
    expect(markdown).toContain("tokens_total: 13500")
    expect(markdown).toContain("pentest: 5 calls, 8000 tokens, $1.6")
    const status = await readOperationStatus(worktree, "school")
    expect(status.runtimeSummary).toBe(true)
    expect(status.runtime?.usage?.remainingUSD).toBe(7.55)
    expect(status.runtime?.backgroundTasks?.[0]?.id).toBe("task-recon-1")
  })

  test("rejects raw credential secrets in runtime summaries", async () => {
    const worktree = await tmpdir()

    await expect(
      writeRuntimeSummary(worktree, {
        operationID: "school",
        notes: ["Operator pasted genesis password: Summer2026! before vault handoff."],
      }),
    ).rejects.toThrow("runtime summaries must not contain raw credential secrets")
  })

  test("builds restart-ready operation resume briefs", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
      nextActions: ["Finish exploit reproduction", "Promote confirmed findings"],
      activeTasks: ["task-recon-1"],
    })
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      modelCalls: { total: 3, byModel: { "gpt-5.5": 2, "gpt-5.4-mini": 1 } },
      usage: { totalTokens: 4200, costUSD: 0.85 },
      backgroundTasks: [
        { id: "task-recon-1", agent: "recon", status: "running", summary: "Enumerating login surface." },
      ],
    })

    const brief = await buildOperationResumeBrief(worktree, "school")
    expect(brief.operationID).toBe("school")
    expect(brief.checkpoint?.stage).toBe("validation")
    expect(brief.health.ready).toBe(false)
    expect(brief.health.gaps).toContain("operation plan is missing")
    expect(brief.recommendedTools).toContain("operation_status")
    expect(brief.recommendedTools).toContain("operation_plan")
    expect(brief.recommendedTools).toContain("task_list")
    expect(brief.recommendedTools).toContain("task_status")
    expect(brief.continuationPrompt).toContain("Resume ULMCode operation school")
    expect(brief.continuationPrompt).toContain("Finish exploit reproduction")

    const markdown = formatOperationResumeBrief(brief)
    expect(markdown).toStartWith("# Resume school")
    expect(markdown).toContain("health: attention_required")
    expect(markdown).toContain("task-recon-1 running (recon) - Enumerating login surface.")
    expect(markdown).toContain("operation_status")
    expect(markdown).toContain("task_list operationID=school")
  })

  test("marks stale running operations and tasks in resume briefs", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
      nextActions: ["Check stale subagent output"],
      activeTasks: ["task-recon-1"],
    })
    const operationFile = path.join(worktree, ".ulmcode", "operations", "school", "operation.json")
    const operation = JSON.parse(await fs.readFile(operationFile, "utf8"))
    operation.time.updated = "2026-05-05T12:00:00.000Z"
    await fs.writeFile(operationFile, JSON.stringify(operation, null, 2) + "\n")
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      backgroundTasks: [
        {
          id: "task-recon-1",
          agent: "recon",
          status: "stale",
          summary: "No heartbeat after scan launch.",
          restartArgs: {
            task_id: "task-recon-1",
            background: true,
            description: "restart recon lane",
            prompt: "resume recon lane",
            subagent_type: "recon",
            operationID: "school",
          },
        },
      ],
    })

    const brief = await buildOperationResumeBrief(worktree, "school", {
      now: "2026-05-05T14:30:00.000Z",
      staleAfterMinutes: 60,
    })

    expect(brief.health.ready).toBe(false)
    expect(brief.health.gaps).toContain("operation checkpoint is stale: last update was 150 minutes ago")
    expect(brief.health.gaps).toContain("background task task-recon-1 is stale")
    expect(brief.recommendedTools).toContain("operation_checkpoint")
    expect(brief.recommendedTools).toContain("task_status")
    expect(brief.recommendedTools).toContain("operation_resume")
    expect(brief.recommendedTools).toContain("operation_recover")
    expect(brief.recommendedTools).toContain("task_restart")
    expect(formatOperationResumeBrief(brief)).toContain("operation checkpoint is stale")
    expect(formatOperationResumeBrief(brief)).toContain("operation_resume operationID=school recoverStaleTasks=true")
    expect(formatOperationResumeBrief(brief)).toContain("operation_recover operationID=school")
    expect(formatOperationResumeBrief(brief)).toContain("task_restart task_id=task-recon-1")
    expect(formatOperationResumeBrief(brief)).toContain('"prompt":"resume recon lane"')
    expect(brief.continuationPrompt).toContain("recoverStaleTasks=true")
  })

  test("marks exhausted operation budgets in resume briefs", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
      nextActions: ["Continue validation"],
    })
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      usage: {
        totalTokens: 12_500,
        costUSD: 12.4,
        budgetUSD: 10,
        remainingUSD: -2.4,
      },
    })

    const brief = await buildOperationResumeBrief(worktree, "school")

    expect(brief.health.ready).toBe(false)
    expect(brief.health.gaps).toContain("runtime budget exhausted: spent $12.4 of $10")
    expect(brief.recommendedTools).toContain("runtime_summary")
    expect(formatOperationResumeBrief(brief)).toContain("runtime budget exhausted")
  })

  test("writes durable operation audits for final handoff gates", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
      nextActions: ["Review final package"],
    })

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain("resume: operation plan is missing")
    expect(audit.blockers).toContain("final_handoff: plans/operation-plan.json is required")
    expect(audit.recommendedTools).toContain("operation_plan")
    expect(audit.recommendedTools).toContain("report_lint")
    expect(audit.recommendedTools).toContain("report_render")
    expect(audit.recommendedTools).toContain("runtime_summary")
    expect(JSON.parse(await fs.readFile(audit.files.json, "utf8")).operationID).toBe("school")
    expect(await fs.readFile(audit.files.markdown, "utf8")).toContain("final_handoff: attention_required")
  })

  test("operation audit blocks final handoff when graph lanes are incomplete or missing proof", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const graph = await writeOperationGraph(worktree, { operationID: "school", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    for (const lane of parsed.lanes) lane.status = "complete"
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2))

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain("resume: operation lane recon is missing completion proof")
    expect(audit.blockers).toContain("final_handoff: operation lane recon is missing completion proof")
    expect(audit.recommendedTools[0]).toBe("operation_run")
    expect(formatOperationAudit(audit)).toContain("next_step: Call operation_run before editing reports or plans.")
  })

  test("operation audit forwards strict outline section gates", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      ["# Report", "", "## Methodology", "methodology ".repeat(500)].join("\n"),
    )

    const audit = await buildOperationAudit(worktree, "school", {
      finalHandoff: true,
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })

    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain("final_handoff: Executive Summary: outline section is missing")
    expect(audit.recommendedTools).toContain("report_outline")
  })

  test("operation audit forwards minimum outline target pages", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), `# Report\n\n${"detail ".repeat(1300)}`)

    const audit = await buildOperationAudit(worktree, "school", {
      finalHandoff: true,
      requireOutlineBudget: true,
      minOutlineTargetPages: 50,
      minOutlineWordsPerPage: 10,
    })

    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain(
      "final_handoff: reports/report-outline.md target_pages is too small: 4, expected at least 50",
    )
    expect(audit.checks.finalHandoff.gates?.minOutlineTargetPages).toBe(50)
    expect(audit.recommendedTools).toContain("report_outline")
  })

  test("stage gate promotes structurally complete coverage contracts through the tool path", async () => {
    const worktree = await tmpdir()
    await completeGraphForHandoff(worktree)
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation artifacts are ready for gate review.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Validated evidence",
      kind: "file",
      summary: "Evidence-backed validation artifact.",
      path: "evidence/raw/ev-1.txt",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Evidence-backed issue",
      state: "report_ready",
      severity: "medium",
      confidence: 0.8,
      affectedAssets: ["system"],
      evidence: [{ id: "ev-1", path: "evidence/raw/ev-1.txt" }],
      description: "Synthetic finding.",
      impact: "Synthetic impact.",
      remediation: "Synthetic remediation.",
    })
    await writeCoverageContract(worktree, {
      operationID: "school",
      status: "unmet",
      goals: ["Complete required lanes."],
      minimumEvidence: ["Required lane artifacts."],
      requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
      allowedSkippedLanes: [],
      fallbackRules: ["Record blockers instead of skipping release lanes."],
      retryRules: ["Retry failed report gates before final audit."],
      subagentOpportunities: ["report review"],
      reportGates: ["operation_audit finalHandoff=true"],
    })

    await buildOperationStageGate(worktree, "school", { stage: "validation" })

    const coverage = JSON.parse(
      await fs.readFile(path.join(worktree, ".ulmcode", "operations", "school", "plans", "coverage-contract.json"), "utf8"),
    )
    expect(coverage.status).toBe("met")
  })

  test("final handoff audit does not let weak caller gates bypass long-run outline budget", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school laptop rehearsal",
      stage: "handoff",
      status: "complete",
      summary: "Ready for final handoff review.",
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Synthetic evidence index",
      kind: "file",
      summary: "Synthetic rehearsal evidence.",
      path: "evidence/raw/synthetic.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/synthetic.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 75 })
    await fs.mkdir(path.join(outline.root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(outline.root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          templateName: "school-laptop-48h",
          timeBudget: { targetHours: 48 },
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(outline.root, "reports", "report.md"), `# Report\n\n${"substantive ".repeat(5000)}`)
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await completeGraphForHandoff(worktree)

    const audit = await buildOperationAudit(worktree, "school", {
      finalHandoff: true,
      requireReport: true,
      minWords: 4500,
      requireOutlineBudget: true,
      minOutlineTargetPages: 15,
      minOutlineWordsPerPage: 60,
      minPdfPages: 1,
    })

    expect(audit.ok).toBe(false)
    expect(audit.blockers).toContain("final_handoff: report misses outline budget: 5002 words, expected at least 22500 for 75 target pages")
    expect(audit.checks.finalHandoff.gates?.minOutlineTargetPages).toBe(75)
    expect(audit.checks.finalHandoff.gates?.minPdfPages).toBe(75)
  })

  test("operation audit requires submitted credential review for credentialed plans", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          timeBudget: {
            targetHours: 20,
            allocations: [{ stage: "validation", hours: 18, work: "Use provided credentials for authenticated checks." }],
          },
          phases: [
            {
              actions: ["Use credential vault records for authenticated router and portal validation."],
              successCriteria: ["Credentialed checks cite vault credential IDs only."],
            },
          ],
        },
        null,
        2,
      ) + "\n",
    )

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.checks.credentialHandoff.status).toBe("attention_required")
    expect(audit.blockers).toContain("credential_handoff: credentialed plan requires submitted credential vault review")
    expect(audit.recommendedTools).toContain("operation_credentials")

    const credentialDir = path.join(root, "credentials")
    await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(credentialDir, "review-submission.json"),
      JSON.stringify(
        {
          operationID: "school",
          submittedAt: new Date().toISOString(),
          credentials: [{ credentialID: "router-admin", label: "Router Admin", password: "********", tags: [] }],
          file: path.join(credentialDir, "review-submission.json"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    )

    const reviewed = await buildOperationAudit(worktree, "school", { finalHandoff: true })
    expect(reviewed.checks.credentialHandoff.status).toBe("ready")
    expect(JSON.stringify(reviewed)).not.toContain("router-password")
  })

  test("operation audit requires credential review coverage for plan-named services", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          templateName: "school-laptop-48h",
          timeBudget: { targetHours: 48 },
          phases: [{ actions: ["Use submitted Genesis and Google credentials for authenticated checks."] }],
        },
        null,
        2,
      ) + "\n",
    )
    const credentialDir = path.join(root, "credentials")
    await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(credentialDir, "review-submission.json"),
      JSON.stringify(
        {
          operationID: "school",
          submittedAt: new Date().toISOString(),
          credentials: [{ credentialID: "genesis-test", label: "Genesis SIS test account", password: "********", tags: [] }],
          file: path.join(credentialDir, "review-submission.json"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    )

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.checks.credentialHandoff.status).toBe("attention_required")
    expect(audit.blockers).toContain(
      "credential_handoff: credential review is missing a submitted record for plan service: google",
    )
    expect(audit.checks.credentialHandoff.missingServices).toEqual(["google"])
  })

  test("operation audit rejects malformed credential review indexes for credentialed plans", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          timeBudget: {
            targetHours: 20,
            allocations: [{ stage: "validation", hours: 18, work: "Use provided credentials for authenticated checks." }],
          },
        },
        null,
        2,
      ) + "\n",
    )
    const credentialDir = path.join(root, "credentials")
    await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(credentialDir, "review-submission.json"),
      JSON.stringify(
        {
          operationID: "school",
          submittedAt: new Date().toISOString(),
          credentials: [
            { credentialID: "router-admin", label: "Router Admin", password: "********" },
            { credentialID: "router-admin", label: "", password: "********" },
          ],
          file: path.join(credentialDir, "review-submission.json"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    )

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.checks.credentialHandoff.status).toBe("attention_required")
    expect(audit.blockers).toContain("credential_handoff: credential review index has duplicate credential id: router-admin")
    expect(audit.blockers).toContain("credential_handoff: credential review index record 2 is missing a label")
  })

  test("operation audit rejects raw secret fields in credential review indexes for credentialed plans", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          timeBudget: {
            targetHours: 20,
            allocations: [{ stage: "validation", hours: 18, work: "Use provided credentials for authenticated checks." }],
          },
        },
        null,
        2,
      ) + "\n",
    )
    const credentialDir = path.join(root, "credentials")
    await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(credentialDir, "review-submission.json"),
      JSON.stringify(
        {
          operationID: "school",
          submittedAt: new Date().toISOString(),
          credentials: [{ credentialID: "router-admin", label: "Router Admin", password: "raw-router-password" }],
          file: path.join(credentialDir, "review-submission.json"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    )

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.checks.credentialHandoff.status).toBe("attention_required")
    expect(audit.blockers).toContain(
      "credential_handoff: credential review contains raw secret fields instead of redacted records",
    )
  })

  test("operation audit rejects copied credential reviews from another operation id", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          timeBudget: {
            targetHours: 20,
            allocations: [{ stage: "validation", hours: 18, work: "Use provided credentials for authenticated checks." }],
          },
        },
        null,
        2,
      ) + "\n",
    )
    const credentialDir = path.join(root, "credentials")
    await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(credentialDir, "review-submission.json"),
      JSON.stringify(
        {
          operationID: "other-school-run",
          submittedAt: new Date().toISOString(),
          credentials: [{ credentialID: "router-admin", label: "Router Admin", password: "********" }],
          file: path.join(credentialDir, "review-submission.json"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    )

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.checks.credentialHandoff.status).toBe("attention_required")
    expect(audit.blockers).toContain("credential_handoff: credential review operation id does not match selected operation")
  })

  test("operation audit rejects credential reviews whose file self-reference is noncanonical", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          timeBudget: {
            targetHours: 20,
            allocations: [{ stage: "validation", hours: 18, work: "Use provided credentials for authenticated checks." }],
          },
        },
        null,
        2,
      ) + "\n",
    )
    const credentialDir = path.join(root, "credentials")
    await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(credentialDir, "review-submission.json"),
      JSON.stringify(
        {
          operationID: "school",
          submittedAt: new Date().toISOString(),
          credentials: [{ credentialID: "router-admin", label: "Router Admin", password: "********" }],
          file: path.join(worktree, ".ulmcode", "operations", "other", "credentials", "review-submission.json"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    )

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.checks.credentialHandoff.status).toBe("attention_required")
    expect(audit.blockers).toContain("credential_handoff: credential review file reference is not canonical")
  })

  test("operation audit rejects credential reviews with invalid submitted timestamps", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    const root = path.join(worktree, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          timeBudget: {
            targetHours: 20,
            allocations: [{ stage: "validation", hours: 18, work: "Use provided credentials for authenticated checks." }],
          },
        },
        null,
        2,
      ) + "\n",
    )
    const credentialDir = path.join(root, "credentials")
    await fs.mkdir(credentialDir, { recursive: true, mode: 0o700 })
    await fs.writeFile(
      path.join(credentialDir, "review-submission.json"),
      JSON.stringify(
        {
          operationID: "school",
          submittedAt: "eventually",
          credentials: [{ credentialID: "router-admin", label: "Router Admin", password: "********" }],
          file: path.join(credentialDir, "review-submission.json"),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    )

    const audit = await buildOperationAudit(worktree, "school", { finalHandoff: true })

    expect(audit.ok).toBe(false)
    expect(audit.checks.credentialHandoff.status).toBe("attention_required")
    expect(audit.blockers).toContain("credential_handoff: credential review submittedAt is not a valid timestamp")
  })

  test("blocks validation stage gates until findings are report-ready", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is reviewing evidence.",
      nextActions: ["Validate candidate findings"],
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      phases: [
        {
          stage: "validation",
          objective: "Validate candidate weaknesses.",
          actions: ["Check evidence", "Promote confirmed findings"],
          successCriteria: ["Confirmed findings cite evidence"],
          subagents: ["validator"],
          noSubagents: ["risk acceptance stays with primary operator"],
        },
      ],
      reportingCloseout: [
        "Run report_lint before final handoff.",
        "Run report_render to produce final deliverables.",
        "Run runtime_summary and operation_audit before handoff.",
      ],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "candidate",
      severity: "high",
      confidence: 0.6,
      affectedAssets: ["IdP"],
      evidence: [],
      description: "MFA may not be enforced for administrators.",
    })

    const gate = await buildOperationStageGate(worktree, "school", { stage: "validation" })

    expect(gate.ok).toBe(false)
    expect(gate.gaps).toContain("validation has no validated or report-ready findings")
    expect(gate.gaps).toContain("validation has unresolved candidate or needs-validation findings")
    expect(gate.recommendedTools).toContain("finding_record")
    expect(JSON.parse(await fs.readFile(gate.files.json, "utf8")).stage).toBe("validation")
    expect(await fs.readFile(gate.files.markdown, "utf8")).toContain("validation has no validated")
  })

  test("stage gates block exhausted runtime budgets", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is reviewing evidence.",
      nextActions: ["Continue validation"],
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      phases: [
        {
          stage: "validation",
          objective: "Validate candidate weaknesses.",
          actions: ["Check evidence", "Promote confirmed findings"],
          successCriteria: ["Confirmed findings cite evidence"],
          subagents: ["validator"],
          noSubagents: ["risk acceptance stays with primary operator"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      usage: { totalTokens: 12_500, costUSD: 12.4, budgetUSD: 10, remainingUSD: -2.4 },
    })

    const gate = await buildOperationStageGate(worktree, "school", { stage: "validation" })

    expect(gate.ok).toBe(false)
    expect(gate.gaps).toContain("runtime budget exhausted: spent $12.4 of $10")
    expect(gate.recommendedTools).toContain("runtime_summary")
  })

  test("stage gates treat nonpositive runtime budgets as unknown instead of exhausted", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      phases: [
        {
          stage: "validation",
          objective: "Validate candidate weaknesses.",
          actions: ["Check evidence"],
          successCriteria: ["Confirmed findings cite evidence"],
          subagents: ["validator"],
          noSubagents: ["risk acceptance stays with primary operator"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "Policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })
    await writeRuntimeSummary(worktree, {
      operationID: "school",
      usage: { totalTokens: 12_500, costUSD: 0, budgetUSD: 0, remainingUSD: 0 },
    })

    const gate = await buildOperationStageGate(worktree, "school", { stage: "validation" })

    expect(gate.gaps).not.toContain("runtime budget exhausted: spent $0 of $0")
  })

  test("handoff stage gate forwards strict outline section gates", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for handoff review.",
    })
    await writeOperationPlan(worktree, {
      operationID: "school",
      phases: [
        {
          stage: "reporting",
          objective: "Finalize report.",
          actions: ["Run report_lint", "Render final deliverables"],
          successCriteria: ["Final lint gates are clean"],
          subagents: ["report-writer"],
          noSubagents: ["client-facing approval remains manual"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
    })
    await writeEvidence(worktree, {
      operationID: "school",
      evidenceID: "ev-1",
      title: "IdP policy export",
      kind: "file",
      summary: "MFA policy export.",
      path: "evidence/raw/idp-policy.json",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const outline = await writeReportOutline(worktree, { operationID: "school", targetPages: 4 })
    await fs.writeFile(
      path.join(outline.root, "reports", "report.md"),
      ["# Report", "", "## Methodology", "methodology ".repeat(500)].join("\n"),
    )
    await renderReport(worktree, { operationID: "school" })
    await writeRuntimeSummary(worktree, { operationID: "school" })

    const gate = await buildOperationStageGate(worktree, "school", {
      stage: "handoff",
      requireOutlineSections: true,
      minOutlineSectionWords: 25,
    })

    expect(gate.ok).toBe(false)
    expect(gate.gaps).toContain("Executive Summary: outline section is missing")
    expect(gate.recommendedTools).toContain("report_outline")
  })

  test("derives runtime usage from assistant messages when usage is not provided", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      sessionMessages: [
        {
          role: "assistant",
          agent: "pentest",
          modelID: "gpt-5.5",
          providerID: "openai",
          cost: 1.25,
          tokens: {
            input: 3000,
            output: 1200,
            reasoning: 500,
            cache: { read: 200, write: 100 },
          },
        },
        {
          role: "assistant",
          agent: "recon",
          modelID: "gpt-5.4-mini",
          providerID: "openai",
          cost: 0.15,
          tokens: {
            total: 1800,
            input: 1000,
            output: 600,
            reasoning: 100,
            cache: { read: 100, write: 0 },
          },
        },
        {
          role: "user",
          agent: "user",
        },
      ],
      compaction: { count: 0, pressure: "low" },
    })

    const record = JSON.parse(await fs.readFile(result.json, "utf8"))
    expect(record.modelCalls.total).toBe(2)
    expect(record.modelCalls.byModel["gpt-5.5"]).toBe(1)
    expect(record.modelCalls.byModel["gpt-5.4-mini"]).toBe(1)
    expect(record.usage.inputTokens).toBe(4000)
    expect(record.usage.outputTokens).toBe(1800)
    expect(record.usage.reasoningTokens).toBe(600)
    expect(record.usage.cacheReadTokens).toBe(300)
    expect(record.usage.cacheWriteTokens).toBe(100)
    expect(record.usage.totalTokens).toBe(6500)
    expect(record.usage.costUSD).toBe(1.4)
    expect(record.usage.byAgent.pentest.calls).toBe(1)
    expect(record.usage.byAgent.pentest.totalTokens).toBe(4700)
    expect(record.usage.byAgent.recon.costUSD).toBe(0.15)
  })

  test("computes remaining runtime budget from derived usage", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      usage: { budgetUSD: 1 },
      sessionMessages: [
        {
          role: "assistant",
          agent: "validator",
          modelID: "gpt-5.5",
          providerID: "openai",
          cost: 0.37,
          tokens: {
            input: 500,
            output: 150,
            reasoning: 100,
            cache: { read: 0, write: 0 },
          },
        },
      ],
    })

    const record = JSON.parse(await fs.readFile(result.json, "utf8"))
    expect(record.usage.costUSD).toBe(0.37)
    expect(record.usage.budgetUSD).toBe(1)
    expect(record.usage.remainingUSD).toBe(0.63)
    expect(await fs.readFile(result.markdown, "utf8")).toContain("- remaining_usd: 0.63")
  })

  test("derives compaction pressure from session messages when compaction is not provided", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation is still running.",
    })

    const result = await writeRuntimeSummary(worktree, {
      operationID: "school",
      sessionMessages: [
        { role: "user", parts: [{ type: "compaction", auto: true, overflow: true }] },
        { role: "assistant", summary: true },
        { role: "user", parts: [{ type: "compaction", auto: true }] },
      ],
    })

    const record = JSON.parse(await fs.readFile(result.json, "utf8"))
    expect(record.compaction.count).toBe(2)
    expect(record.compaction.pressure).toBe("moderate")
  })

  test("writes execution-ready operation plans with subagent policy", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "intake",
      status: "planned",
      summary: "Initial authorization captured.",
    })

    const result = await writeOperationPlan(worktree, {
      operationID: "school",
      assumptions: ["Testing is limited to approved school-owned systems."],
      phases: [
        {
          stage: "recon",
          objective: "Map externally exposed services.",
          actions: ["Enumerate DNS", "Identify login surfaces"],
          successCriteria: ["All in-scope hostnames are classified"],
          subagents: ["recon"],
          noSubagents: ["authorization decisions stay with primary operator"],
        },
        {
          stage: "reporting",
          objective: "Produce final report package.",
          actions: ["Run report_lint", "Render final deliverables"],
          successCriteria: ["HTML, PDF, manifest, and runtime summary exist"],
          subagents: ["report-writer"],
          noSubagents: ["final risk acceptance remains manual"],
        },
      ],
      reportingCloseout: [
        "Run report_outline before drafting.",
        "Run report_lint and fix all gaps.",
        "Run report_render and runtime_summary before handoff.",
      ],
    })

    expect(await fs.readFile(result.markdown, "utf8")).toContain("authorization decisions stay with primary operator")
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).phases).toHaveLength(2)
    expect((await readOperationStatus(worktree, "school")).plans.operation).toBe(true)
  })

  test("uses the operation goal objective in operation plan previews", async () => {
    const worktree = await tmpdir()
    await createOperationGoal(worktree, {
      operationID: "school",
      objective: "Authorized 48-hour Surface rehearsal",
      targetDurationHours: 48,
    })

    const result = await writeOperationPlan(worktree, {
      operationID: "school",
      assumptions: ["Synthetic rehearsal only."],
      phases: [
        {
          stage: "recon",
          objective: "Capture synthetic evidence.",
          actions: ["Record supplied evidence"],
          successCriteria: ["Evidence exists"],
          subagents: [],
          noSubagents: ["Primary owns authorization."],
        },
      ],
      reportingCloseout: ["Run report_lint.", "Run report_render.", "Run runtime_summary."],
    })

    expect(await fs.readFile(result.markdown, "utf8")).toContain("- objective: Authorized 48-hour Surface rehearsal")
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).objective).toBe("Authorized 48-hour Surface rehearsal")
  })

  test("rejects raw credential secrets in operation plans", async () => {
    const worktree = await tmpdir()

    await expect(
      writeOperationPlan(worktree, {
        operationID: "school",
        assumptions: ["Genesis admin password: Summer2026! was pasted during kickoff."],
        phases: [
          {
            stage: "recon",
            objective: "Map externally exposed services.",
            actions: ["Enumerate DNS"],
            successCriteria: ["All in-scope hostnames are classified"],
            subagents: ["recon"],
            noSubagents: ["authorization decisions stay with primary operator"],
          },
        ],
        reportingCloseout: ["Run report_lint and fix all gaps.", "Run report_render.", "Run runtime_summary."],
      }),
    ).rejects.toThrow("operation plans must not contain raw credential secrets")
  })

  test("writes a Discovery Charter without final operation plan fields", async () => {
    const worktree = await tmpdir()
    const result = await writeOperationDiscoveryCharter(worktree, {
      operationID: "home-network-hardrun-20260507",
      templateName: "home-network-discovery-charter",
      trustLevel: "unattended",
      scanProfile: "aggressive",
      browserEvidence: true,
      operationMemory: true,
      reportDesignProfile: "standard",
      assumptions: ["Authorization is limited to the operator-owned home network."],
      discoveryCharter: {
        purpose: "Research, recon, operator questions, and time-investment strategy before writing the full plan.",
        researchQuestions: [
          "Which network ranges and asset classes are in scope?",
          "Which authenticated services need credentials before validation?",
          "Which evidence will support final report claims?",
        ],
        reconInvestments: ["Passive inventory", "Low-rate service discovery", "Login surface classification"],
        operatorQuestions: ["Will authenticated checks be allowed?", "Are disruptive tests explicitly out of scope?"],
        candidateDeepWorkLanes: ["Router admin review", "IoT service inventory", "Authenticated portal validation"],
        decisionCriteriaForFullPlan: [
          "Enough safe lanes exist for the requested duration.",
          "Credential requirements are understood.",
          "Report closeout has protected time.",
        ],
      },
    })

    expect(result.operationID).toBe("home-network-hardrun-20260507")
    expect(result.markdown).toEndWith("plans/discovery-charter.md")
    expect(await fs.readFile(result.markdown, "utf8")).toContain("Credential requirements are understood.")
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).planningApproval.status).toBe("pending")
  })

  test("uses the operation goal objective in Discovery Charter previews", async () => {
    const worktree = await tmpdir()
    await createOperationGoal(worktree, {
      operationID: "school",
      objective: "Authorized synthetic Discovery Charter run",
      targetDurationHours: 3,
    })

    const result = await writeOperationDiscoveryCharter(worktree, {
      operationID: "school",
      templateName: "school-laptop-48h",
      trustLevel: "unattended",
      scanProfile: "aggressive",
      assumptions: ["Synthetic rehearsal only."],
      discoveryCharter: {
        purpose: "Research and recon before writing the full operation plan.",
        researchQuestions: ["Which evidence is enough?"],
        reconInvestments: ["Record supplied evidence."],
        operatorQuestions: ["None."],
        candidateDeepWorkLanes: ["recon"],
        decisionCriteriaForFullPlan: ["Evidence can support the full plan."],
      },
    })

    expect(await fs.readFile(result.markdown, "utf8")).toContain("- objective: Authorized synthetic Discovery Charter run")
    expect(JSON.parse(await fs.readFile(result.json, "utf8")).objective).toBe("Authorized synthetic Discovery Charter run")
  })

  test("rejects raw credential secrets in discovery charters and approval notes", async () => {
    const worktree = await tmpdir()

    await expect(
      writeOperationDiscoveryCharter(worktree, {
        operationID: "school",
        assumptions: ["Genesis admin token: raw-token-123"],
        discoveryCharter: {
          purpose: "Research and recon before writing the full operation plan.",
          researchQuestions: ["Which assets are in scope?"],
          reconInvestments: ["Passive inventory"],
          operatorQuestions: ["Are authenticated checks allowed?"],
          candidateDeepWorkLanes: ["Identity review"],
          decisionCriteriaForFullPlan: ["Enough safe lanes exist."],
        },
      }),
    ).rejects.toThrow("operation discovery charters must not contain raw credential secrets")

    await writeOperationDiscoveryCharter(worktree, {
      operationID: "school",
      assumptions: ["Credentials are available through vault handles only."],
      discoveryCharter: {
        purpose: "Research and recon before writing the full operation plan.",
        researchQuestions: ["Which assets are in scope?"],
        reconInvestments: ["Passive inventory"],
        operatorQuestions: ["Are authenticated checks allowed?"],
        candidateDeepWorkLanes: ["Identity review"],
        decisionCriteriaForFullPlan: ["Enough safe lanes exist."],
      },
    })

    await expect(
      approveOperationDiscoveryCharter(worktree, {
        operationID: "school",
        notes: ["Approved with genesis password: Summer2026!"],
      }),
    ).rejects.toThrow("operation discovery charter approvals must not contain raw credential secrets")
  })

  test("operation graph includes district profile, person recon, identity graph, and multistage report lanes", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "intake",
      status: "planned",
      summary: "Initial authorization captured.",
    })

    const graph = await writeOperationGraph(worktree, { operationID: "school", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const lanes = parsed.lanes.map((lane: { id: string }) => lane.id)

    expect(lanes).toContain("district_profile")
    expect(lanes).toContain("person_recon")
    expect(lanes).toContain("identity_graph")
    expect(lanes).toContain("report_evidence_index")
    expect(lanes).toContain("report_technical_review")
    expect(lanes).toContain("report_executive_review")
    expect(parsed.lanes.find((lane: { id: string; agent: string }) => lane.id === "person_recon").agent).toBe(
      "person-recon",
    )
  })

  test("writes K-12 district, person, and identity graph artifacts for recon lanes", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "recon",
      status: "running",
      summary: "Recon is mapping district people, systems, and access paths.",
    })

    const district = await writeDistrictProfile(worktree, {
      operationID: "school",
      name: "Example Unified School District",
      domains: ["example.edu"],
      systems: [{ name: "SIS Portal", category: "sis", source: "district site" }],
      departments: [{ name: "Technology", source: "staff directory" }],
      notes: ["Public website names the SIS and technology department."],
    })
    const person = await writePersonProfile(worktree, {
      operationID: "school",
      name: "Alex Principal",
      role: "High School Principal",
      organization: "Example High School",
      roleCategory: "school_leadership",
      whyTheyMatter: "Likely approval authority for student discipline and guardian communications workflows.",
      likelyAccess: ["SIS discipline", "guardian messaging"],
      publicContacts: [{ type: "email", value: "alex.principal@example.edu", source: "district staff directory" }],
      sources: [
        { title: "Staff Directory", url: "https://example.edu/staff", summary: "District-published role and email." },
      ],
      validationIdeas: ["Check whether principal accounts receive elevated SIS roles in authorized identity exports."],
      excludedPrivateInfo: ["Ignored personal social media because it was not needed for the engagement."],
    })
    const graph = await writeIdentityGraph(worktree, {
      operationID: "school",
      nodes: [
        { id: "person:alex-principal", kind: "person", label: "Alex Principal" },
        { id: "app:sis", kind: "application", label: "SIS Portal" },
        { id: "role:principal", kind: "role", label: "Principal" },
      ],
      edges: [
        {
          from: "person:alex-principal",
          to: "role:principal",
          relationship: "has_role",
          evidence: ["person:alex-principal"],
        },
        { from: "role:principal", to: "app:sis", relationship: "likely_access", evidence: ["public profile"] },
      ],
      notes: ["Identity graph is based on public role evidence until export validation is available."],
    })

    expect(await fs.readFile(district.markdown, "utf8")).toContain("SIS Portal")
    expect(await fs.readFile(person.markdown, "utf8")).toContain("Excluded Private/Irrelevant Information")
    expect(JSON.parse(await fs.readFile(graph.json, "utf8")).edges).toHaveLength(2)
  })

  test("rejects raw credential secrets in district, person, and identity profile artifacts", async () => {
    const worktree = await tmpdir()

    await expect(
      writeDistrictProfile(worktree, {
        operationID: "school",
        name: "Example Unified School District",
        notes: ["SIS admin password: Summer2026!"],
      }),
    ).rejects.toThrow("district profiles must not contain raw credential secrets")

    await expect(
      writePersonProfile(worktree, {
        operationID: "school",
        name: "Alex Principal",
        role: "High School Principal",
        roleCategory: "school_leadership",
        whyTheyMatter: "Can approve SIS workflows with token: raw-token-123",
        likelyAccess: ["SIS discipline"],
        sources: [{ title: "Staff Directory", summary: "District-published role." }],
      }),
    ).rejects.toThrow("person profiles must not contain raw credential secrets")

    await expect(
      writeIdentityGraph(worktree, {
        operationID: "school",
        nodes: [{ id: "app:sis", kind: "application", label: "SIS Portal", source: "password: Summer2026!" }],
        edges: [],
      }),
    ).rejects.toThrow("identity graphs must not contain raw credential secrets")
  })

  test("rejects private-life dossier content in person and identity artifacts", async () => {
    const worktree = await tmpdir()

    await expect(
      writePersonProfile(worktree, {
        operationID: "school",
        name: "Alex Principal",
        role: "High School Principal",
        roleCategory: "school_leadership",
        whyTheyMatter: "Likely SIS approver. Home address appears in search results.",
        likelyAccess: ["SIS discipline"],
        sources: [{ title: "Staff Directory", summary: "District-published role." }],
      }),
    ).rejects.toThrow("person profiles must not contain private-life dossier details")

    await expect(
      writeIdentityGraph(worktree, {
        operationID: "school",
        nodes: [{ id: "person:alex-principal", kind: "person", label: "Alex Principal", source: "spouse social profile" }],
        edges: [],
      }),
    ).rejects.toThrow("identity graphs must not contain private-life dossier details")
  })

  test("allows excluded-private-info notes without storing the private details as profile facts", async () => {
    const worktree = await tmpdir()

    const result = await writePersonProfile(worktree, {
      operationID: "school",
      name: "Alex Principal",
      role: "High School Principal",
      roleCategory: "school_leadership",
      whyTheyMatter: "Likely SIS approver for guardian communication workflows.",
      likelyAccess: ["SIS discipline"],
      sources: [{ title: "Staff Directory", summary: "District-published role." }],
      excludedPrivateInfo: ["Ignored home address, personal phone, spouse, children, and private life details."],
    })

    expect(await fs.readFile(result.markdown, "utf8")).toContain("Excluded Private/Irrelevant Information")
  })

  test("rejects vague operation plans", async () => {
    const worktree = await tmpdir()
    await expect(
      writeOperationPlan(worktree, {
        operationID: "school",
        phases: [
          {
            stage: "recon",
            objective: "Look around.",
            actions: [],
            successCriteria: [],
            subagents: [],
            noSubagents: [],
          },
        ],
        reportingCloseout: ["Write report."],
      }),
    ).rejects.toThrow("phase 1 requires at least one action")
  })

  test("requires approval, time budget, coverage, retry, and finalization details for 2h+ operation plans", async () => {
    const worktree = await tmpdir()

    await expect(
      writeOperationPlan(worktree, {
        operationID: "school",
        planningApproval: { status: "pending", discoveryCharterPath: "plans/discovery-charter.md" },
        timeBudget: {
          targetHours: 3,
          allocations: [{ stage: "recon", hours: 2.5, work: "Inventory the authorized network." }],
        },
        coverageContract: {
          status: "unmet",
          goals: ["Inventory the internal network."],
          minimumEvidence: ["At least one TCP sweep output."],
          requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
          allowedSkippedLanes: [],
          fallbackRules: [],
          retryRules: [],
          subagentOpportunities: [],
          reportGates: ["report_lint"],
        },
        phases: [
          {
            stage: "recon",
            objective: "Map authorized targets.",
            actions: ["Run chunked service inventory."],
            successCriteria: ["Inventory evidence exists."],
            subagents: ["recon"],
            noSubagents: ["Operator approval decisions"],
          },
        ],
        reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
      }),
    ).rejects.toThrow("2h+ operation plan requires planningApproval.status=approved")

    const result = await writeOperationPlan(worktree, {
      operationID: "school",
      planningApproval: { status: "approved", discoveryCharterPath: "plans/discovery-charter.md", approver: "operator" },
      discoveryCharter: {
        purpose: "Research, recon, and question strategy before writing the actual plan.",
        researchQuestions: [
          "Which host classes are in scope?",
          "Which identity systems are safe to inspect?",
          "Which report audience needs evidence depth?",
        ],
        reconInvestments: ["Chunked host discovery", "Web inventory", "Identity surface inventory"],
        operatorQuestions: ["Are authenticated identity checks allowed if discovery finds AD?", "Are printer/IoT devices inventory-only?"],
        candidateDeepWorkLanes: ["Subnet-by-subnet service inventory", "SaaS/cloud exposure review", "Report evidence review"],
        decisionCriteriaForFullPlan: [
          "Enough safe lanes exist to fill the requested time budget.",
          "Fallback/retry lanes exist for timed-out discovery.",
          "Report closeout has a protected finalization window.",
        ],
      },
      timeBudget: {
        targetHours: 3,
        finalizationWindowHours: 0.5,
        durationFit: {
          confidence: "duration_sized",
          evidence: ["Three primary lanes plus fallback/retry work cover the 3h budget."],
          overflowBacklog: ["Additional low-rate web review", "Secondary role profile pass"],
        },
        allocations: [
          { stage: "recon", hours: 1.25, work: "Chunked internal service inventory." },
          { stage: "validation", hours: 1.25, work: "Validate evidence-backed findings and retry timed-out chunks." },
          { stage: "reporting", hours: 0.5, work: "Report lint, render, and audit gates." },
        ],
        executionBlocks: executionBlocks({ minutes: 150 }),
      },
      coverageContract: {
        status: "unmet",
        goals: ["Inventory authorized internal hosts.", "Validate evidence-backed findings."],
        minimumEvidence: ["TCP sweep for each authorized subnet.", "Service evidence for responsive hosts."],
        requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
        allowedSkippedLanes: [],
        fallbackRules: ["If a scan times out, split the subnet and run smaller supervised chunks."],
        retryRules: ["Retry timed-out command profiles once with lower concurrency before marking blocked."],
        subagentOpportunities: ["recon inventory", "report review"],
        reportGates: ["report_lint finalHandoff=true", "operation_audit finalHandoff=true"],
      },
      phases: [
        {
          stage: "recon",
          objective: "Map authorized targets.",
          actions: ["Run chunked service inventory.", "Retry timed-out chunks with lower concurrency."],
          successCriteria: ["Inventory evidence exists for each reachable host class."],
          subagents: ["recon"],
          noSubagents: ["Operator approval decisions"],
        },
        {
          stage: "reporting",
          objective: "Close out client-ready deliverables.",
          actions: ["Run report_lint", "Run report_render", "Run runtime_summary", "Run operation_audit"],
          successCriteria: ["Coverage contract and report gates release handoff."],
          subagents: ["report-reviewer"],
          noSubagents: ["Final client send decision"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary", "Run operation_audit"],
    })

    const coverage = JSON.parse(await fs.readFile(path.join(worktree, ".ulmcode", "operations", "school", "plans", "coverage-contract.json"), "utf8"))
    expect(coverage.requiredLanes).toContain("recon")
    expect(await fs.readFile(result.markdown, "utf8")).toContain("## Coverage Contract")
  })

  test("rejects approved 2h+ plans that do not prove duration-sized work from the Discovery Charter", async () => {
    const worktree = await tmpdir()

    await expect(
      writeOperationPlan(worktree, {
        operationID: "school",
        planningApproval: { status: "approved", discoveryCharterPath: "plans/discovery-charter.md", approver: "operator" },
        discoveryCharter: {
          purpose: "Think a bit before planning.",
          researchQuestions: ["What hosts exist?"],
          reconInvestments: [],
          operatorQuestions: [],
          candidateDeepWorkLanes: ["Recon"],
          decisionCriteriaForFullPlan: ["Seems fine."],
        },
        timeBudget: {
          targetHours: 3,
          finalizationWindowHours: 0.5,
          allocations: [
            { stage: "recon", hours: 2.5, work: "Scan a bit." },
            { stage: "reporting", hours: 0.5, work: "Report." },
          ],
        },
        coverageContract: {
          status: "unmet",
          goals: ["Inventory authorized internal hosts."],
          minimumEvidence: ["TCP sweep output."],
          requiredLanes: ["recon", "finding_validation", "report_review"],
          allowedSkippedLanes: [],
          fallbackRules: ["Retry lower concurrency."],
          retryRules: ["Retry timed-out chunks."],
          subagentOpportunities: ["recon"],
          reportGates: ["report_lint finalHandoff=true"],
        },
        phases: [
          {
            stage: "recon",
            objective: "Map authorized targets.",
            actions: ["Run chunked service inventory."],
            successCriteria: ["Inventory evidence exists."],
            subagents: ["recon"],
            noSubagents: ["Operator approval decisions"],
          },
        ],
        reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
      }),
    ).rejects.toThrow("2h+ operation plan requires discoveryCharter.reconInvestments")
  })

  test("lints missing final handoff artifacts when required", async () => {
    const worktree = await tmpdir()
    await writeOperationCheckpoint(worktree, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "complete",
      summary: "Ready for final handoff.",
    })
    await writeFinding(worktree, {
      operationID: "school",
      title: "Weak MFA coverage",
      state: "report_ready",
      severity: "high",
      confidence: 0.9,
      affectedAssets: ["IdP"],
      evidence: [{ id: "ev-1", path: "evidence/raw/idp-policy.json" }],
      description: "MFA is not enforced for administrators.",
      impact: "Administrator takeover is more likely after password compromise.",
      remediation: "Require phishing-resistant MFA for privileged accounts.",
    })

    const result = await lintReport(worktree, "school", {
      finalHandoff: true,
    })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("plans/operation-plan.json is required")
    expect(result.gaps).toContain("deliverables/final/report.pdf is required")
    expect(result.gaps).toContain("deliverables/final/README.md is required")
    expect(result.gaps).toContain("deliverables/final/findings.json is required")
    expect(result.gaps).toContain("deliverables/final/evidence-index.json is required")
    expect(result.gaps).toContain("deliverables/final/operator-review.md is required")
    expect(result.gaps).toContain("deliverables/final/executive-summary.md is required")
    expect(result.gaps).toContain("deliverables/final/technical-appendix.md is required")
    expect(result.gaps).toContain("deliverables/final/runtime-summary.md is required")
    expect(result.gaps).toContain("deliverables/runtime-summary.json is required")
  })
})
