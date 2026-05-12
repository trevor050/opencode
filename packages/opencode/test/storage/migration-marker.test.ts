import { describe, expect, test } from "bun:test"
import { shouldRunJsonMigration } from "@/storage/migration-marker"

describe("shouldRunJsonMigration", () => {
  test("skips migration when the configured database already exists", async () => {
    const checked: string[] = []
    const shouldRun = await shouldRunJsonMigration({
      databasePath: "/tmp/opencode-local.db",
      exists: (file) => {
        checked.push(file)
        return file === "/tmp/opencode-local.db"
      },
    })

    expect(shouldRun).toBe(false)
    expect(checked).toEqual(["/tmp/opencode-local.db"])
  })

  test("runs migration when the configured database is missing", async () => {
    await expect(
      shouldRunJsonMigration({
        databasePath: "/tmp/opencode-local.db",
        exists: () => false,
      }),
    ).resolves.toBe(true)
  })

  test("skips migration for in-memory databases", async () => {
    const shouldRun = await shouldRunJsonMigration({
      databasePath: ":memory:",
      exists: () => {
        throw new Error("in-memory database should not hit filesystem")
      },
    })

    expect(shouldRun).toBe(false)
  })
})
