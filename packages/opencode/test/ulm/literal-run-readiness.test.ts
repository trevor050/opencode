import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath } from "@/ulm/artifact"
import { runBurnInHarness } from "@/ulm/burnin-harness"
import { auditLiteralRunReadiness } from "@/ulm/literal-run-readiness"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeRuntimeSupervisor } from "@/ulm/runtime-supervisor"
import { tmpdir } from "../fixture/fixture"

async function writeOperationalPreflight(root: string, operationID: string) {
  await fs.mkdir(path.join(root, "tools"), { recursive: true })
  await fs.writeFile(
    path.join(root, "tools", "tool-preflight.json"),
    JSON.stringify({ total: 1, available: 1, blocked: 0 }, null, 2) + "\n",
  )
  await fs.mkdir(path.join(root, "deliverables"), { recursive: true })
  await fs.writeFile(
    path.join(root, "deliverables", "model-route-audit.json"),
    JSON.stringify({ operationID, ok: true }, null, 2) + "\n",
  )
}

async function writeFinalHandoffProof(
  worktree: string,
  operationID: string,
  generatedAt?: string,
  options: { minOutlineTargetPages?: number; minPdfPages?: number } = { minOutlineTargetPages: 50, minPdfPages: 50 },
) {
  const root = operationPath(worktree, operationID)
  await writeOperationalPreflight(root, operationID)
  if (options.minOutlineTargetPages) {
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report-outline.md"),
      ["# Report Outline", "", `- target_pages: ${options.minOutlineTargetPages}`, "", "## Page Budget", "- Executive Summary: 5 pages"].join(
        "\n",
      ) + "\n",
    )
  }
  await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
  await fs.writeFile(
    path.join(root, "deliverables", "final", "manifest.json"),
    JSON.stringify({ operationID, artifacts: { html: "report.html", pdf: "report.pdf" } }, null, 2) + "\n",
  )
  await fs.writeFile(
    path.join(root, "deliverables", "operation-audit.json"),
    JSON.stringify(
      {
        operationID,
        ok: true,
        blockers: [],
        generatedAt,
        checks:
          options.minOutlineTargetPages || options.minPdfPages
            ? {
                finalHandoff: {
                  gates: {
                    minOutlineTargetPages: options.minOutlineTargetPages,
                    minPdfPages: options.minPdfPages,
                  },
                },
              }
            : undefined,
      },
      null,
      2,
    ) + "\n",
  )
}

