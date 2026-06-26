import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { decideOperationNext } from "@/ulm/operation-next"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeRuntimeSummary } from "@/ulm/artifact"
import { tmpdir } from "../fixture/fixture"

async function writeStrategy(root: string, value: unknown) {
  const strategyDir = path.join(root, "strategy")
  await fs.mkdir(strategyDir, { recursive: true })
  await fs.writeFile(path.join(strategyDir, "next-actions.json"), JSON.stringify(value, null, 2) + "\n")
}

describe("ULM scheduler strategy hints", () => {
  test("strategy hints bias ready lane selection without becoming hard law", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = [
      {
        ...graph.lanes.find((lane: { id: string }) => lane.id === "recon"),
        status: "ready",
        dependsOn: [],
        coverageImpact: "high",
      },
      {
        ...graph.lanes.find((lane: { id: string }) => lane.id === "identity_auth_review"),
        id: "sis_browser_review",
        title: "SIS browser review",
        status: "ready",
        dependsOn: [],
        coverageImpact: "medium",
        priorityCategory: "critical_capability",
        expectedArtifacts: ["browser/session-log.jsonl"],
      },
    ]
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await writeStrategy(operationPath(dir.path, "School"), {
      operationID: "School",
      items: [{ title: "Open logged-in SIS and inspect role/export surfaces", suggestedLane: "sis_browser_review" }],
    })

    const result = await decideOperationNext(dir.path, {
      operationID: "School",
      now: "2026-06-26T12:00:00.000Z",
    })

    expect(result.action.action).toBe("launch_lane")
    if (result.action.action !== "launch_lane") throw new Error("expected launch_lane")
    expect(result.action.lane.id).toBe("sis_browser_review")
    expect(result.action.reason).toContain("strategy hint")
  })

  test("unknown strategy lane hints are recorded as gaps while scheduler still chooses useful work", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    await writeStrategy(root, {
      operationID: "School",
      items: [{ title: "Review a portal lane that does not exist", suggestedLane: "missing_portal_lane" }],
    })

    const result = await decideOperationNext(dir.path, { operationID: "School" })
    const gaps = JSON.parse(await fs.readFile(path.join(root, "strategy", "hint-gaps.json"), "utf8"))

    expect(result.action.action).toBe("launch_lane")
    expect(gaps.gaps).toContain("strategy suggested missing lane missing-portal-lane")
  })
})
