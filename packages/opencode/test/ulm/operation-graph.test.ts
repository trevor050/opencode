import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import {
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
        throughput: "opencode-go/nano",
        reasoning: "openai/gpt-5.5-fast",
        reporting: "openai/gpt-5.5-fast",
        review: "openai/gpt-5.5-fast",
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
    expect(graph.lanes.every((lane) => lane.fallbackModelRoutes.length >= 1)).toBe(true)
    expect(graph.lanes.find((lane) => lane.id === "recon")?.fallbackModelRoutes).toContain("openai/gpt-5.4-mini-fast")
    expect(graph.lanes.find((lane) => lane.id === "recon")?.coverageImpact).toBe("blocks_release")
    expect(graph.lanes.find((lane) => lane.id === "report_review")?.releaseRequired).toBe(true)
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
    expect(graph.lanes.find((lane) => lane.id === "supervisor")?.allowedTools).toContain("operation_supervise")
    expect(graph.lanes.find((lane) => lane.id === "operator_summary")?.releaseRequired).toBe(true)
    expect(graph.lanes.reduce((sum, lane) => sum + (lane.budget.maxUSD ?? 0), 0)).toBeCloseTo(30, 2)
  })
})
