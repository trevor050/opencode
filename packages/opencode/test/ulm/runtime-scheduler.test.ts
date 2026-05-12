import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { createOperationGoal } from "@/ulm/operation-goal"
import {
  operationPath,
  writeCoverageContract,
  writeFinding,
  writeOperationDiscoveryCharter,
  writeOperationPlan,
  writeRuntimeSummary,
  type Stage,
} from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { generateOperationBacklog } from "@/ulm/operation-backlog"
import { runRuntimeScheduler } from "@/ulm/runtime-scheduler"
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

async function writeBasicPlan(worktree: string, operationID = "School") {
  await writeOperationPlan(worktree, {
    operationID,
    phases: [
      {
        stage: "recon",
        objective: "Build a bounded inventory.",
        actions: ["Run passive discovery."],
        successCriteria: ["Inventory is recorded."],
        subagents: ["recon"],
        noSubagents: [],
      },
    ],
    reportingCloseout: [
      "report_lint before handoff",
      "report_render final package",
      "runtime_summary final accounting",
    ],
  })
}

async function addSupervisorLane(worktree: string, operationID = "School", status: "ready" | "complete" = "ready") {
  const root = operationPath(worktree, operationID)
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
  graph.lanes.push({
    id: "supervisor",
    title: "Supervisor heartbeat",
    agent: "pentest",
    status,
    dependsOn: [],
    modelRoute: "openai/gpt-5.5",
    fallbackModelRoutes: ["openai/gpt-5.4-mini-fast"],
    allowedTools: ["operation_supervise", "operation_resume", "operation_status"],
    expectedArtifacts: ["supervisor/latest.md"],
    budget: {},
    restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 30 },
    operationID: "school",
  })
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
}

async function writeLongSupervisedOperation(worktree: string, operationID = "School") {
  await createOperationGoal(worktree, {
    operationID,
    objective: "Authorized overnight internal assessment.",
    targetDurationHours: 20,
  })
  await writeBasicPlan(worktree, operationID)
  await writeOperationGraph(worktree, { operationID, budgetUSD: 10 })
  await addSupervisorLane(worktree, operationID)
  await writeRuntimeSummary(worktree, {
    operationID,
    usage: { costUSD: 1, budgetUSD: 10 },
    compaction: { pressure: "low" },
  })
}

