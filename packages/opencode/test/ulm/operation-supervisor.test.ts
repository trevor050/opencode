import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import {
  writeCoverageContract,
  writeOperationCheckpoint,
  writeOperationDiscoveryCharter,
  writeOperationPlan,
  writeRuntimeSummary,
  type Stage,
} from "@/ulm/artifact"
import { createOperationGoal } from "@/ulm/operation-goal"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { operationPath } from "@/ulm/artifact"
import { superviseOperation } from "@/ulm/operation-supervisor"
import { tmpdir } from "../fixture/fixture"

function executionBlocks(input: { minutes: number; stage?: Stage; laneID?: string; blockMinutes?: number }) {
  const blockMinutes = input.blockMinutes ?? 60
  return Array.from({ length: Math.ceil(input.minutes / blockMinutes) }, (_, index) => {
    const id = `fixture-block-${index + 1}`
    return {
      id,
      stage: input.stage ?? "recon",
      laneID: input.laneID ?? "recon",
      title: `Fixture block ${index + 1}`,
      startMinute: index * blockMinutes,
      durationMinutes: Math.min(blockMinutes, input.minutes - index * blockMinutes),
      objective: "Keep duration-sized execution moving with durable evidence.",
      actions: ["Run bounded work for this block.", "Record evidence or blockers before moving on."],
      successCriteria: ["Block note exists.", "Evidence refs or blockers are recorded."],
      fallbackWork: ["Switch to backlog validation or evidence normalization if primary work is blocked."],
      subagents: ["recon"],
      expectedArtifacts: [`work-blocks/${id}.md`],
    }
  })
}

async function writeMinimalPlan(root: string) {
  await writeOperationPlan(root, {
    operationID: "school",
    phases: [
      {
        stage: "recon",
        objective: "Inventory authorized targets.",
        actions: ["Run supervised inventory"],
        successCriteria: ["Raw inventory evidence exists"],
        subagents: ["recon"],
        noSubagents: ["Final reporting"],
      },
    ],
    reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary", "Run operation_audit"],
  })
}

