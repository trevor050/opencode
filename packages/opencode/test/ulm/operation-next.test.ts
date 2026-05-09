import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { decideOperationNext } from "@/ulm/operation-next"
import { createOperationGoal } from "@/ulm/operation-goal"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeCoverageContract, writeRuntimeSummary } from "@/ulm/artifact"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation next action", () => {
  test("asks for scheduling when no operation graph exists", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await decideOperationNext(dir.path, { operationID: "School" })

    expect(result.action.action).toBe("schedule")
    expect(result.action.recommendedTools).toContain("operation_schedule")
    expect(await fs.stat(result.path)).toBeTruthy()
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

    expect(result.action.action).toBe("wait")
    expect(result.action.reason).toContain("coverage contract is not release-ready")
    expect(result.action.recommendedTools).toContain("operation_supervise")
  })

  test("continues coverage when all lanes complete but the coverage contract is unmet", async () => {
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
      now: "2026-05-05T03:10:00.000Z",
    })

    expect(result.action.action).toBe("wait")
    expect(result.action.reason).toContain("coverage contract is not release-ready")
    expect(result.action.recommendedTools).toContain("operation_supervise")
  })
})
