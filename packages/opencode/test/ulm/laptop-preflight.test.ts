import { describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { auditLaptopPreflight } from "@/ulm/laptop-preflight"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeRuntimeSupervisor } from "@/ulm/runtime-supervisor"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n")
}

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

async function writeLaptopOperation(
  worktree: string,
  operationID: string,
  options: {
    credentialed?: boolean
    preflightProof?: boolean
    templateName?: string
    reportTargetPages?: number
    planWrittenAt?: string
  } = {},
) {
  const root = operationPath(worktree, operationID)
  await writeOperationGraph(worktree, { operationID, budgetUSD: 20 })
  await writeJson(path.join(root, "goals", "operation-goal.json"), {
    operationID,
    objective: "Authorized 48 hour school laptop assessment",
    targetDurationHours: 48,
  })
  await writeJson(path.join(root, "plans", "operation-plan.json"), {
    operationID,
    templateName: options.templateName,
    writtenAt: options.planWrittenAt,
    timeBudget: { targetHours: 48 },
    access: options.credentialed ? "Use submitted test credentials for authenticated checks" : "Unauthenticated checks only",
    phases: [],
  })
  await writeRuntimeSupervisor({
    operationID,
    worktree,
    bunPath: "bun",
    scriptPath: path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
    durationSeconds: 48 * 60 * 60,
    intervalSeconds: 60,
    schedulerCyclesPerTick: 1,
    supervisor: "all",
  })
  if (options.preflightProof !== false) {
    await writeJson(path.join(root, "tools", "tool-preflight.json"), { total: 2, available: 2, blocked: 0 })
    await writeJson(path.join(root, "deliverables", "model-route-audit.json"), { operationID, ok: true })
  }
  await fs.mkdir(path.join(root, "reports"), { recursive: true })
  await fs.writeFile(
    path.join(root, "reports", "report-outline.md"),
    [
      "# Report Outline",
      "",
      `- target_pages: ${options.reportTargetPages ?? 50}`,
      "",
      "## Page Budget",
      "- Executive Summary: 5 pages",
    ].join("\n") + "\n",
  )
  return root
}