describe("ULM literal run readiness audit", () => {
  test("separates accelerated burn-in from literal wall-clock proof", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Literal Operation"

    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await runBurnInHarness(dir.path, {
      operationID,
      targetElapsedSeconds: 20 * 60 * 60,
      tickSeconds: 60 * 60,
      reset: true,
    })
    await writeRuntimeSupervisor({
      operationID,
      worktree: dir.path,
      bunPath: "bun",
      scriptPath: path.join(__dirname, "..", "..", "script", "ulm-runtime-daemon.ts"),
      durationSeconds: 20 * 60 * 60,
      intervalSeconds: 60,
      schedulerCyclesPerTick: 1,
      supervisor: "all",
    })
    await writeOperationalPreflight(operationPath(dir.path, operationID), operationID)

    const ready = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(ready.status).toBe("incomplete")
    expect(ready.checks.find((item) => item.id === "accelerated-burnin-proof")?.status).toBe("ok")
    expect(ready.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("fail")

    const root = operationPath(dir.path, operationID)
    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "literal-operation",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [
            {
              launchedJobs: ["job-recon"],
              launchedCommandJobs: ["cmd-http"],
              run: { completedLanes: ["recon"], syncedJobs: ["job-recon"], completedWorkUnits: ["work-http"] },
            },
          ],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID)

    const passed = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(passed.status).toBe("passed")
    expect(passed.literalElapsedSeconds).toBe(20 * 60 * 60)
    expect(await fs.readFile(passed.markdownPath, "utf8")).toContain("status: passed")
  })

  test("does not accept idle daemon heartbeats as useful autonomy proof", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Idle Daemon"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeRuntimeSupervisor({
      operationID,
      worktree: dir.path,
      bunPath: "bun",
      scriptPath: path.join(__dirname, "..", "..", "script", "ulm-runtime-daemon.ts"),
      durationSeconds: 20 * 60 * 60,
      intervalSeconds: 60,
      schedulerCyclesPerTick: 1,
      supervisor: "all",
    })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "idle-daemon",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID)

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("ok")
    expect(result.checks.find((item) => item.id === "literal-work-proof")?.status).toBe("fail")
  })

  test("accepts tool-owned daemon proof without requiring service-manager setup", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Tool Owned Daemon"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(operationPath(dir.path, operationID), operationID)

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "tool-owned-daemon",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-package")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
  })

  test("accepts tool-owned daemon proof with final package and audit", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Tool Owned Daemon"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "tool-owned-daemon",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID)

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("passed")
    expect(result.checks.find((item) => item.id === "service-supervisor")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "service-supervisor")?.required).toBe(false)
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("ok")
  })

  test("rejects literal 20h proof without tool preflight and model route audit", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Missing Preflight"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "missing-preflight",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")

    const finalDir = path.join(root, "deliverables", "final")
    await fs.mkdir(finalDir, { recursive: true })
    await fs.writeFile(
      path.join(finalDir, "manifest.json"),
      JSON.stringify({ operationID, artifacts: { html: "report.html", pdf: "report.pdf" } }, null, 2) + "\n",
    )
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          checks: { finalHandoff: { gates: { minOutlineTargetPages: 50, minPdfPages: 50 } } },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "tool-preflight")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "model-route-audit")?.status).toBe("fail")
  })

  test("rejects final audits generated before the daemon heartbeat", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Stale Audit"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "stale-audit",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T19:00:00.000Z")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain("fresh=false")
  })

  test("rejects 20h final audits that do not prove the long-report gate", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Weak Report Gate"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID: "weak-report-gate", timeBudget: { targetHours: 20 } }, null, 2) + "\n",
    )

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "weak-report-gate",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z", {})

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "required_min_outline_target_pages=50",
    )
  })

  test("rejects 20h final audits that do not prove the rendered PDF page gate", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Weak PDF Gate"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID: "weak-pdf-gate", timeBudget: { targetHours: 20 } }, null, 2) + "\n",
    )

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "weak-pdf-gate",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z", { minOutlineTargetPages: 50 })

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain("required_min_pdf_pages=50")
  })

  test("requires long-report audit proof for default literal 20h checks even without plan time budget", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Missing Time Budget Report Gate"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID: "missing-time-budget-report-gate", phases: [] }, null, 2) + "\n",
    )

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "missing-time-budget-report-gate",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z", {})

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "required_min_outline_target_pages=50",
    )
  })

  test("rejects literal 20h proof when audit claims a long report but outline is undersized", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Fake Long Report"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report-outline.md"),
      ["# Report Outline", "", "- target_pages: 4", "", "## Page Budget", "- Executive Summary: 1 pages"].join("\n") + "\n",
    )

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "fake-long-report",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z")
    await fs.writeFile(
      path.join(root, "reports", "report-outline.md"),
      ["# Report Outline", "", "- target_pages: 4", "", "## Page Budget", "- Executive Summary: 1 pages"].join("\n") + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "report-outline-proof")?.status).toBe("fail")
  })

  test("rejects credentialed runs whose final audit does not prove credential handoff", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Credentialed Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "credentialed-run",
          timeBudget: { targetHours: 20 },
          phases: [{ actions: ["Use provided credentials for authenticated router checks."] }],
        },
        null,
        2,
      ) + "\n",
    )

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "credentialed-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "final", "manifest.json"),
      JSON.stringify({ operationID, artifacts: { html: "report.html", pdf: "report.pdf" } }, null, 2) + "\n",
    )
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: { finalHandoff: { gates: { minOutlineTargetPages: 50, minPdfPages: 50 } } },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "credential_handoff=missing",
    )
  })

  test("rejects credentialed runs when final audit claims handoff but the vault review is absent", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Claimed Credentialed Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "claimed-credentialed-run",
          timeBudget: { targetHours: 20 },
          phases: [{ actions: ["Use provided credentials for authenticated router checks."] }],
        },
        null,
        2,
      ) + "\n",
    )

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "claimed-credentialed-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(path.join(schedulerDir, "daemon.jsonl"), JSON.stringify({ tick: 1 }) + "\n")
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "final", "manifest.json"),
      JSON.stringify({ operationID, artifacts: { html: "report.html", pdf: "report.pdf" } }, null, 2) + "\n",
    )
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: {
            finalHandoff: { gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "credential-handoff-proof")?.status).toBe("fail")
  })

  test("runs through the operator script and supports strict mode", async () => {
    await using dir = await tmpdir({ git: true })
    const script = path.join(__dirname, "..", "..", "script", "ulm-literal-run-readiness.ts")

    const proc = Bun.spawn(["bun", "run", script, "--worktree", dir.path, "--operation-id", "Missing", "--json", "--strict"], {
      cwd: dir.path,
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
    expect(parsed.auditPath).toContain("literal-run-readiness.json")
  })

  test("operator script resolves the repo worktree when launched from packages/opencode", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Nested Package Launch"
    const script = path.join(__dirname, "..", "..", "script", "ulm-literal-run-readiness.ts")
    const nestedPackageDir = path.join(dir.path, "packages", "opencode")
    await fs.mkdir(nestedPackageDir, { recursive: true })
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(operationPath(dir.path, operationID), operationID)

    const proc = Bun.spawn(["bun", "run", script, operationID, "--json", "--strict"], {
      cwd: nestedPackageDir,
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
    expect(parsed.status).toBe("incomplete")
    expect(parsed.checks.find((item: { id?: string; status?: string }) => item.id === "operation-graph")?.status).toBe(
      "ok",
    )
    expect(parsed.auditPath).toStartWith(dir.path)
  })
})