describe("ULM runtime scheduler", () => {
  test("rejects raw credential secrets before writing scheduler heartbeat artifacts", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      runRuntimeScheduler(dir.path, {
        operationID: "School\ntoken: raw-token-123",
        maxCycles: 1,
      }),
    ).rejects.toThrow("runtime scheduler inputs must not contain raw credential secrets")
  })

  test("does not reject existing background job metadata while validating scheduler inputs", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      backgroundJobs: [
        {
          id: "existing-task",
          type: "task",
          title: "Existing task",
          status: "completed",
          startedAt: Date.now(),
          metadata: { operationID: "school", notes: "Historical bad metadata had token: raw-token-123." },
        },
      ],
    })

    expect(result.cycles).toHaveLength(1)
  })

  test("writes heartbeat and advances operation lanes without chat-memory coordination", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runRuntimeScheduler(dir.path, { operationID: "School", maxCycles: 1 })

    expect(result.cycles).toHaveLength(1)
    expect(result.cycles[0]?.run?.action).toBe("launch_lane")
    expect(result.cycles[0]?.governor.action).toBe("continue")
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.lastAction).toBe("launch_lane")
    expect(await fs.readFile(result.logPath, "utf8")).toContain('"cycle":1')
  })

  test("launches prepared model lanes through the scheduler owner hook", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const launched: Array<{ laneID: string; modelRoute: string }> = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      launchModelLane: async (params) => {
        launched.push({ laneID: params.laneID, modelRoute: params.modelRoute })
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(launched).toEqual([{ laneID: "district_profile", modelRoute: "openai/gpt-5.4-mini-fast" }])
    expect(result.cycles[0]?.launchedJobs).toEqual(["job-district_profile"])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.launchedJobs).toEqual(["job-district_profile"])
  })

  test("launches Discovery Charter research pass before any operation graph exists", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized 45-hour internal assessment.",
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
        purpose: "Research how to build a real duration-sized final plan.",
        researchQuestions: ["Which targets and evidence lanes can safely fill the window?"],
        reconInvestments: ["Passive inventory and safe service classification."],
        operatorQuestions: ["Which assets require inventory-only handling?"],
        candidateDeepWorkLanes: ["identity review", "web validation", "evidence normalization"],
        decisionCriteriaForFullPlan: ["Duration-fit evidence and overflow backlog exist."],
      },
    })
    const launched: Array<{ laneID: string; modelRoute: string; prompt: string }> = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 3,
      supervisorEnabled: false,
      launchModelLane: async (params) => {
        launched.push({ laneID: params.laneID, modelRoute: params.modelRoute, prompt: params.prompt })
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.cycles).toHaveLength(1)
    expect(result.cycles[0]?.run?.action).toBe("research_charter")
    expect(result.reason).toContain("approved Discovery Charter is ready")
    expect(launched).toHaveLength(1)
    expect(launched[0]?.laneID).toBe("discovery_research")
    expect(launched[0]?.modelRoute).toBe("openai/gpt-5.5")
    expect(launched[0]?.prompt).toContain("Your goal is research")
  })

  test("requeues stale claimed work units during scheduler cycles", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: "2026-05-05T00:00:00.000Z",
          units: [
            {
              id: "work-unit-web",
              operationID: "school",
              laneID: "web_inventory",
              profileID: "http-discovery",
              status: "running",
              variables: { inputFile: "queues/hosts.txt" },
              outputPrefix: "evidence/raw/http-discovery",
              rationale: "test",
              safety: "non_destructive",
              attempts: 1,
              createdAt: "2026-05-05T00:00:00.000Z",
              updatedAt: "2026-05-05T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    )

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      leaseSeconds: 60,
      now: new Date("2026-05-05T00:10:00.000Z"),
    })

    expect(result.cycles[0]?.requeuedWorkUnits).toEqual(["work-unit-web"])
    const queue = JSON.parse(await fs.readFile(path.join(root, "work-queue.json"), "utf8"))
    expect(queue.units[0]?.status).toBe("queued")
  })

  test("claims queued command units and launches them through the scheduler owner hook", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: "2026-05-05T00:00:00.000Z",
          units: [
            {
              id: "work-unit-http",
              operationID: "school",
              laneID: "web_inventory",
              profileID: "http-discovery",
              status: "queued",
              variables: { inputFile: "queues/hosts.txt" },
              outputPrefix: "evidence/raw/http-discovery",
              rationale: "test",
              safety: "non_destructive",
              attempts: 0,
              createdAt: "2026-05-05T00:00:00.000Z",
              updatedAt: "2026-05-05T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    )
    const launched: Array<{ workUnitID: string; dryRun: boolean }> = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      launchCommandWorkUnit: async (params) => {
        launched.push({ workUnitID: params.workUnitID, dryRun: params.dryRun })
        return { jobID: `cmd-${params.workUnitID}` }
      },
    })

    expect(launched).toEqual([{ workUnitID: "work-unit-http", dryRun: false }])
    expect(result.cycles[0]?.launchedCommandJobs).toEqual(["cmd-work-unit-http"])
    const queue = JSON.parse(await fs.readFile(path.join(root, "work-queue.json"), "utf8"))
    expect(queue.units[0]?.status).toBe("running")
    expect(queue.units[0]?.attempts).toBe(1)
  })

  test("runs supervisor heartbeats by default for long operations when the interval elapses", async () => {
    await using dir = await tmpdir({ git: true })
    await writeLongSupervisedOperation(dir.path)
    const launched: string[] = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 30,
      lastSupervisorReviewAt: new Date("2026-05-05T00:00:00.000Z"),
      now: new Date("2026-05-05T00:31:00.000Z"),
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.cycles[0]?.supervisor?.ran).toBe(true)
    expect(result.cycles[0]?.supervisor?.action).toBe("continue_coverage")
    expect(launched).toEqual(["district_profile"])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.supervisorRan).toBe(true)
    expect(heartbeat.supervisorAction).toBe("continue_coverage")
  })

  test("runs supervisor heartbeats by default for three-hour operations", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized three-hour internal assessment.",
      targetDurationHours: 3,
    })
    await writeBasicPlan(dir.path)
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await addSupervisorLane(dir.path, "School")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 30,
      lastSupervisorReviewAt: new Date("2026-05-05T00:00:00.000Z"),
      now: new Date("2026-05-05T00:31:00.000Z"),
    })

    expect(result.cycles[0]?.supervisor?.ran).toBe(true)
    expect(result.cycles[0]?.supervisor?.action).toBe("continue_coverage")
  })

  test("continues scheduler cycles after compact maintenance actions", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "high" },
    })

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 2,
    })

    expect(result.cycles).toHaveLength(2)
    expect(result.cycles.every((cycle) => cycle.run?.action === "compact")).toBe(true)
    expect(result.stopped).toBe(false)
    expect(result.reason).toBe("max scheduler cycles reached")
  })

  test("supervisor blockers prevent new lane launch", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized overnight internal assessment.",
      targetDurationHours: 20,
    })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const launched: string[] = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.stopped).toBe(true)
    expect(result.reason).toBe("operation plan is missing")
    expect(result.cycles[0]?.run).toBeUndefined()
    expect(result.cycles[0]?.supervisor?.action).toBe("blocked")
    expect(result.cycles[0]?.supervisor?.requiredNextTool).toBe("operation_plan")
    expect(launched).toEqual([])
  })

  test("supervisor queue_work decisions do not overblock scheduler progress", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized candidate validation check.",
    })
    await writeBasicPlan(dir.path)
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes = []
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await writeFinding(dir.path, {
      operationID: "School",
      title: "Candidate service exposure",
      state: "candidate",
      severity: "medium",
      confidence: 0.5,
      affectedAssets: ["10.0.0.5"],
      evidence: [],
      description: "A candidate issue needs validation or rejection.",
    })

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorEnabled: true,
      supervisorIntervalMinutes: 0,
    })

    expect(result.cycles[0]?.supervisor?.action).toBe("queue_work")
    expect(result.cycles[0]?.supervisor?.blocking).toBe(false)
    expect(result.cycles[0]?.run).toBeDefined()
    expect(result.reason).not.toBe("candidate or needs-validation findings remain")
  })

  test("expands the operation backlog when base lanes finish before the target window", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(
      dir.path,
      {
        operationID: "School",
        objective: "Authorized long-running internal assessment.",
        targetDurationHours: 7,
      },
      { now: "2026-05-05T00:00:00.000Z" },
    )
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes = parsed.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await writeCoverageContract(dir.path, {
      operationID: "School",
      status: "released",
      goals: ["Complete the base graph and keep expanding while runtime remains."],
      minimumEvidence: ["Lane proof exists."],
      requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
      allowedSkippedLanes: [],
      fallbackRules: ["Generate second-pass work when base lanes drain."],
      retryRules: ["Retry transient failures once."],
      subagentOpportunities: ["second-pass review"],
      reportGates: ["operation_audit finalHandoff=true"],
    })

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorEnabled: false,
      now: new Date("2026-05-05T00:30:00.000Z"),
    })
    const expanded = JSON.parse(await fs.readFile(graph.json, "utf8"))

    expect(result.cycles[0]?.run?.action).toBe("expand_work")
    expect(result.cycles[0]?.backlog?.generatedLanes).toEqual(["planned_work_expansion_1"])
    expect(result.stopped).toBe(false)
    expect(result.reason).toContain("expanded operation backlog before target runtime elapsed")
    expect(expanded.lanes.find((lane: { id: string }) => lane.id === "planned_work_expansion_1")?.status).toBe("ready")
  })

  test("backlog generation rejects credential-looking inputs and does not duplicate active graph work", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })

    await expect(
      generateOperationBacklog(dir.path, {
        operationID: "School",
        toolManifestPath: "password: Summer2026!",
      }),
    ).rejects.toThrow("operation backlog inputs must not contain raw credential secrets")

    const result = await generateOperationBacklog(dir.path, { operationID: "School" })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))

    expect(result.generatedLanes).toEqual([])
    expect(parsed.lanes.some((lane: { id: string }) => lane.id === "planned_work_expansion_1")).toBe(false)
  })

  test("supervisor recover decisions hold launches and point at the recovery path", async () => {
    await using dir = await tmpdir({ git: true })
    await writeLongSupervisedOperation(dir.path)
    const root = operationPath(dir.path, "School")
    const graphPath = path.join(root, "plans", "operation-graph.json")
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
    graph.lanes[0].status = "failed"
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
    const launched: string[] = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.stopped).toBe(false)
    expect(result.reason).toContain("failed")
    expect(result.cycles[0]?.supervisor?.action).toBe("recover")
    expect(result.cycles[0]?.supervisor?.nextTools).toContain("operation_resume")
    expect(result.cycles[0]?.run).toBeUndefined()
    expect(launched).toEqual([])
  })

  test("supervisor reporting decisions launch a report repair task instead of idling", async () => {
    await using dir = await tmpdir({ git: true })
    await writeLongSupervisedOperation(dir.path)
    const root = operationPath(dir.path, "School")
    const graphPath = path.join(root, "plans", "operation-graph.json")
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
    await writeCoverageContract(dir.path, {
      operationID: "School",
      status: "met",
      goals: ["Complete the authorized operation lanes."],
      minimumEvidence: ["Lane proof exists for each required lane."],
      requiredLanes: graph.lanes.map((lane: { id: string }) => lane.id),
      allowedSkippedLanes: [],
      fallbackRules: ["No fallback needed in this fixture."],
      retryRules: ["No retry needed in this fixture."],
      subagentOpportunities: ["report repair"],
      reportGates: ["operation_audit passes"],
    })
    await fs.mkdir(path.join(root, "deliverables"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID: "school",
          ok: false,
          blockers: ["final_handoff: reports/report-outline.md target_pages is too small: 4, expected at least 50"],
        },
        null,
        2,
      ) + "\n",
    )
    const launched: Array<{ laneID: string; subagent_type: string; prompt: string }> = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      launchModelLane: async (params) => {
        launched.push({ laneID: params.laneID, subagent_type: params.subagent_type, prompt: params.prompt })
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.reason).toBe("final operation audit has unresolved blockers")
    expect(result.cycles[0]?.supervisor?.action).toBe("continue_reporting")
    expect(launched[0]?.laneID).toBe("report_repair")
    expect(launched[0]?.subagent_type).toBe("report-writer")
    expect(launched[0]?.prompt).toContain("reports/report-outline.md target_pages is too small")
    expect(result.cycles[0]?.launchedJobs).toEqual(["job-report_repair"])
  })

  test("supervisor finalization window launches report closeout instead of more broad execution", async () => {
    await using dir = await tmpdir({ git: true })
    const goal = await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized 48-hour school laptop assessment.",
      targetDurationHours: 48,
    })
    const goalRecord = JSON.parse(await fs.readFile(goal.files.json, "utf8"))
    goalRecord.createdAt = "2026-05-01T00:00:00.000Z"
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
      operationID: "School",
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
          { stage: "recon", hours: 30, work: "Authorized discovery." },
          { stage: "validation", hours: 14, work: "Validate chains." },
          { stage: "reporting", hours: 4, work: "Final reports and audit." },
        ],
        executionBlocks: executionBlocks({ minutes: 44 * 60, laneID: "recon", stage: "recon" }),
        durationFit: {
          confidence: "duration_sized",
          evidence: ["48h target."],
          overflowBacklog: ["Defer extra discovery once finalization starts."],
        },
      },
      phases: [
        {
          stage: "recon",
          objective: "Build a bounded inventory.",
          actions: ["Run supervised inventory."],
          successCriteria: ["Inventory exists."],
          subagents: ["recon"],
          noSubagents: ["Final handoff approval"],
        },
        {
          stage: "reporting",
          objective: "Build final report package.",
          actions: ["Run report pipeline."],
          successCriteria: ["operation_audit passes."],
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
      reportingCloseout: ["report_lint", "report_render", "runtime_summary", "operation_audit"],
    })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await addSupervisorLane(dir.path, "School")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const launched: Array<{ laneID: string; prompt: string; description: string }> = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      now: new Date("2026-05-02T21:00:00.000Z"),
      launchModelLane: async (params) => {
        launched.push({ laneID: params.laneID, prompt: params.prompt, description: params.description })
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.reason).toContain("finalization window is open")
    expect(result.cycles[0]?.supervisor?.action).toBe("continue_reporting")
    expect(launched[0]?.laneID).toBe("report_repair")
    expect(launched[0]?.description).toBe("Start finalization report closeout")
    expect(launched[0]?.prompt).toContain("protected finalization window")
    expect(launched[0]?.prompt).toContain("Stop launching new broad discovery")
    expect(result.cycles[0]?.launchedJobs).toEqual(["job-report_repair"])
  })

  test("supervisor reporting decisions do not duplicate an active report repair task", async () => {
    await using dir = await tmpdir({ git: true })
    await writeLongSupervisedOperation(dir.path)
    const root = operationPath(dir.path, "School")
    const graphPath = path.join(root, "plans", "operation-graph.json")
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
    await writeCoverageContract(dir.path, {
      operationID: "School",
      status: "met",
      goals: ["Complete the authorized operation lanes."],
      minimumEvidence: ["Lane proof exists for each required lane."],
      requiredLanes: graph.lanes.map((lane: { id: string }) => lane.id),
      allowedSkippedLanes: [],
      fallbackRules: ["No fallback needed in this fixture."],
      retryRules: ["No retry needed in this fixture."],
      subagentOpportunities: ["report repair"],
      reportGates: ["operation_audit passes"],
    })
    await fs.mkdir(path.join(root, "deliverables"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID: "school",
          ok: false,
          blockers: ["final_handoff: deliverables/final/report.pdf has 11 pages, expected at least 50"],
        },
        null,
        2,
      ) + "\n",
    )
    const launched: string[] = []

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      backgroundJobs: [
        {
          id: "task_report_repair",
          type: "task",
          title: "Repair final report audit",
          status: "running",
          startedAt: Date.now(),
          metadata: { operationID: "school", laneID: "report_repair" },
        },
      ],
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(result.cycles[0]?.supervisor?.action).toBe("continue_reporting")
    expect(launched).toEqual([])
    expect(result.cycles[0]?.launchedJobs).toEqual([])
  })

  test("supervisor pre-handoff decisions reject complete lanes without lane proof", async () => {
    await using dir = await tmpdir({ git: true })
    const goal = await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Authorized overnight internal assessment.",
      targetDurationHours: 20,
    })
    await writeBasicPlan(dir.path)
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await addSupervisorLane(dir.path, "School", "complete")
    const root = operationPath(dir.path, "School")
    const graphPath = path.join(root, "plans", "operation-graph.json")
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete" }))
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
    await fs.writeFile(
      goal.files.json,
      JSON.stringify(
        {
          ...goal.goal,
          status: "complete",
          updatedAt: "2026-05-05T00:00:00.000Z",
          completedAt: "2026-05-05T00:00:00.000Z",
        },
        null,
        2,
      ) + "\n",
    )
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 9, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "final", "manifest.json"),
      JSON.stringify({ operationID: "school" }, null, 2) + "\n",
    )

    const result = await runRuntimeScheduler(dir.path, {
      operationID: "School",
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      supervisorReviewKind: "pre_handoff",
    })

    expect(result.cycles[0]?.supervisor?.action).toBe("continue_coverage")
    expect(result.cycles[0]?.run?.action).toBe("wait")
    expect(result.reason).toBe("coverage contract is not release-ready")
  })
})
