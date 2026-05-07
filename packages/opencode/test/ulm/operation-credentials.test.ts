import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Storage } from "@/storage/storage"
import {
  materializeOperationCredentials,
  readOperationCredentials,
  writeOperationCredential,
} from "@/ulm/operation-credentials"
import { tmpdir } from "../fixture/fixture"

function memoryStorage() {
  const values = new Map<string, unknown>()
  const key = (parts: string[]) => parts.join("/")
  return Storage.Service.of({
    remove: (parts) =>
      Effect.sync(() => {
        values.delete(key(parts))
      }),
    read: <T>(parts: string[]) =>
      Effect.sync(() => {
        if (!values.has(key(parts))) throw new Error(`missing ${key(parts)}`)
        return values.get(key(parts)) as T
      }),
    update: <T>(parts: string[], fn: (draft: T) => void) =>
      Effect.sync(() => {
        const value = values.get(key(parts)) as T
        fn(value)
        values.set(key(parts), value)
        return value
      }),
    write: <T>(parts: string[], content: T) =>
      Effect.sync(() => {
        values.set(key(parts), content)
      }),
    list: (prefix) =>
      Effect.sync(() =>
        [...values.keys()]
          .filter((item) => item.startsWith(`${key(prefix)}/`))
          .map((item) => item.split("/")),
      ),
  })
}

describe("ULM operation credentials", () => {
  test("stores operation credentials in app storage with a permissioned redacted index", async () => {
    await using dir = await tmpdir({ git: true })
    const storage = memoryStorage()
    const result = await writeOperationCredential(storage, dir.path, {
      operationID: "School Login",
      label: "student portal test account",
      username: "student@example.edu",
      password: "correct horse battery staple",
      url: "https://portal.example.edu/login",
      tags: ["student", "portal"],
      notes: "Authorized test account.",
    })

    expect(result.operationID).toBe("school-login")
    expect(result.credentialID).toBe("student-portal-test-account")
    expect(result.credential.password).toBe("********")
    expect(result.credential.username).toBe("student@example.edu")

    const index = path.join(dir.path, ".ulmcode", "operations", "school-login", "credentials", "index.json")
    expect((await fs.stat(path.dirname(index))).mode & 0o777).toBe(0o700)
    expect((await fs.stat(index)).mode & 0o777).toBe(0o600)
    expect(await fs.readFile(index, "utf8")).not.toContain("correct horse battery staple")

    const list = await readOperationCredentials(dir.path, { operationID: "School Login" })
    expect(list.credentials).toEqual([
      {
        credentialID: "student-portal-test-account",
        label: "student portal test account",
        username: "student@example.edu",
        password: "********",
        url: "https://portal.example.edu/login",
        tags: ["student", "portal"],
        notes: "Authorized test account.",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ])

    const materialized = await materializeOperationCredentials(storage, dir.path, { operationID: "School Login" })
    expect((await fs.stat(materialized.envFile)).mode & 0o777).toBe(0o600)
    expect(await fs.readFile(materialized.envFile, "utf8")).toContain("correct horse battery staple")
  })
})
