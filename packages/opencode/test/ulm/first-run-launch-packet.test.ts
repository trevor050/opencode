import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { formatFirstRunLaunchPacket, writeFirstRunLaunchPacket } from "@/ulm/first-run-launch-packet"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")

describe("ULM first run launch packet", () => {
  test("creates the real school-laptop operation and operator launch packet without forging readiness", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await writeFirstRunLaunchPacket(dir.path, {
      operationID: "Surface Real School Run",
      targetHours: 48,
    })

    expect(result.operationID).toBe("surface-real-school-run")
    expect(result.status).toBe("preflight_required")
    expect(result.template).toBe("school-laptop-48h")
    expect(result.files.operationRoot).toBe(operationPath(dir.path, "Surface Real School Run"))
    expect(result.commands.preflight).toContain("ulm:laptop-preflight surface-real-school-run")
    expect(result.commands.openCredentialVault).toContain("operation_credentials action=open_vault operationID=surface-real-school-run")
    expect(result.commands.credentialReview).toContain("ulm:credential-review surface-real-school-run --strict --json")
    expect(result.commands.credentialVaultPath).toContain("/ulm/credentials?operationID=surface-real-school-run")
    expect(result.commands.daemon48h).toContain("ulm:runtime-daemon surface-real-school-run --duration-hours 48")
    expect(result.commands.launchReadiness).toContain(
      "ulm:first-run-objective-audit --operation-id surface-real-school-run --require-launch-ready --json",
    )
    expect(result.commands.objectiveAudit).toContain("ulm:first-run-objective-audit --operation-id surface-real-school-run")

    const packet = JSON.parse(await fs.readFile(result.files.packetJson, "utf8"))
    const plan = JSON.parse(await fs.readFile(path.join(result.files.operationRoot, "plans", "operation-plan.json"), "utf8"))
    expect(packet.status).toBe("preflight_required")
    expect(plan.credentialTargets).toEqual(["genesis", "google"])
    expect(plan.scopeRules).toContain("Only test assets and services explicitly authorized for this school laptop operation.")
    expect(plan.scopeRules).toContain(
      "Person and account research must stay limited to role, authorization, identity, and workflow risk; exclude private-life dossier material.",
    )
    expect(packet.scopeRequirements).toEqual({
      required: true,
      rules: plan.scopeRules,
    })
    expect(packet.credentialRequirements).toEqual({
      required: true,
      expectedServices: ["genesis", "google"],
      vaultPath: "/ulm/credentials?operationID=surface-real-school-run",
      openVaultCommand: "operation_credentials action=open_vault operationID=surface-real-school-run",
      reviewCommand: "bun run --cwd packages/opencode ulm:credential-review surface-real-school-run --strict --json",
    })
    expect(packet.requiredBeforeLaunch.map((item: { id: string }) => item.id)).toEqual([
      "wall-power",
      "sleep-disabled",
      "school-wifi",
      "scope-confirmed",
      "clock-confirmed",
      "credential-review",
      "tool-model-preflight",
      "wall-clock-canary",
      "laptop-preflight",
      "launch-supervisor",
    ])
    const markdown = await fs.readFile(result.files.packetMarkdown, "utf8")
    const summary = formatFirstRunLaunchPacket(result)
    expect(markdown).toContain("Do not launch the 48-hour daemon until")
    expect(markdown).toContain("## Scope Rules")
    expect(markdown).toContain("Only test assets and services explicitly authorized")
    expect(markdown).toContain("exclude private-life dossier material")
    expect(markdown).toContain("expected_services: genesis,google")
    expect(markdown).toContain("Genesis and Google credentials are stored through the vault")
    expect(markdown).not.toContain("SIS, and vendor credentials")
    expect(markdown).toContain("Submit to agent")
    expect(markdown).toContain("Run `launchReadiness` immediately before `daemon48h`")
    expect(summary).toContain("- launch_readiness:")
    expect(summary).toContain("--require-launch-ready")
    expect(summary.indexOf("- launch_readiness:")).toBeLessThan(summary.indexOf("- launch:"))
    const runbook = await fs.readFile(result.supervisor.files.runbook, "utf8")
    expect(runbook).toContain("48-Hour Laptop Checklist")
    expect(runbook).toContain("Launch Readiness Gate")
    expect(runbook).toContain("--require-launch-ready")
  })

  test("runs through the operator script in strict JSON mode", async () => {
    await using dir = await tmpdir({ git: true })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-first-run-launch-packet.ts"),
        "Script Real School Run",
        "--worktree",
        dir.path,
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

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.operationID).toBe("script-real-school-run")
    expect(parsed.status).toBe("preflight_required")
    expect(parsed.commands.launchReadiness).toContain("--require-launch-ready")
    expect(parsed.commands.readiness).toContain("ulm:literal-run-readiness script-real-school-run")
  })

  test("adds operator-specified credential targets to the school laptop defaults", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await writeFirstRunLaunchPacket(dir.path, {
      operationID: "Extra Services School Run",
      additionalCredentialTargets: ["Clever", "ClassLink"],
    })

    const packet = JSON.parse(await fs.readFile(result.files.packetJson, "utf8"))
    const plan = JSON.parse(await fs.readFile(path.join(result.files.operationRoot, "plans", "operation-plan.json"), "utf8"))
    expect(plan.credentialTargets).toEqual(["genesis", "google", "clever", "classlink"])
    expect(packet.credentialRequirements.expectedServices).toEqual(["genesis", "google", "clever", "classlink"])
    const markdown = await fs.readFile(result.files.packetMarkdown, "utf8")
    expect(markdown).toContain("expected_services: genesis,google,clever,classlink")
    expect(markdown).toContain("Genesis, Google, Clever, and ClassLink credentials are stored through the vault")
  })

  test("adds operator-specified scope rules to the launch packet and operation plan", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await writeFirstRunLaunchPacket(dir.path, {
      operationID: "Scoped School Run",
      scopeRules: ["Exclude payroll systems.", "Only scan 10.20.0.0/16 during school-approved hours."],
    })

    const packet = JSON.parse(await fs.readFile(result.files.packetJson, "utf8"))
    const plan = JSON.parse(await fs.readFile(path.join(result.files.operationRoot, "plans", "operation-plan.json"), "utf8"))
    expect(plan.scopeRules).toContain("Exclude payroll systems.")
    expect(plan.scopeRules).toContain("Only scan 10.20.0.0/16 during school-approved hours.")
    expect(packet.scopeRequirements.rules).toEqual(plan.scopeRules)
    const markdown = await fs.readFile(result.files.packetMarkdown, "utf8")
    expect(markdown).toContain("Exclude payroll systems.")
    expect(markdown).toContain("Only scan 10.20.0.0/16 during school-approved hours.")
  })

  test("operator script accepts repeated credential targets for additional services", async () => {
    await using dir = await tmpdir({ git: true })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-first-run-launch-packet.ts"),
        "Script Extra Services Run",
        "--worktree",
        dir.path,
        "--credential-target",
        "Clever",
        "--credential-target",
        "ClassLink",
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

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.credentialRequirements.expectedServices).toEqual(["genesis", "google", "clever", "classlink"])
  })

  test("operator script accepts repeated scope rules", async () => {
    await using dir = await tmpdir({ git: true })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-first-run-launch-packet.ts"),
        "Script Scoped Run",
        "--worktree",
        dir.path,
        "--scope-rule",
        "Exclude payroll systems.",
        "--scope-rule",
        "Only scan 10.20.0.0/16.",
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

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.scopeRequirements.rules).toContain("Exclude payroll systems.")
    expect(parsed.scopeRequirements.rules).toContain("Only scan 10.20.0.0/16.")
  })

  test("refuses to overwrite an existing real launch operation unless forced", async () => {
    await using dir = await tmpdir({ git: true })

    await writeFirstRunLaunchPacket(dir.path, { operationID: "Existing Real School Run" })

    await expect(writeFirstRunLaunchPacket(dir.path, { operationID: "Existing Real School Run" })).rejects.toThrow(
      "already exists",
    )

    const forced = await writeFirstRunLaunchPacket(dir.path, {
      operationID: "Existing Real School Run",
      overwriteExisting: true,
    })

    expect(forced.operationID).toBe("existing-real-school-run")
  })
})
