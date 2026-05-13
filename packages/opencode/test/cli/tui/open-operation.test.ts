import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { bindOperationSession } from "@/ulm/operation-context"
import { tmpdir } from "../../fixture/fixture"
import { resolveOpenOperationPath } from "@/cli/cmd/tui/routes/session/open-operation"

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

describe("TUI open operation command", () => {
  test("resolves the bound operation root for the current chat", async () => {
    await using dir = await tmpdir({ git: true })
    await writeJson(path.join(dir.path, ".ulmcode", "operations", "school", "goals", "operation-goal.json"), {
      operationID: "school",
      objective: "Authorized school assessment",
      status: "active",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
    })
    await bindOperationSession(dir.path, { sessionID: "session-1" as any, operationID: "school" })

    await expect(resolveOpenOperationPath({ worktree: dir.path, sessionID: "session-1" as any })).resolves.toBe(
      path.join(dir.path, ".ulmcode", "operations", "school"),
    )
  })

  test("falls back to the operation store when the chat has no bound operation", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(resolveOpenOperationPath({ worktree: dir.path, sessionID: "session-1" as any })).resolves.toBe(
      path.join(dir.path, ".ulmcode", "operations"),
    )
  })
})
