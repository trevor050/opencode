import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { decideOperationNext } from "@/ulm/operation-next"
import { createOperationGoal } from "@/ulm/operation-goal"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeCoverageContract, writeOperationDiscoveryCharter, writeRuntimeSummary } from "@/ulm/artifact"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation next action", () => {
  test("asks for scheduling when no operation graph exists", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("schedule")
    expect(result.action.recommendedTools).toContain("operation_schedule")
    expect(await fs.stat(result.path)).toBeTruthy()
  })

  test("launches approved Discovery Charter research before final planning when no graph exists", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized internal assessment",
      targetDurationHours: 45,
    })
    await writeOperationDiscoveryCharter(dir.path, {
      operationID: "School",
      planningApproval: {
        status: "approved",
        discoveryCharterPath: "plans/discovery-charter.md",
        approver: "operator",
      },
      discoveryCharter: {
        purpose: "Research how to build a 45-hour final plan.",
        researchQuestions: ["Which scoped assets justify deep work?"],
        reconInvestments: ["Passive inventory and safe service classification."],
        operatorQuestions: ["Which systems must stay inventory-only?"],
        candidateDeepWorkLanes: ["identity review", "web validation"],
        decisionCriteriaForFullPlan: ["Duration-fit evidence exists."],
      },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("research_charter")
    if (result.action.action !== "research_charter") throw new Error("expected research_charter")
    expect(result.action.laneID).toBe("discovery_research")
    expect(result.action.prompt).toContain("Target research effort: about 162 minutes")
    expect(result.action.prompt).toContain("Your goal is research")
    expect(result.action.prompt).toContain("planningMode=full-duration")
    expect(result.action.recommendedTools).toContain("operation_memory")
  })

  test("launches the first ready lane when runtime is healthy", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("launch_lane")
    if (result.action.action !== "launch_lane") throw new Error("expected launch_lane")
    expect(result.action.lane.id).toBe("district_profile")
    expect(result.action.prompt).toContain('Run operation lane "district_profile"')
    expect(result.action.prompt).toContain("mode=complete_lane")
    expect(result.action.prompt).toContain("Use only the allowed tools listed above")
    expect(result.action.prompt).toContain("Bash, browser, and Playwright tools are unavailable")
    expect(result.action.prompt).toContain("poll their heartbeat/stdout/stderr artifacts with read/grep")
    expect(result.action.prompt).toContain("Do not use bash, sleep, cat, tail, or foreground shell commands")
    expect(result.action.recommendedTools).toContain("district_profile")
  })

  test("launches a critical capability lane before lower-value ready recon work", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = [
      {
        ...graph.lanes.find((lane: { id: string }) => lane.id === "recon"),
        status: "ready",
        dependsOn: [],
        coverageImpact: "medium",
      },
      {
        ...graph.lanes.find((lane: { id: string }) => lane.id === "identity_auth_review"),
        id: "google_workspace_review",
        title: "Google Workspace Review",
        status: "ready",
        dependsOn: [],
        coverageImpact: "high",
        priorityCategory: "critical_capability",
        expectedArtifacts: ["work-blocks/google-workspace-review.md"],
      },
    ]
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, {
      operationID: "School",
      now: new Date("2026-06-26T01:00:00.000Z"),
    })

    expect(result.action.action).toBe("launch_lane")
    if (result.action.action !== "launch_lane") throw new Error("expected launch_lane")
    expect(result.action.lane.id).toBe("google_workspace_review")
    expect(result.action.reason).toContain("critical capability")
  })

  test("includes operation plan scope rules in next lane prompts", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(operationRoot, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          scopeRules: ["Only scan 10.20.0.0/16.", "Exclude payroll systems."],
        },
        null,
        2,
      ) + "\n",
    )
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("launch_lane")
    if (result.action.action !== "launch_lane") throw new Error("expected launch_lane")
    expect(result.action.prompt).toContain("Operation scope rules:")
    expect(result.action.prompt).toContain("Only scan 10.20.0.0/16.")
    expect(result.action.prompt).toContain("Exclude payroll systems.")
  })

  test("does not launch the supervisor lane as normal operation work", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, {
      operationID: "School",
      includeSupervisor: true,
      budgetUSD: 10,
    })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { id: string; status: string }) => ({
      ...lane,
      status: lane.id === "supervisor" ? "ready" : "complete",
    }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("wait")
    if (result.action.action !== "wait") throw new Error("expected wait")
    expect(result.action.laneID).toBe("supervisor")
  })

  test("waits when max concurrent lanes are already running", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, { operationID: "School", maxConcurrentLanes: 1, budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes[0].status = "running"
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("wait")
    expect(result.action.reason).toContain("max concurrent lanes")
  })

  test("persists stop action after all lanes complete", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete" }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("stop")
    expect(result.action.reason).toContain("all operation lanes are complete")
    const persisted = JSON.parse(await fs.readFile(path.join(path.dirname(result.path), "next-action.json"), "utf8"))
    expect(persisted.action).toBe("stop")
  })

  test("does not stop a three-hour active goal after twenty minutes just because lanes are complete", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(
      dir.path,
      { operationID: "School", objective: "Authorized internal assessment", targetDurationHours: 3 },
      { now: "2026-05-05T00:00:00.000Z" },
    )
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete" }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await decideOperationNext(dir.path, {
      operationID: "School",
      now: "2026-05-05T00:20:00.000Z",
    })

    expect(result.action.action).toBe("expand_work")
    expect(result.action.reason).toContain("target runtime window is still open")
    expect(result.action.recommendedTools).toContain("operation_queue")
  })

  test("does not stop early when lanes are complete and the goal window remains open", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(
      dir.path,
      { operationID: "School", objective: "Authorized internal assessment", targetDurationHours: 48 },
      { now: "2026-05-05T00:00:00.000Z" },
    )
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await writeCoverageContract(dir.path, {
      operationID: "School",
      status: "released",
      goals: ["Complete all scheduled work."],
      minimumEvidence: ["All required lanes complete."],
      requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
      allowedSkippedLanes: [],
      fallbackRules: ["Use report gates for closeout."],
      retryRules: ["Retry failed report gates before audit."],
      subagentOpportunities: ["report review"],
      reportGates: ["operation_audit finalHandoff=true"],
    })

    const result = await decideOperationNext(dir.path, {
      operationID: "School",
      now: "2026-05-05T00:20:00.000Z",
    })

    expect(result.action.action).toBe("expand_work")
    expect(result.action.reason).toContain("target runtime window is still open")
    expect(result.action.recommendedTools).toContain("runtime_scheduler")
    expect(result.action.recommendedTools).toContain("operation_queue")
  })

  test("expands work when all lanes are complete, coverage is unmet, and the goal window remains open", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(
      dir.path,
      { operationID: "School", objective: "Authorized internal assessment", targetDurationHours: 3 },
      { now: "2026-05-05T00:00:00.000Z" },
    )
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await writeCoverageContract(dir.path, {
      operationID: "School",
      status: "unmet",
      goals: ["Inventory every authorized internal subnet."],
      minimumEvidence: ["TCP service output for each responsive host."],
      requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
      allowedSkippedLanes: [],
      fallbackRules: ["Split timed-out scan ranges into smaller chunks."],
      retryRules: ["Retry lower-concurrency scan chunks before blocking."],
      subagentOpportunities: ["parallel recon review"],
      reportGates: ["report_lint finalHandoff=true"],
    })

    const result = await decideOperationNext(dir.path, {
      operationID: "School",
      now: "2026-05-05T00:20:00.000Z",
    })

    expect(result.action.action).toBe("expand_work")
    expect(result.action.reason).toContain("target runtime window is still open")
    expect(result.action.blockers).toContain("coverage contract status is unmet")
    expect(result.action.recommendedTools).toContain("operation_supervise")
  })
})
