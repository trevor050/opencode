import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath, writeOperationCheckpoint, writeRuntimeSummary } from "@/ulm/artifact"
import { buildOperationBoard } from "@/ulm/operation-board"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation board", () => {
  test("generates a read-only board from existing operation artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationCheckpoint(dir.path, {
      operationID: "School",
      objective: "Authorized district assessment",
      stage: "validation",
      status: "running",
      summary: "Identity review is active.",
      nextActions: ["Review SIS role surfaces"],
      blockers: ["Need operator login"],
    })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, { operationID: "School" })
    const root = operationPath(dir.path, "School")
    await fs.mkdir(path.join(root, "strategy"), { recursive: true })
    await fs.writeFile(
      path.join(root, "strategy", "next-actions.json"),
      JSON.stringify({ operationID: "school", items: [{ title: "Open logged-in SIS", why: "Identity coverage gap" }] }, null, 2),
    )
    await fs.mkdir(path.join(root, "browser"), { recursive: true })
    await fs.writeFile(path.join(root, "browser", "session-log.jsonl"), "{\"event\":\"opened\"}\n")

    const board = await buildOperationBoard(dir.path, { operationID: "School" })

    expect(board.record.operationID).toBe("school")
    expect(board.record.sections.currentObjective).toContain("Authorized district assessment")
    expect(board.record.sections.nextStrategyItems).toContain("Open logged-in SIS")
    expect(board.record.sections.browserSessions).toContain("browser/session-log.jsonl")
    expect(board.markdown).toContain("## Blocked Work")
    expect(board.json).toBe(path.join(root, "board", "operation-board.json"))
  })
})
