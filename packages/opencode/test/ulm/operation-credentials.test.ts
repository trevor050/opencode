import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Storage } from "@/storage/storage"
import {
  inspectOperationCredentials,
  materializeOperationCredentials,
  readOperationCredentials,
  readOperationCredentialReview,
  submitOperationCredentialReview,
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

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

describe("ULM operation credentials", () => {
  test("stores operation credentials in app storage with a permissioned redacted index", async () => {
    await using dir = await tmpdir({ git: true })
    const storage = memoryStorage()
    const result = await writeOperationCredential(storage, dir.path, {
      operationID: "School Login",
      label: "student portal test account",
      type: "Web Login",
      username: "student@example.edu",
      password: "correct horse battery staple",
      url: "https://portal.example.edu/login",
      target: "portal.example.edu",
      tags: ["student", "portal"],
      notes: "Authorized test account.",
      rules: "Use only for low-privilege authenticated checks.",
    })

    expect(result.operationID).toBe("school-login")
    expect(result.credentialID).toBe("student-portal-test-account")
    expect(result.credential.password).toBe("********")
    expect(result.credential.username).toBe("student@example.edu")

    const index = path.join(dir.path, ".ulmcode", "operations", "school-login", "credentials", "index.json")
    expect((await fs.stat(path.dirname(index))).mode & 0o777).toBe(0o700)
    expect((await fs.stat(index)).mode & 0o777).toBe(0o600)
    expect(await fs.readFile(index, "utf8")).not.toContain("correct horse battery staple")
    expect(await fs.readFile(index, "utf8")).toContain("Use only for low-privilege authenticated checks.")

    const list = await readOperationCredentials(dir.path, { operationID: "School Login" })
    expect(list.credentials).toEqual([
      {
        credentialID: "student-portal-test-account",
        label: "student portal test account",
        type: "Web Login",
        username: "student@example.edu",
        password: "********",
        url: "https://portal.example.edu/login",
        target: "portal.example.edu",
        tags: ["student", "portal"],
        notes: "Authorized test account.",
        rules: "Use only for low-privilege authenticated checks.",
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ])

    const materialized = await materializeOperationCredentials(storage, dir.path, { operationID: "School Login" })
    expect((await fs.stat(materialized.envFile)).mode & 0o777).toBe(0o600)
    expect(await fs.readFile(materialized.envFile, "utf8")).toContain("correct horse battery staple")
    expect(await fs.readFile(materialized.envFile, "utf8")).toContain("ULMCODE_CREDENTIAL_STUDENT_PORTAL_TEST_ACCOUNT_SECRET")
    expect(await fs.readFile(materialized.envFile, "utf8")).toContain("ULMCODE_CREDENTIAL_STUDENT_PORTAL_TEST_ACCOUNT_TARGET")

    const submission = await submitOperationCredentialReview(dir.path, { operationID: "School Login" })
    expect((await fs.stat(submission.file)).mode & 0o777).toBe(0o600)
    expect(submission.credentials[0]?.credentialID).toBe("student-portal-test-account")
    expect(JSON.stringify(submission)).not.toContain("correct horse battery staple")

    const review = await readOperationCredentialReview(dir.path, { operationID: "School Login" })
    expect(review.submittedAt).toBe(submission.submittedAt)
    expect(review.credentials[0]?.password).toBe("********")
  })

  test("inspects raw-note credentials with secret values redacted", async () => {
    await using dir = await tmpdir({ git: true })
    const storage = memoryStorage()
    await writeOperationCredential(storage, dir.path, {
      operationID: "Home Network",
      label: "Wifi Info",
      type: "Raw Note",
      secret: "ssid: TrevorNet\npassword: hunter2\noperator note: router closet upstairs",
      target: "raw vault item",
      notes: "Use only for home network validation.",
      rules: "No credential spraying.",
    })

    const inspected = await inspectOperationCredentials(storage, dir.path, {
      operationID: "Home Network",
      credentialID: "Wifi Info",
    })

    expect(JSON.stringify(inspected)).not.toContain("hunter2")
    expect(inspected.credentials[0]?.secret).toBe("********")
    expect(inspected.credentials[0]?.secretPreview).toContain("ssid: TrevorNet")
    expect(inspected.credentials[0]?.secretPreview).toContain("password: ********")
    expect(inspected.credentials[0]?.secretPreview).toContain("operator note: router closet upstairs")
    expect(inspected.credentials[0]?.notes).toBe("Use only for home network validation.")
    expect(inspected.credentials[0]?.rules).toBe("No credential spraying.")
  })

  test("surfaces expected credential services from the operation plan", async () => {
    await using dir = await tmpdir({ git: true })
    const storage = memoryStorage()
    const operationID = "School Laptop"
    const root = path.join(dir.path, ".ulmcode", "operations", "school-laptop")
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID: "school-laptop",
      templateName: "school-laptop-48h",
      timeBudget: { targetHours: 48 },
    })

    const empty = await readOperationCredentials(dir.path, { operationID })
    expect(empty.expectedServices).toEqual(["genesis", "google"])

    await writeOperationCredential(storage, dir.path, {
      operationID,
      label: "Genesis SIS test account",
      username: "genesis-user",
      password: "********",
    })
    const submission = await submitOperationCredentialReview(dir.path, { operationID })
    const review = await readOperationCredentialReview(dir.path, { operationID })

    expect(submission.expectedServices).toEqual(["genesis", "google"])
    expect(review.expectedServices).toEqual(["genesis", "google"])
  })

  test("refreshes expected credential services when the plan changes after review submission", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    const root = path.join(dir.path, ".ulmcode", "operations", "school-laptop")
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID: "school-laptop",
      templateName: "school-laptop-48h",
      credentialTargets: ["genesis", "google"],
      timeBudget: { targetHours: 48 },
    })

    await submitOperationCredentialReview(dir.path, { operationID })
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID: "school-laptop",
      templateName: "school-laptop-48h",
      credentialTargets: ["genesis", "google", "classlink"],
      timeBudget: { targetHours: 48 },
    })

    const review = await readOperationCredentialReview(dir.path, { operationID })

    expect(review.expectedServices).toEqual(["genesis", "google", "classlink"])
  })

  test("fills the canonical review path for older review submissions without a file field", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    const root = path.join(dir.path, ".ulmcode", "operations", "school-laptop")
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "school-laptop",
      submittedAt: "2026-05-10T12:00:00Z",
      expectedServices: ["genesis"],
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
    })

    const review = await readOperationCredentialReview(dir.path, { operationID })

    expect(review.file).toBe(path.join(root, "credentials", "review-submission.json"))
    expect(review.submittedAt).toBe("2026-05-10T12:00:00Z")
  })

  test("preserves parallel credential creates in one operation index", async () => {
    await using dir = await tmpdir({ git: true })
    const storage = memoryStorage()

    await Promise.all(
      ["Genesis SIS", "Google Workspace", "Campus Wi-Fi"].map((label) =>
        writeOperationCredential(storage, dir.path, {
          operationID: "Parallel School Rehearsal",
          label,
          username: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-reviewer`,
          tags: ["synthetic"],
        }),
      ),
    )

    const review = await submitOperationCredentialReview(dir.path, { operationID: "Parallel School Rehearsal" })

    expect(review.credentials.map((credential) => credential.credentialID).sort()).toEqual([
      "campus-wi-fi",
      "genesis-sis",
      "google-workspace",
    ])
  })
})
