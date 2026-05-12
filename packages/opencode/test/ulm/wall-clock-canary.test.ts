import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { runWallClockCanary } from "@/ulm/wall-clock-canary"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")

function fakeClock(start: string, stepSeconds: number) {
  let tick = 0
  return () => new Date(Date.parse(start) + tick++ * stepSeconds * 1000)
}

describe("ULM wall-clock canary", () => {
  test("runs the daemon long enough to produce audited literal runtime proof", async () => {
    await using dir = await tmpdir({ git: true })
    const sleeps: number[] = []

    const result = await runWallClockCanary(dir.path, {
      operationID: "Surface Canary",
      targetElapsedSeconds: 120,
      intervalSeconds: 5,
      now: fakeClock("2026-05-09T12:00:00.000Z", 5),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    })

    expect(result.operationID).toBe("surface-canary")
    expect(result.daemon.elapsedSeconds).toBeGreaterThanOrEqual(120)
    expect(result.readiness.status).toBe("passed")
    expect(result.readiness.literalElapsedSeconds).toBeGreaterThanOrEqual(120)
    expect(result.readiness.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("ok")
    expect(result.readiness.checks.find((item) => item.id === "daemon-heartbeat-continuity")?.status).toBe("ok")
    expect(result.readiness.checks.find((item) => item.id === "literal-work-proof")?.status).toBe("ok")
    expect(result.readiness.checks.find((item) => item.id === "final-package")?.status).toBe("ok")
    expect(result.readiness.checks.find((item) => item.id === "final-package")?.detail).toContain(
      "missing_manifest_files=none",
    )
    expect(result.readiness.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("ok")
    expect(result.daemon.cycles.some((cycle) => cycle.launchedJobs.length > 0)).toBe(true)
    expect(sleeps.length).toBeGreaterThan(1)
    const boardPdf = await fs.readFile(path.join(result.files.operationRoot, "deliverables", "final", "board-report.pdf"), "utf8")
    expect(boardPdf).toContain("/ULMCodeRenderer (styled-html)")
    expect(boardPdf).toContain("/Count 1")
    const finalAudit = JSON.parse(await fs.readFile(result.files.finalAudit, "utf8"))
    expect(finalAudit.ok).toBe(true)
    expect(finalAudit.blockers).toEqual([])
    expect(finalAudit.checks.finalHandoff.ok).toBe(true)
    expect(finalAudit.checks.finalHandoff.gaps).toEqual([])
    await expect(fs.access(result.readiness.auditPath)).resolves.toBeNull()
  })

  test("runs through the operator script in strict JSON mode", async () => {
    await using dir = await tmpdir({ git: true })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-wall-clock-canary.ts"),
        "Script Canary",
        "--target-seconds",
        "1",
        "--interval-seconds",
        "1",
        "--strict",
        "--json",
      ],
      { cwd: dir.path, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.operationID).toBe("script-canary")
    expect(parsed.daemon.elapsedSeconds).toBeGreaterThanOrEqual(1)
    expect(parsed.daemon.heartbeatPath).toContain("daemon-heartbeat.json")
    expect(parsed.daemon.cycles).toBeUndefined()
    expect(parsed.readiness.status).toBe("passed")
    expect(parsed.readiness.targetElapsedSeconds).toBe(1)
    expect(parsed.readiness.checks).toBeUndefined()
    expect(parsed.files.readinessAudit).toContain("literal-run-readiness.json")
  })
})
