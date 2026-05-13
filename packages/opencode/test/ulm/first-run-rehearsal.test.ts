import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { formatFirstRunRehearsal, runFirstRunRehearsal } from "@/ulm/first-run-rehearsal"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")

function fakeClock(start: string, stepSeconds: number) {
  let tick = 0
  return () => new Date(Date.parse(start) + tick++ * stepSeconds * 1000)
}

describe("ULM first run rehearsal", () => {
  test("proves the school-laptop template, preflight, supervisor, and wall-clock canary chain", async () => {
    await using dir = await tmpdir({ git: true })
    const sleeps: number[] = []

    const result = await runFirstRunRehearsal(dir.path, {
      operationID: "Surface School Rehearsal",
      canaryTargetSeconds: 120,
      canaryIntervalSeconds: 5,
      now: fakeClock("2030-05-09T12:00:00.000Z", 5),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    })

    expect(result.operationID).toBe("surface-school-rehearsal")
    expect(result.template).toBe("school-laptop-48h")
    expect(result.preflight.status).toBe("ready")
    expect(result.preflight.targetHours).toBe(48)
    expect(result.canary.readiness.status).toBe("passed")
    expect(result.supervisor.files.launchdPlist).toContain("com.ulmcode.runtime-daemon.surface-school-rehearsal.plist")
    expect(result.supervisor.files.systemdService).toContain("ulmcode-runtime-daemon-surface-school-rehearsal.service")
    expect(result.files.summaryJson).toBe(
      path.join(operationPath(dir.path, "Surface School Rehearsal"), "scheduler", "first-run-rehearsal.json"),
    )
    expect(sleeps.length).toBeGreaterThan(1)

    const summary = JSON.parse(await fs.readFile(result.files.summaryJson, "utf8"))
    const credentialReview = JSON.parse(
      await fs.readFile(path.join(operationPath(dir.path, "Surface School Rehearsal"), "credentials", "review-submission.json"), "utf8"),
    )
    expect(summary.status).toBe("ready")
    expect(credentialReview.credentials.map((credential: { service?: string }) => credential.service).sort()).toEqual([
      "genesis",
      "google",
    ])
    expect(summary.commands.preflight).toContain("ulm:laptop-preflight")
    expect(summary.commands.launchReadiness).toContain("ulm:first-run-objective-audit")
    expect(summary.commands.launchReadiness).toContain("--require-launch-ready")
    expect(summary.commands.daemon48h).toContain("--duration-hours 48")
    expect(summary.commands.canary).toContain("ulm:wall-clock-canary")
    const compact = formatFirstRunRehearsal(result)
    expect(compact).toContain("- launch_readiness:")
    expect(compact).toContain("--require-launch-ready")
    expect(compact.indexOf("- launch_readiness:")).toBeLessThan(compact.indexOf("- daemon48h:"))
    expect(await fs.readFile(result.supervisor.files.runbook, "utf8")).toContain("Launch Readiness Gate")
    expect(await fs.readFile(result.supervisor.files.runbook, "utf8")).toContain("--require-launch-ready")
    expect(await fs.readFile(result.files.summaryMarkdown, "utf8")).toContain(
      "Run `launchReadiness` immediately before `daemon48h`",
    )
  })

  test("runs through the operator script in strict JSON mode", async () => {
    await using dir = await tmpdir({ git: true })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-first-run-rehearsal.ts"),
        "Script School Rehearsal",
        "--worktree",
        dir.path,
        "--canary-target-seconds",
        "1",
        "--canary-interval-seconds",
        "1",
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
    expect(parsed.operationID).toBe("script-school-rehearsal")
    expect(parsed.status).toBe("ready")
    expect(parsed.preflight.status).toBe("ready")
    expect(parsed.canary.readiness.status).toBe("passed")
  })
})
