import { describe, expect, test } from "bun:test"
import path from "path"
import { browserWorkbenchConfig } from "@/ulm/browser-workbench"
import { tmpdir } from "../fixture/fixture"

describe("ULM browser workbench", () => {
  test("generates operation-local browser artifact paths", async () => {
    await using dir = await tmpdir({ git: true })

    const config = browserWorkbenchConfig(dir.path, { operationID: "School" })

    expect(config.operationID).toBe("school")
    expect(config.profileDir).toBe(path.join(dir.path, ".ulmcode", "operations", "school", "browser", "profile"))
    expect(config.screenshotsDir).toBe(path.join(dir.path, ".ulmcode", "operations", "school", "browser", "screenshots"))
    expect(config.downloadsDir).toBe(path.join(dir.path, ".ulmcode", "operations", "school", "browser", "downloads"))
    expect(config.sessionLogPath).toBe(path.join(dir.path, ".ulmcode", "operations", "school", "browser", "session-log.jsonl"))
    expect(config.preferredMcp).toBe("playwright-persistent")
  })

  test("rejects browser paths that escape the operation root", async () => {
    await using dir = await tmpdir({ git: true })

    expect(() =>
      browserWorkbenchConfig(dir.path, {
        operationID: "School",
        profileDir: path.join(dir.path, ".ulmcode", "operations", "other", "browser", "profile"),
      }),
    ).toThrow("browser workbench path must stay inside operation browser root")
  })
})
