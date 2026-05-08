import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { writeCoverageContract, writeOperationDiscoveryCharter, writeOperationPlan, writeRuntimeSummary } from "@/ulm/artifact"
import { createOperationGoal } from "@/ulm/operation-goal"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { operationPath } from "@/ulm/artifact"
import { superviseOperation } from "@/ulm/operation-supervisor"
import { tmpdir } from "../fixture/fixture"

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

  test("does not block approved Discovery Charter runs before bounded discovery evidence exists", async () => {
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
    expect(review.decisions[0]?.reason).toBe("approved Discovery Charter needs bounded discovery before the full operation plan")
    expect(review.decisions[0]?.requiredNextTool).toBe("command_supervise")
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
    expect(reportingDecision?.requiredNextTool).toBe("report_lint")
    expect(reportingDecision?.requiredArtifacts).toContain("deliverables/operation-audit.json")
  })
})
