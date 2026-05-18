import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

describe("session prompt logging", () => {
  test("does not emit per-iteration loop counters at info level", async () => {
    const source = await fs.readFile(path.join(__dirname, "../../src/session/prompt.ts"), "utf8")

    expect(source).not.toContain('slog.info("loop"')
    expect(source).not.toContain('slog.info("exiting loop"')
  })

  test("passes the active session id into ULM environment context", async () => {
    const source = await fs.readFile(path.join(__dirname, "../../src/session/prompt.ts"), "utf8")

    expect(source).toContain("sys.environment(model, { sessionID })")
  })
})