describe("ULM operation supervisor", () => {
  test("requires an operation goal before broad execution", async () => {
    await using dir = await tmpdir({ git: true })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    expect(review.decisions[0]?.action).toBe("blocked")
    expect(review.decisions[0]?.requiredNextTool).toBe("operation_goal")
    expect(review.decisions.map((item) => item.requiredNextTool)).toContain("operation_plan")
  })

  test("requires an operation plan after goal creation", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    expect(review.decisions[0]?.requiredNextTool).toBe("operation_plan")
  })

  test("does not block approved Discovery Charter runs before the research pass exists", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized three hour assessment", targetDurationHours: 3 })
    await writeOperationDiscoveryCharter(dir.path, {
      operationID: "school",
      planningApproval: {
        status: "approved",
        discoveryCharterPath: "plans/discovery-charter.md",
        approver: "operator",
      },
      discoveryCharter: {
        purpose: "Research, recon, and operator-question strategy before writing the full operation plan.",
        researchQuestions: ["What is in scope?", "Which services exist?", "What evidence is needed?"],
        reconInvestments: ["Passive interface inventory", "Local host discovery", "Safe service classification"],
        operatorQuestions: ["Are credentials available?", "Are disruptive checks excluded?"],
        candidateDeepWorkLanes: ["Router review", "IoT inventory", "Web surface validation"],
        decisionCriteriaForFullPlan: ["Safe lanes exist", "Scope is bounded", "Report closeout is budgeted"],
      },
    })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    expect(review.decisions.map((item) => item.reason)).not.toContain("operation plan is missing")
    expect(review.decisions[0]?.reason).toBe("approved Discovery Charter needs a dedicated research pass before the full operation plan")
    expect(review.decisions[0]?.requiredNextTool).toBe("task")
    expect(review.decisions[0]?.modelPrompt).toContain("The goal is research")
    expect(review.planExcerpt?.path).toContain("discovery-charter.json")
    expect(review.planExcerpt?.content).toContain("operator")
  })

  test("blocks long-run graphs that omit a supervisor lane", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })
    await writeMinimalPlan(dir.path)
    await writeOperationGraph(dir.path, { operationID: "school" })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    expect(review.decisions.map((item) => item.reason)).toContain("long-run graph has no supervisor lane")
    expect(review.decisions.find((item) => item.reason === "long-run graph has no supervisor lane")?.requiredNextTool).toBe(
      "operation_schedule",
    )
  })

  test("blocks final handoff when runtime blind spots are recorded", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })
    await writeMinimalPlan(dir.path)
    await writeRuntimeSummary(dir.path, {
      operationID: "school",
      notes: ["runtime blind spot: background task task-recon has no readable session ledger"],
    })

    const review = await superviseOperation(dir.path, { operationID: "school", reviewKind: "pre_handoff", writeArtifacts: true })

    expect(review.decisions.map((item) => item.reason)).toContain("runtime summary records a blind spot")
    expect(review.files?.json).toContain("supervisor-review-")
    expect(review.files?.markdown).toContain("latest.md")
  })

  test("rejects raw credential secrets before writing supervisor review artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })
    await writeMinimalPlan(dir.path)

    await expect(
      superviseOperation(dir.path, {
        operationID: "school",
        reviewKind: "heartbeat",
        latestAssistantMessage: "Operator pasted password: Summer2026!",
        writeArtifacts: true,
      }),
    ).rejects.toThrow("operation supervisor reviews must not contain raw credential secrets")
  })

  test("turn-end review carries plan excerpt and requires continued execution", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "school",
      objective: "Authorized overnight assessment",
      targetDurationHours: 20,
      continuation: { injectPlanMaxChars: 80 },
    })
    await writeMinimalPlan(dir.path)

    const review = await superviseOperation(dir.path, {
      operationID: "school",
      reviewKind: "turn_end",
      latestAssistantMessage: "Done for now.",
      writeArtifacts: false,
    })

    expect(review.decisions[0]?.action).toBe("continue_coverage")
    expect(review.planExcerpt?.maxChars).toBe(80)
    expect(review.planExcerpt?.content).toContain("[ULM operation plan truncated at 80 chars]")
    expect(review.latestAssistantMessage).toBe("Done for now.")
  })

  test("returns continue_coverage when coverage is unmet even after lanes look complete", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized three hour assessment", targetDurationHours: 3 })
    await writeMinimalPlan(dir.path)
    const graph = await writeOperationGraph(dir.path, { operationID: "school" })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes = parsed.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
    await writeCoverageContract(dir.path, {
      operationID: "school",
      status: "unmet",
      goals: ["Internal network coverage"],
      minimumEvidence: ["One partial TCP sweep is not enough."],
      requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
      allowedSkippedLanes: [],
      fallbackRules: ["Chunk timed-out scan ranges."],
      retryRules: ["Retry with lower concurrency."],
      subagentOpportunities: ["parallel recon review"],
      reportGates: ["report_lint finalHandoff=true"],
    })

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    const coverageDecision = review.decisions.find((item) => item.action === "continue_coverage")
    expect(coverageDecision?.requiredNextTool).toBe("operation_run")
  })

  test("continues reporting when a final audit exists but has blockers", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, { operationID: "school", objective: "Authorized overnight assessment", targetDurationHours: 20 })
    await writeMinimalPlan(dir.path)
    const graph = await writeOperationGraph(dir.path, { operationID: "school" })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes = parsed.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "school",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "school")
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(path.join(root, "reports", "report-outline.md"), "# Outline\n\n- target_pages: 4\n")
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(path.join(root, "deliverables", "final", "manifest.json"), JSON.stringify({ operationID: "school" }) + "\n")
    await fs.mkdir(path.join(root, "deliverables", "stage-gates"), { recursive: true })
    await fs.writeFile(path.join(root, "deliverables", "stage-gates", "handoff.json"), JSON.stringify({ ok: true }) + "\n")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID: "school",
          ok: false,
          blockers: [
            "final_handoff: reports/report-outline.md target_pages is too small: 4, expected at least 50",
            "final_handoff: deliverables/final/report.pdf has 11 pages, expected at least 50",
          ],
        },
        null,
        2,
      ) + "\n",
    )

    const review = await superviseOperation(dir.path, { operationID: "school", writeArtifacts: false })

    const reportingDecision = review.decisions.find((item) => item.reason === "final operation audit has unresolved blockers")
    expect(reportingDecision?.action).toBe("continue_reporting")
    expect(reportingDecision?.requiredNextTool).toBe("report_outline")
    expect(reportingDecision?.requiredArtifacts).toContain("deliverables/operation-audit.json")
  })

  test("monitors instead of reopening report closeout for target-window handoff blockers", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "school",
      objective: "Authorized overnight assessment",
      targetDurationHours: 9,
    })
    await writeOperationCheckpoint(dir.path, {
      operationID: "school",
      objective: "Authorized overnight assessment",
      stage: "handoff",
      status: "running",
      summary: "Final artifacts are content-complete but target runtime is still active.",
      nextActions: ["Continue periodic supervision until the target stop window."],
    })
    await writeMinimalPlan(dir.path)
    const graph = await writeOperationGraph(dir.path, { operationID: "school" })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes = parsed.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
    await writeCoverageContract(dir.path, {
      operationID: "school",
      status: "released",
      goals: ["All required handoff lanes completed."],
      minimumEvidence: ["Lane completion proofs and report artifacts exist."],
      requiredLanes: parsed.lanes.map((lane: { id: string }) => lane.id),
      allowedSkippedLanes: [],
      fallbackRules: ["No fallback required for this fixture."],
      retryRules: ["No retry required for this fixture."],
      subagentOpportunities: ["Report review lanes."],
      reportGates: ["report_lint finalHandoff=true"],
      releaseNotes: ["Fixture coverage released."],
    })
    await writeRuntimeSummary(dir.path, {
      operationID: "school",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "school")
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(path.join(root, "deliverables", "final", "manifest.json"), JSON.stringify({ operationID: "school" }) + "\n")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID: "school",
          ok: false,
          blockers: [
            "final_handoff: handoff stage must be marked complete before final report handoff",
            "final_handoff: operation status must be complete for final handoff",
          ],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.mkdir(path.join(root, "deliverables", "stage-gates"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "stage-gates", "handoff.json"),
      JSON.stringify(
        {
          operationID: "school",
          ok: false,
          gaps: [
            "handoff stage must be marked complete before final report handoff",
            "operation status must be complete for final handoff",
          ],
        },
        null,
        2,
      ) + "\n",
    )

    const review = await superviseOperation(dir.path, { operationID: "school", reviewKind: "heartbeat", writeArtifacts: false })

    expect(review.decisions.some((item) => item.reason === "final operation audit has unresolved blockers")).toBe(false)
    expect(review.decisions.some((item) => item.reason === "handoff stage gate has unresolved blockers")).toBe(false)
    const monitorDecision = review.decisions.find((item) => item.reason === "final handoff is waiting for target stop window")
    expect(monitorDecision?.action).toBe("continue")
    expect(monitorDecision?.requiredNextTool).toBe("operation_status")
  })

  test("does not release handoff when the handoff stage gate is failing", async () => {
    await using dir = await tmpdir({ git: true })
    const goal = await createOperationGoal(dir.path, {
      operationID: "school",
      objective: "Authorized overnight assessment",
      targetDurationHours: 20,
    })
    const goalRecord = JSON.parse(await fs.readFile(goal.files.json, "utf8"))
    goalRecord.status = "complete"
    goalRecord.completedAt = "2026-05-08T20:10:00.000Z"
    await fs.writeFile(goal.files.json, JSON.stringify(goalRecord, null, 2) + "\n")
    await writeOperationCheckpoint(dir.path, {
      operationID: "school",
      objective: "Authorized overnight assessment",
      stage: "handoff",
      status: "complete",
      summary: "Final artifacts are being checked.",
    })
    await writeMinimalPlan(dir.path)
    await writeRuntimeSummary(dir.path, {
      operationID: "school",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "school")
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(path.join(root, "deliverables", "final", "manifest.json"), JSON.stringify({ operationID: "school" }) + "\n")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify({ operationID: "school", ok: true, blockers: [] }, null, 2) + "\n",
    )
    await fs.mkdir(path.join(root, "deliverables", "stage-gates"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "stage-gates", "handoff.json"),
      JSON.stringify({ operationID: "school", ok: false, gaps: ["final report was not reviewed"] }, null, 2) + "\n",
    )

    const review = await superviseOperation(dir.path, { operationID: "school", reviewKind: "pre_handoff", writeArtifacts: false })

    expect(review.decisions.map((item) => item.action)).not.toContain("release_handoff")
    const reportingDecision = review.decisions.find((item) => item.reason === "handoff stage gate has unresolved blockers")
    expect(reportingDecision?.action).toBe("continue_reporting")
    expect(reportingDecision?.requiredArtifacts).toContain("deliverables/stage-gates/handoff.json")
  })

  test("starts reporting closeout when a long run enters its protected finalization window", async () => {
    await using dir = await tmpdir({ git: true })
    const goal = await createOperationGoal(dir.path, {
      operationID: "school",
      objective: "Authorized 48 hour school laptop assessment.",
      targetDurationHours: 48,
    })
    const goalRecord = JSON.parse(await fs.readFile(goal.files.json, "utf8"))
    goalRecord.createdAt = "2026-05-01T00:00:00.000Z"
    goalRecord.updatedAt = "2026-05-01T00:00:00.000Z"
    await fs.writeFile(goal.files.json, JSON.stringify(goalRecord, null, 2) + "\n")
    const discoveryCharter = {
      purpose: "Plan the finalization handoff for a 48h school laptop run.",
      researchQuestions: ["Which final report gates must run before handoff?"],
      reconInvestments: ["Use stored evidence and graph state."],
      operatorQuestions: ["Confirm finalization window timing."],
      candidateDeepWorkLanes: ["report writing", "report review"],
      decisionCriteriaForFullPlan: ["Finalization starts before the target window ends."],
    }
    await writeOperationPlan(dir.path, {
      operationID: "school",
      planningApproval: {
        status: "approved",
        discoveryCharterPath: "plans/discovery-charter.md",
        approver: "operator",
      },
      discoveryCharter,
      timeBudget: {
        targetHours: 48,
        finalizationWindowHours: 4,
        allocations: [
          { stage: "recon", hours: 30, work: "Authorized discovery and mapping." },
          { stage: "validation", hours: 14, work: "Validate evidence-backed chains." },
          { stage: "reporting", hours: 4, work: "Final reports, lint, render, runtime summary, and audit." },
        ],
        executionBlocks: executionBlocks({ minutes: 44 * 60, laneID: "recon", stage: "recon" }),
        durationFit: {
          confidence: "duration_sized",
          evidence: ["48h target with protected finalization window."],
          overflowBacklog: ["Defer nice-to-have discovery once finalization opens."],
        },
      },
      phases: [
        {
          stage: "recon",
          objective: "Inventory authorized targets.",
          actions: ["Run supervised inventory"],
          successCriteria: ["Evidence exists"],
          subagents: ["recon"],
          noSubagents: ["Final handoff approval"],
        },
        {
          stage: "reporting",
          objective: "Build the final report package.",
          actions: ["Run report pipeline"],
          successCriteria: ["operation_audit passes"],
          subagents: ["report-writer", "report-reviewer"],
          noSubagents: ["Risk acceptance"],
        },
      ],
      coverageContract: {
        status: "unmet",
        goals: ["Complete required evidence and report closeout."],
        minimumEvidence: ["operation graph lane proof", "final report package"],
        requiredLanes: ["recon", "report_writing", "report_review"],
        allowedSkippedLanes: [],
        fallbackRules: ["Defer non-critical discovery once finalization opens."],
        retryRules: ["Retry transient report failures."],
        subagentOpportunities: ["report-writer", "report-reviewer"],
        reportGates: ["report_lint", "report_render", "operation_audit"],
      },
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary", "Run operation_audit"],
    })
    await writeOperationGraph(dir.path, { operationID: "school", includeSupervisor: true })

    const review = await superviseOperation(
      dir.path,
      { operationID: "school", reviewKind: "heartbeat", writeArtifacts: false },
      { now: "2026-05-02T21:00:00.000Z" },
    )

    expect(review.decisions[0]?.action).toBe("continue_reporting")
    expect(review.decisions[0]?.reason).toContain("finalization window is open")
    expect(review.decisions[0]?.requiredNextTool).toBe("report_outline")
    expect(review.decisions[0]?.modelPrompt).toContain("Stop launching new broad discovery")
    expect(review.decisions.map((item) => item.reason)).not.toContain("coverage contract is not release-ready")
  })
})