describe("ULM laptop preflight", () => {
  test("passes when the 48 hour operation has launch, reporting, tool, model, and operator proof", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID)

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
      now: () => new Date("2026-05-09T12:00:00.000Z"),
    })

    expect(result.status).toBe("ready")
    expect(result.gaps).toEqual([])
    expect(result.files.json).toBe(path.join(root, "scheduler", "laptop-preflight.json"))
    expect(result.checks.find((item) => item.id === "plan-fingerprint")?.detail).toContain(
      `plan_sha256=${sha256(await fs.readFile(path.join(root, "plans", "operation-plan.json"), "utf8"))}`,
    )
    expect(result.checks.find((item) => item.id === "report-outline")?.status).toBe("ok")
    const markdown = await fs.readFile(result.files.markdown, "utf8")
    expect(markdown).toContain("operator-sleep")
    expect(markdown).toContain("report-outline")
  })

  test("blocks strict laptop handoff when operator confirmations or long report outline are missing", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID)
    await fs.rm(path.join(root, "reports", "report-outline.md"))

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "wifi"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "operator-sleep")?.required).toBe(true)
    expect(result.checks.find((item) => item.id === "operator-sleep")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "report-outline")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("operator-sleep"))).toBe(true)
    expect(result.gaps.some((gap) => gap.includes("report-outline"))).toBe(true)
  })

  test("requires the 75 page report target for the school-laptop-48h template", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    await writeLaptopOperation(dir.path, operationID, {
      templateName: "school-laptop-48h",
      reportTargetPages: 50,
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "report-outline")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "report-outline")?.detail).toContain(
      "required_min_target_pages=75",
    )
  })

  test("requires school-laptop supervisor runbooks to include the launch readiness gate", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    await writeLaptopOperation(dir.path, operationID, {
      templateName: "school-laptop-48h",
      reportTargetPages: 75,
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    const runbookCheck = result.checks.find((item) => item.id === "supervisor-runbook")
    expect(result.status).toBe("blocked")
    expect(runbookCheck?.status).toBe("fail")
    expect(runbookCheck?.detail).toContain("launch_readiness_gate=false")
    expect(result.gaps.some((gap) => gap.includes("supervisor-runbook"))).toBe(true)
  })

  test("rejects school-laptop launch readiness runbooks for a suffix-mismatched operation id", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, {
      templateName: "school-laptop-48h",
      reportTargetPages: 75,
    })
    await fs.writeFile(
      path.join(root, "scheduler", "supervisor", "supervisor-install.md"),
      [
        "# Runtime Daemon Supervisor Install",
        "",
        "## Launch Readiness Gate",
        "",
        "```sh",
        "bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id school-laptop-copy --require-launch-ready --json",
        "```",
        "",
        "## 48-Hour Laptop Checklist",
        "",
        "- Disable sleep/hibernate/modern standby",
        "- Join school Wi-Fi",
        "- Confirm credential vault and redacted indexes",
      ].join("\n") + "\n",
    )

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    const runbookCheck = result.checks.find((item) => item.id === "supervisor-runbook")
    expect(result.status).toBe("blocked")
    expect(runbookCheck?.status).toBe("fail")
    expect(runbookCheck?.detail).toContain("launch_readiness_gate=false")
  })

  test("blocks when the laptop clock would write preflight proof older than the plan", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    await writeLaptopOperation(dir.path, operationID, {
      planWrittenAt: "2026-05-09T12:05:00.000Z",
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
      now: () => new Date("2026-05-09T12:00:00.000Z"),
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "plan-freshness")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("preflight_checked_at=2026-05-09T12:00:00.000Z"))).toBe(true)
    expect(result.gaps.some((gap) => gap.includes("plan_written_at=2026-05-09T12:05:00.000Z"))).toBe(true)
  })

  test("can prepare tool and model proof artifacts before auditing", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { preflightProof: false })
    const manifestPath = path.join(dir.path, "tool-manifest.json")
    await writeJson(manifestPath, {
      tools: [
        {
          id: "fixture-tool",
          category: "test",
          purpose: "fixture",
          validate: "true",
          install: [],
          fallbacks: [],
        },
      ],
      commandProfiles: [],
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      preparePrerequisites: true,
      toolManifestPath: manifestPath,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("ready")
    expect(result.checks.find((item) => item.id === "tool-preflight")?.status).toBe("ok")
    expect(result.checks.find((item) => item.id === "model-route-audit")?.status).toBe("ok")
    expect(await fs.readFile(path.join(root, "tools", "tool-preflight.json"), "utf8")).toContain("fixture-tool")
    const routeAudit = JSON.parse(await fs.readFile(path.join(root, "deliverables", "model-route-audit.json"), "utf8")) as {
      routes?: Array<{ providerID?: string }>
    }
    expect(routeAudit.routes?.every((route) => route.providerID === "openai")).toBe(true)
  })

  test("blocks credentialed plans until the vault review is submitted", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })

    const blocked = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(blocked.status).toBe("blocked")
    expect(blocked.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(blocked.checks.find((item) => item.id === "credential-vault")?.detail).toContain(
      "operation_credentials action=open_vault operationID=credentialed-school-laptop",
    )
    expect(blocked.checks.find((item) => item.id === "credential-vault")?.detail).toContain(
      "/ulm/credentials?operationID=credentialed-school-laptop",
    )

    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:00:00.000Z",
      credentials: [{ id: "vault-1", label: "redacted test account" }],
    })
    const ready = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })
    expect(ready.checks.find((item) => item.id === "credential-vault")?.status).toBe("ok")
    expect(ready.status).toBe("ready")
  })

  test("requires school laptop credential reviews to cover Genesis and Google", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, {
      templateName: "school-laptop-48h",
      reportTargetPages: 75,
    })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:00:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis SIS test account", password: "********" }],
    })

    const blocked = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    const credentialCheck = blocked.checks.find((item) => item.id === "credential-vault")
    expect(blocked.status).toBe("blocked")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("expected_services=genesis,google")
    expect(credentialCheck?.detail).toContain("credential review is missing a submitted record for plan service: google")
  })

  test("rejects copied credential reviews from another operation id", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: "other-operation",
      submittedAt: "2026-05-09T12:00:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis SIS test account", password: "********" }],
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("credential review operation id does not match operation"))).toBe(true)
  })

  test("rejects credential reviews whose file reference is noncanonical", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:00:00.000Z",
      credentials: [{ credentialID: "genesis-test", label: "Genesis SIS test account", password: "********" }],
      file: path.join(dir.path, "external", "review-submission.json"),
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("credential review file reference is not canonical"))).toBe(true)
  })

  test("rejects synthetic rehearsal credentials for a real long credentialed handoff", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:00:00.000Z",
      credentials: [
        {
          id: "rehearsal-redacted-credential",
          label: "Synthetic reviewed credential placeholder",
          redacted: true,
        },
      ],
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("synthetic credential placeholder"))).toBe(true)
  })

  test("rejects credential review artifacts that contain raw secret fields", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:00:00.000Z",
      credentials: [
        {
          credentialID: "genesis-admin",
          label: "Genesis admin",
          username: "admin",
          password: "real-password-should-not-be-here",
        },
      ],
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("raw secret fields"))).toBe(true)
  })

  test("rejects credential review artifacts with malformed credential indexes", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:00:00.000Z",
      credentials: [
        { credentialID: "genesis-admin", label: "Genesis admin", password: "********" },
        { credentialID: "genesis-admin", label: "Genesis duplicate", password: "********" },
      ],
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("credential review index has duplicate credential id: genesis-admin"))).toBe(true)
  })

  test("rejects credential review artifacts with invalid submitted timestamps", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "after lunch",
      credentials: [{ credentialID: "genesis-admin", label: "Genesis admin", password: "********" }],
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("credential review submittedAt is not a valid timestamp"))).toBe(true)
  })

  test("rejects credential reviews submitted after the preflight check time", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed School Laptop"
    const root = await writeLaptopOperation(dir.path, operationID, { credentialed: true })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID,
      submittedAt: "2026-05-09T12:05:00.000Z",
      credentials: [{ credentialID: "genesis-admin", label: "Genesis admin", password: "********" }],
    })

    const result = await auditLaptopPreflight(dir.path, {
      operationID,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
      now: () => new Date("2026-05-09T12:00:00.000Z"),
    })

    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "credential-vault")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("credential review was submitted after preflight check"))).toBe(true)
  })

  test("operator script writes JSON and exits nonzero in strict mode when blockers remain", async () => {
    await using dir = await tmpdir({ git: true })
    const script = path.join(packageRoot, "script", "ulm-laptop-preflight.ts")

    const proc = Bun.spawn(["bun", "run", script, "--worktree", dir.path, "--operation-id", "Missing", "--json", "--strict"], {
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(1)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.status).toBe("blocked")
    expect(parsed.files.json).toContain("laptop-preflight.json")
  })
})
