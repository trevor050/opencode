import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import {
  BENCHMARK_SUITE_OPERATION_LANES,
  REPORT_ONLY_OPERATION_LANES,
  REQUIRED_OPERATION_LANES,
  buildOperationGraph,
  validateOperationGraph,
  writeOperationGraph,
} from "@/ulm/operation-graph"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation graph", () => {
  test("builds the required long-run lanes with dependencies and model routes", () => {
    const graph = buildOperationGraph({
      operationID: "School",
      budgetUSD: 20,
      modelRoutes: {
        throughput: "openai/gpt-5.4-mini-fast",
        reasoning: "openai/gpt-5.5",
        reporting: "openai/gpt-5.5",
        review: "openai/gpt-5.5",
        small: "openai/gpt-5.4-mini-fast",
      },
    })

    expect(graph.operationID).toBe("school")
    expect(graph.safetyMode).toBe("non_destructive")
    expect(graph.trustLevel).toBe("moderate")
    expect(graph.scanProfile).toBe("balanced")
    expect(graph.lanes.map((lane) => lane.id)).toEqual([...REQUIRED_OPERATION_LANES])
    expect(validateOperationGraph(graph)).toEqual([])
    expect(graph.lanes.find((lane) => lane.id === "district_profile")?.status).toBe("ready")
    expect(graph.lanes.find((lane) => lane.id === "person_recon")?.status).toBe("ready")
    expect(graph.lanes.find((lane) => lane.id === "recon")?.status).toBe("ready")
    expect(graph.lanes.find((lane) => lane.id === "recon")?.dependsOn).toEqual([])
    expect(graph.lanes.find((lane) => lane.id === "report_writing")?.dependsOn).toEqual(["report_evidence_index"])
    expect(graph.lanes.every((lane) => lane.modelRoute.includes("/"))).toBe(true)
    expect(graph.lanes.find((lane) => lane.id === "recon")?.fallbackModelRoutes.length).toBeGreaterThanOrEqual(1)
    expect(graph.lanes.find((lane) => lane.id === "report_writing")?.modelRoute).toBe("openai/gpt-5.5")
    expect(graph.lanes.find((lane) => lane.id === "recon")?.modelRoute).toBe("openai/gpt-5.4-mini-fast")
    expect(graph.lanes.find((lane) => lane.id === "recon")?.fallbackModelRoutes).toContain("openai/gpt-5.5")
    expect(graph.lanes.find((lane) => lane.id === "recon")?.coverageImpact).toBe("blocks_release")
    expect(graph.lanes.find((lane) => lane.id === "report_review")?.releaseRequired).toBe(true)
    expect(graph.lanes.find((lane) => lane.id === "district_profile")?.allowedTools).toEqual(
      expect.arrayContaining(["bash", "read", "grep", "glob"]),
    )
    expect(graph.lanes.reduce((sum, lane) => sum + (lane.budget.maxUSD ?? 0), 0)).toBeCloseTo(20, 2)
  })

  test("rejects graphs that skip required lanes or use raw shell in unattended mode", () => {
    const graph = buildOperationGraph({ operationID: "School" })
    graph.lanes = graph.lanes.filter((lane) => lane.id !== "report_review")
    graph.lanes[0]!.allowedTools.push("shell")

    expect(validateOperationGraph(graph)).toContain("missing required lane: report_review")
    expect(validateOperationGraph(graph)).toContain(
      "district_profile: non_destructive lanes must use command_supervise instead of raw shell",
    )
  })

  test("defaults primary reasoning and reporting lanes to GPT-5.5 non-fast", () => {
    const graph = buildOperationGraph({ operationID: "School" })

    expect(graph.lanes.find((lane) => lane.id === "identity_graph")?.modelRoute).toBe("openai/gpt-5.5")
    expect(graph.lanes.find((lane) => lane.id === "report_writing")?.modelRoute).toBe("openai/gpt-5.5")
    expect(graph.lanes.find((lane) => lane.id === "report_review")?.modelRoute).toBe("openai/gpt-5.5")
  })

  test("defaults throughput lanes to OpenAI mini instead of unavailable subscription routes", () => {
    const graph = buildOperationGraph({ operationID: "School" })
    const throughputLane = graph.lanes.find((lane) => lane.id === "recon")

    expect(throughputLane?.modelRoute).toBe("openai/gpt-5.4-mini-fast")
    expect(throughputLane?.fallbackModelRoutes).toEqual(["openai/gpt-5.5"])
    expect(graph.lanes.flatMap((lane) => [lane.modelRoute, ...lane.fallbackModelRoutes]).every((route) => route.startsWith("openai/"))).toBe(
      true,
    )
  })

  test("rejects non-OpenAI model routes in operation graphs", () => {
    const graph = buildOperationGraph({
      operationID: "School",
      modelRoutes: { throughput: "other-provider/other-model" },
    })

    expect(validateOperationGraph(graph)).toContain("district_profile: modelRoute provider must be openai")
  })

  test("writes a durable operation graph artifact", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await writeOperationGraph(dir.path, { operationID: "School", maxConcurrentLanes: 3 })

    expect(result.lanes).toBe(REQUIRED_OPERATION_LANES.length)
    const json = JSON.parse(await fs.readFile(result.json, "utf8")) as {
      maxConcurrentLanes?: number
      trustLevel?: string
      scanProfile?: string
      lanes?: unknown[]
    }
    const markdown = await fs.readFile(result.markdown, "utf8")
    expect(json.maxConcurrentLanes).toBe(3)
    expect(json.trustLevel).toBe("moderate")
    expect(json.scanProfile).toBe("balanced")
    expect(json.lanes).toHaveLength(REQUIRED_OPERATION_LANES.length)
    expect(markdown).toContain("## Lanes")
    expect(markdown).toContain("report_review")
  })

  test("rejects raw credential secrets before writing operation graph artifacts", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      writeOperationGraph(dir.path, {
        operationID: "School\npassword: Summer2026!",
        maxConcurrentLanes: 3,
      }),
    ).rejects.toThrow("operation graphs must not contain raw credential secrets")
  })

  test("archives stale lane proofs when rescheduling with a different template", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "Home Network" })
    const staleProof = `${dir.path}/.ulmcode/operations/home-network/lane-complete/district_profile.json`
    const sameLaneStaleProof = `${dir.path}/.ulmcode/operations/home-network/lane-complete/recon.json`
    await fs.mkdir(`${dir.path}/.ulmcode/operations/home-network/lane-complete`, { recursive: true })
    await fs.writeFile(staleProof, "{}\n")
    await fs.writeFile(
      sameLaneStaleProof,
      JSON.stringify({
        operationID: "home-network",
        laneID: "recon",
        status: "skipped",
        completedAt: "2026-01-01T00:00:00.000Z",
        summary: "Old graph proof.",
        artifacts: [],
        evidenceRefs: [],
      }) + "\n",
    )

    const result = await writeOperationGraph(dir.path, {
      operationID: "Home Network",
      template: "internal-network",
      forceReschedule: true,
    })
    const archiveRoot = `${dir.path}/.ulmcode/operations/home-network/lane-complete-stale`
    const archiveBatches = await fs.readdir(archiveRoot)
    const archivedProofs = await Promise.all(
      archiveBatches.flatMap((batch) => [
        Bun.file(`${archiveRoot}/${batch}/district_profile.json`).exists(),
        Bun.file(`${archiveRoot}/${batch}/recon.json`).exists(),
      ]),
    )

    expect(result.archivedStaleLaneProofs).toBe(2)
    expect(await Bun.file(staleProof).exists()).toBe(false)
    expect(await Bun.file(sameLaneStaleProof).exists()).toBe(false)
    expect(archivedProofs.filter(Boolean)).toHaveLength(2)
  })

  test("rejects accidental reschedules after an operation graph already exists", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "Home Network" })

    await expect(writeOperationGraph(dir.path, { operationID: "Home Network", template: "internal-network" })).rejects.toThrow(
      "operation graph already exists",
    )
  })

  test("builds internal-network lanes without district recon baggage", () => {
    const graph = buildOperationGraph({
      operationID: "Home Network",
      template: "internal-network",
      includeSupervisor: true,
      budgetUSD: 30,
      trustLevel: "unattended",
      scanProfile: "aggressive",
    })
    const laneIDs = graph.lanes.map((lane) => lane.id)

    expect(graph.operationID).toBe("home-network")
    expect(graph.trustLevel).toBe("unattended")
    expect(graph.scanProfile).toBe("aggressive")
    expect(laneIDs).toContain("network_discovery")
    expect(laneIDs).toContain("service_inventory")
    expect(laneIDs).toContain("supervisor")
    expect(graph.lanes.find((lane) => lane.id === "network_discovery")?.status).toBe("ready")
    expect(laneIDs).not.toContain("district_profile")
    expect(laneIDs).not.toContain("person_recon")
    expect(laneIDs).not.toContain("scope_intake")
    expect(validateOperationGraph(graph)).toEqual([])
    expect(graph.lanes.find((lane) => lane.id === "network_discovery")?.allowedTools).toContain("command_supervise")
    expect(graph.lanes.find((lane) => lane.id === "network_discovery")?.allowedTools).toContain("operation_run")
    expect(graph.lanes.find((lane) => lane.id === "network_discovery")?.allowedTools).toContain("write")
    expect(graph.lanes.find((lane) => lane.id === "network_discovery")?.expectedArtifacts).toContain(
      "commands/service-inventory/",
    )
    expect(graph.lanes.find((lane) => lane.id === "evidence_normalization")?.dependsOn).toEqual([
      "service_inventory",
      "web_inventory",
    ])
    expect(graph.lanes.find((lane) => lane.id === "finding_validation")?.dependsOn).toEqual([
      "evidence_normalization",
    ])
    expect(graph.lanes.find((lane) => lane.id === "finding_validation")?.allowedTools).toContain("operation_status")
    expect(graph.lanes.find((lane) => lane.id === "report_writing")?.allowedTools).toContain("write")
    expect(graph.lanes.find((lane) => lane.id === "supervisor")?.allowedTools).toContain("operation_supervise")
    expect(graph.lanes.find((lane) => lane.id === "operator_summary")?.releaseRequired).toBe(true)
    expect(graph.lanes.reduce((sum, lane) => sum + (lane.budget.maxUSD ?? 0), 0)).toBeCloseTo(30, 2)
  })

  test("expands operation plan execution blocks into scheduler lanes before reporting", async () => {
    await using dir = await tmpdir({ git: true })
    const operationRoot = `${dir.path}/.ulmcode/operations/home-network`
    await fs.mkdir(`${operationRoot}/plans`, { recursive: true })
    await fs.writeFile(
      `${operationRoot}/plans/operation-plan.json`,
      JSON.stringify(
        {
          operationID: "home-network",
          timeBudget: {
            targetHours: 7,
            finalizationWindowHours: 1,
            executionBlocks: [
              {
                id: "lan-discovery-1",
                stage: "recon",
                laneID: "service_inventory",
                title: "LAN discovery block 1",
                startMinute: 0,
                durationMinutes: 30,
                objective: "Run bounded service inventory chunk.",
                actions: ["Run supervised inventory."],
                successCriteria: ["Chunk has evidence or blocker."],
                fallbackWork: ["Narrow the chunk and retry once."],
                subagents: ["recon"],
                expectedArtifacts: ["work-blocks/lan-discovery-1.md"],
              },
              {
                id: "validation-1",
                stage: "validation",
                laneID: "finding_validation",
                title: "Validation block 1",
                startMinute: 30,
                durationMinutes: 30,
                objective: "Validate candidate findings.",
                actions: ["Review normalized evidence."],
                successCriteria: ["Candidates are promoted or rejected."],
                fallbackWork: ["Record a limitation and continue queued validation."],
                subagents: ["validator"],
                expectedArtifacts: ["work-blocks/validation-1.md"],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await writeOperationGraph(dir.path, { operationID: "Home Network", template: "internal-network" })
    const graph = JSON.parse(await fs.readFile(result.json, "utf8"))
    const laneIDs = graph.lanes.map((lane: { id: string }) => lane.id)

    expect(laneIDs).toContain("planned_work_lan_discovery_1")
    expect(laneIDs).toContain("planned_work_validation_1")
    expect(laneIDs.indexOf("planned_work_validation_1")).toBeLessThan(laneIDs.indexOf("report_evidence_index"))
    expect(graph.lanes.find((lane: { id: string }) => lane.id === "planned_work_lan_discovery_1")?.dependsOn).toEqual([
      "service_inventory",
    ])
    expect(graph.lanes.find((lane: { id: string; minRuntimeMinutes?: number }) => lane.id === "planned_work_lan_discovery_1")?.minRuntimeMinutes).toBe(24)
    expect(graph.lanes.find((lane: { id: string }) => lane.id === "planned_work_validation_1")?.dependsOn).toEqual([
      "planned_work_lan_discovery_1",
    ])
    expect(graph.lanes.find((lane: { id: string }) => lane.id === "report_writing")?.dependsOn).toContain(
      "planned_work_validation_1",
    )
  })

  test("includes a supervisor lane by default for the school laptop 48h template", () => {
    const graph = buildOperationGraph({
      operationID: "First Real School Laptop",
      template: "school-laptop-48h",
      trustLevel: "unattended",
      scanProfile: "aggressive",
    })

    expect(graph.lanes.map((lane) => lane.id)).toContain("supervisor")
    expect(graph.lanes.find((lane) => lane.id === "supervisor")?.allowedTools).toContain("operation_supervise")
    expect(graph.lanes.find((lane) => lane.id === "supervisor")?.allowedTools).toEqual(
      expect.arrayContaining(["operation_next", "operation_run", "task", "command_supervise"]),
    )
  })

  test("builds report-only lanes without recon and identity discovery work", () => {
    const graph = buildOperationGraph({
      operationID: "Report Repair",
      template: "report-only",
      includeSupervisor: true,
      budgetUSD: 5,
    })
    const laneIDs = graph.lanes.map((lane) => lane.id)

    expect(laneIDs).toEqual([...REPORT_ONLY_OPERATION_LANES, "supervisor"])
    expect(laneIDs).not.toContain("district_profile")
    expect(laneIDs).not.toContain("person_recon")
    expect(laneIDs).not.toContain("recon")
    expect(laneIDs).not.toContain("web_inventory")
    expect(graph.lanes.find((lane) => lane.id === "evidence_normalization")?.status).toBe("ready")
    expect(graph.lanes.find((lane) => lane.id === "evidence_normalization")?.dependsOn).toEqual([])
    expect(graph.lanes.find((lane) => lane.id === "report_writing")?.dependsOn).toEqual(["report_evidence_index"])
    expect(graph.lanes.find((lane) => lane.id === "supervisor")?.allowedTools).toContain("operation_supervise")
    expect(validateOperationGraph(graph)).toEqual([])
  })

  test("uses synthetic web evidence expectations for benchmark-suite schedules", () => {
    const graph = buildOperationGraph({
      operationID: "Synthetic Closeout",
      template: "benchmark-suite",
      includeSupervisor: true,
    })
    const laneIDs = graph.lanes.map((lane) => lane.id)
    const web = graph.lanes.find((lane) => lane.id === "web_inventory")
    const recon = graph.lanes.find((lane) => lane.id === "recon")
    const evidence = graph.lanes.find((lane) => lane.id === "evidence_normalization")

    expect(laneIDs).toEqual([...BENCHMARK_SUITE_OPERATION_LANES, "supervisor"])
    expect(laneIDs).not.toContain("district_profile")
    expect(laneIDs).not.toContain("saas_cloud_review")
    expect(web?.title).toBe("Synthetic web inventory review")
    expect(web?.expectedArtifacts).toEqual(["evidence/synthetic-web-inventory.md"])
    expect(web?.coverageImpact).toBe("none")
    expect(web?.releaseRequired).toBe(false)
    expect(recon?.title).toBe("Synthetic evidence intake")
    expect(recon?.expectedArtifacts).toEqual(["evidence/"])
    expect(evidence?.dependsOn).toEqual(["recon", "web_inventory", "identity_graph", "identity_auth_review"])
    expect(validateOperationGraph(graph)).toEqual([])
  })

  test("uses evidence-record web inventory proof for school laptop schedules", () => {
    const graph = buildOperationGraph({
      operationID: "School Laptop",
      template: "school-laptop-48h",
      includeSupervisor: true,
    })
    const web = graph.lanes.find((lane) => lane.id === "web_inventory")

    expect(web?.title).toBe("Private Wi-Fi inventory evidence")
    expect(web?.expectedArtifacts).toEqual(["evidence/ev-wifi-inventory.json"])
    expect(web?.coverageImpact).toBe("blocks_release")
    expect(web?.releaseRequired).toBe(true)
    expect(validateOperationGraph(graph)).toEqual([])
  })

  test("rejects stale internal-network graphs that accidentally use district lanes", () => {
    const graph = buildOperationGraph({ operationID: "Home Network", template: "internal-network" })
    graph.lanes.push({
      ...graph.lanes[0]!,
      id: "district_profile",
      title: "District profile and public system map",
    })

    expect(validateOperationGraph(graph)).toContain("internal-network graph must not include district_profile")
  })
})
