import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { auditCredentialReview } from "@/ulm/credential-review"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

async function writeCredentialedPlan(worktree: string, operationID: string) {
  const root = operationPath(worktree, operationID)
  await writeJson(path.join(root, "plans", "operation-plan.json"), {
    operationID,
    timeBudget: { targetHours: 48 },
    access: "Use submitted test credentials for authenticated Genesis and Google checks.",
  })
  return root
}

describe("ULM credential review audit", () => {
  test("blocks a credentialed operation until the vault review is submitted", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeCredentialedPlan(dir.path, operationID)

    const blocked = await auditCredentialReview(dir.path, {
      operationID,
      now: () => new Date("2026-05-09T12:00:00.000Z"),
    })

    expect(blocked.status).toBe("blocked")
    expect(blocked.credentialsRequired).toBe(true)
    expect(blocked.gaps).toContain("credentialed plan requires the vault Submit to agent button")
    expect(blocked.files.json).toBe(path.join(root, "scheduler", "credential-review.json"))

    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "credentialed-school-laptop",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [
        { credentialID: "genesis-test", label: "Genesis test account", username: "test.user", password: "********" },
        { credentialID: "google-workspace-test", label: "Google Workspace test account", username: "test.user", password: "********" },
      ],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const ready = await auditCredentialReview(dir.path, { operationID })

    expect(ready.status).toBe("ready")
    expect(ready.submitted).toBe(true)
    expect(ready.credentialCount).toBe(2)
    expect(ready.gaps).toEqual([])
    expect(await fs.readFile(ready.files.markdown, "utf8")).toContain("credential_count: 2")
  })

  test("does not require a vault submission for unauthenticated operations", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Unauthenticated Laptop"
    const root = operationPath(dir.path, operationID)
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID,
      access: "Unauthenticated checks only, no credentials.",
    })

    const result = await auditCredentialReview(dir.path, { operationID })

    expect(result.status).toBe("not_required")
    expect(result.credentialsRequired).toBe(false)
    expect(result.gaps).toEqual([])
  })

  test("operator script exits nonzero in strict mode when credential review is blocked", async () => {
    await using dir = await tmpdir({ git: true })
    await writeCredentialedPlan(dir.path, "Credentialed School Laptop")

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-credential-review.ts"),
        "--worktree",
        dir.path,
        "--operation-id",
        "Credentialed School Laptop",
        "--strict",
        "--json",
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(1)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.status).toBe("blocked")
    expect(parsed.files.json).toContain("credential-review.json")
  })

  test("rejects raw secrets hidden inside submitted credential notes", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = operationPath(dir.path, operationID)
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID,
      access: "Use submitted test credentials for authenticated Genesis checks.",
    })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "credentialed-school-laptop",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [
        {
          credentialID: "genesis-test",
          label: "Genesis test account",
          notes: "password: real-password-should-not-be-here",
        },
      ],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const result = await auditCredentialReview(dir.path, { operationID })

    expect(result.status).toBe("blocked")
    expect(result.gaps.some((gap) => gap.includes("raw secret fields"))).toBe(true)
  })

  test("rejects submitted credential reviews with blank labels or duplicate credential ids", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeCredentialedPlan(dir.path, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "credentialed-school-laptop",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [
        { credentialID: "genesis-test", label: "Genesis test account", password: "********" },
        { credentialID: "genesis-test", label: "Genesis second account", password: "********" },
        { label: "Google test account", password: "********" },
        { credentialID: "router-admin", label: "  ", password: "********" },
      ],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const result = await auditCredentialReview(dir.path, { operationID })

    expect(result.status).toBe("blocked")
    expect(result.gaps).toContain("credential review index has duplicate credential id: genesis-test")
    expect(result.gaps).toContain("credential review index record 3 is missing a credential id")
    expect(result.gaps).toContain("credential review index record 4 is missing a label")
  })

  test("rejects submitted credential reviews with invalid submitted timestamps", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeCredentialedPlan(dir.path, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "credentialed-school-laptop",
      submittedAt: "later",
      credentials: [{ credentialID: "genesis-test", label: "Genesis test account", password: "********" }],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const result = await auditCredentialReview(dir.path, { operationID })

    expect(result.status).toBe("blocked")
    expect(result.submitted).toBe(false)
    expect(result.gaps).toContain("credential review submittedAt is not a valid timestamp")
  })

  test("rejects submitted credential reviews copied from another operation id", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeCredentialedPlan(dir.path, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "other-operation",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [
        { credentialID: "genesis-test", label: "Genesis test account", password: "********" },
        { credentialID: "google-workspace-test", label: "Google Workspace test account", password: "********" },
      ],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const result = await auditCredentialReview(dir.path, { operationID })

    expect(result.status).toBe("blocked")
    expect(result.gaps).toContain("credential review operation id does not match operation")
  })

  test("rejects submitted credential reviews whose file reference is noncanonical", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeCredentialedPlan(dir.path, operationID)
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "credentialed-school-laptop",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [
        { credentialID: "genesis-test", label: "Genesis test account", password: "********" },
        { credentialID: "google-workspace-test", label: "Google Workspace test account", password: "********" },
      ],
      file: path.join(dir.path, "elsewhere", "review-submission.json"),
    })

    const result = await auditCredentialReview(dir.path, { operationID })

    expect(result.status).toBe("blocked")
    expect(result.gaps).toContain("credential review file reference is not canonical")
  })

  test("requires submitted credential records for every service explicitly named in the plan", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = operationPath(dir.path, operationID)
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID,
      timeBudget: { targetHours: 48 },
      access: "Use submitted test credentials for authenticated Genesis and Google Workspace checks.",
    })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "credentialed-school-laptop",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis SIS test account", password: "********" }],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const blocked = await auditCredentialReview(dir.path, { operationID })

    expect(blocked.status).toBe("blocked")
    expect(blocked.gaps).toContain("credential review is missing a submitted record for plan service: google")

    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "credentialed-school-laptop",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [
        { credentialID: "genesis-test", label: "Genesis SIS test account", password: "********" },
        { credentialID: "google-workspace-test", label: "Google Workspace test account", password: "********" },
      ],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const ready = await auditCredentialReview(dir.path, { operationID })

    expect(ready.status).toBe("ready")
    expect(ready.gaps).toEqual([])
  })

  test("treats the school laptop template as requiring Genesis and Google credential coverage", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Template School Laptop"
    const root = operationPath(dir.path, operationID)
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID,
      templateName: "school-laptop-48h",
      timeBudget: { targetHours: 48 },
    })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "template-school-laptop",
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis SIS test account", password: "********" }],
      file: path.join(root, "credentials", "review-submission.json"),
    })

    const result = await auditCredentialReview(dir.path, { operationID })

    expect(result.status).toBe("blocked")
    expect(result.expectedServices).toEqual(["genesis", "google"])
    expect(result.gaps).toContain("credential review is missing a submitted record for plan service: google")
  })
})
