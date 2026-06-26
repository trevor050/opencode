import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { scoreBrowserBakeoffCandidates, writeBrowserBakeoff } from "@/ulm/browser-bakeoff"
import { tmpdir } from "../fixture/fixture"

describe("ULM browser MCP bakeoff", () => {
  test("scores persistent authenticated browser candidates by long-run needs", () => {
    const result = scoreBrowserBakeoffCandidates()

    expect(result.criteria).toContain("persistent login/session state")
    expect(result.criteria).toContain("operation artifact logging")
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([
      "playwright-persistent",
      "browser-mcp-existing-profile",
      "chrome-devtools-companion",
    ])
    expect(result.candidates[0]?.strengths).toContain("persistent browser profile")
    expect(result.candidates[0]?.score).toBeGreaterThan(result.candidates[2]?.score ?? 0)
  })

  test("writes bakeoff artifacts under the operation browser directory", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await writeBrowserBakeoff(dir.path, { operationID: "School" })
    const root = operationPath(dir.path, "School")
    const json = JSON.parse(await fs.readFile(path.join(root, "browser", "bakeoff.json"), "utf8"))
    const markdown = await fs.readFile(path.join(root, "browser", "bakeoff.md"), "utf8")

    expect(result.files.json).toBe(path.join(root, "browser", "bakeoff.json"))
    expect(json.candidates[0].id).toBe("playwright-persistent")
    expect(markdown).toContain("## Candidates")
  })
})
