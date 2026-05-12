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
  await writeDurationProof(root, operationID)
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

async function writeDurationProof(root: string, operationID: string) {
  await fs.mkdir(path.join(root, "goals"), { recursive: true })
  try {
    await fs.access(path.join(root, "goals", "operation-goal.json"))
  } catch {
    await fs.writeFile(
      path.join(root, "goals", "operation-goal.json"),
      JSON.stringify({ operationID, targetDurationHours: 20 }, null, 2) + "\n",
    )
  }
  await fs.mkdir(path.join(root, "plans"), { recursive: true })
  try {
    await fs.access(path.join(root, "plans", "operation-plan.json"))
  } catch {
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID, timeBudget: { targetHours: 20 }, phases: [] }, null, 2) + "\n",
    )
  }
}

function fixturePdf(label: string, pages = 50) {
  return [
    "%PDF-1.7",
    "% fixture report",
    "1 0 obj",
    `<< /Type /Pages /Count ${pages} >>`,
    "endobj",
    `2 0 obj << /Producer /ULMCodeRenderer (styled-html) /Title (${label}) >> endobj`,
    "%%EOF",
    "",
  ].join("\n")
}

function stakeholderFixtureFiles(operationID: string, options: { minPdfPages?: number }) {
  const pages = options.minPdfPages ?? 50
  return [
    [
      "report.html",
      [
        "<!doctype html>",
        "<html><body>",
        `<p>Operation: ${operationID}</p>`,
        "<h2>Finding State Counts</h2>",
        "</body></html>",
        "",
      ].join("\n"),
    ],
    [
      "README.md",
      [
        "# Final Package",
        "",
        `Operation: ${operationID}`,
        "",
        "## Files",
        "## Findings",
        "## Evidence",
        "",
      ].join("\n"),
    ],
    ["findings.json", JSON.stringify({ operationID, counts: {}, reportable: [], retained: [] }, null, 2) + "\n"],
    ["evidence-index.json", JSON.stringify({ operationID, evidence: [] }, null, 2) + "\n"],
    ["people-profiles.md", "# People Profiles\n\nNo person profiles were recorded.\n"],
    ["identity-graph.json", JSON.stringify({ operationID, nodes: [], edges: [] }, null, 2) + "\n"],
    [
      "operator-review.md",
      [
        "# Operator Review",
        "",
        `Operation: ${operationID}`,
        "",
        "## Handoff State",
        "## Review Before Client Delivery",
        "",
      ].join("\n"),
    ],
    [
      "executive-summary.md",
      [
        "# Executive Summary",
        "",
        `Operation: ${operationID}`,
        "",
        "## Overview",
        "## Priority Items",
        "",
      ].join("\n"),
    ],
    [
      "technical-appendix.md",
      [
        "# Technical Appendix",
        "",
        `Operation: ${operationID}`,
        "",
        "## Scope And Methodology",
        "## Evidence Index",
        "",
      ].join("\n"),
    ],
    [
      "board-report.md",
      [
        "# Board Report",
        "",
        `Operation: ${operationID}`,
        "",
        "## Executive Decision Summary",
        "## Recommended Board Actions",
        "",
      ].join("\n"),
    ],
    ["board-report.pdf", fixturePdf("Board Report", pages)],
    [
      "ceh-technical-report.md",
      [
        "# CEH Technical Report",
        "",
        `Operation: ${operationID}`,
        "",
        "## Scope And Methodology",
        "## Validated Findings",
        "## Evidence Map",
        "",
      ].join("\n"),
    ],
    ["ceh-technical-report.pdf", fixturePdf("CEH Technical Report", pages)],
    [
      "ulm-team-report.md",
      [
        "# ULMCode Team Report",
        "",
        `Operation: ${operationID}`,
        "",
        "## Harness Run State",
        "## Residual Harness Risks",
        "",
      ].join("\n"),
    ],
    ["ulm-team-report.pdf", fixturePdf("ULMCode Team Report", pages)],
    ["runtime-summary.md", "# Runtime Summary\n\nFixture runtime summary.\n"],
    ["report.pdf", fixturePdf("Report", pages)],
  ] as const
}

async function writeFinalHandoffProof(
  worktree: string,
  operationID: string,
  generatedAt = "2026-05-05T20:05:00.000Z",
  options: { minOutlineTargetPages?: number; minPdfPages?: number } = { minOutlineTargetPages: 50, minPdfPages: 50 },
) {
  const root = operationPath(worktree, operationID)
  await writeOperationalPreflight(root, operationID)
  await fs.mkdir(path.join(root, "scheduler"), { recursive: true })
  await fs.writeFile(
    path.join(root, "scheduler", "laptop-preflight.json"),
    JSON.stringify({ operationID, status: "ready", targetHours: 20, gaps: [] }, null, 2) + "\n",
  )
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
    JSON.stringify(
      {
        operationID,
        generatedAt,
        artifacts: {
          html: "report.html",
          pdf: "report.pdf",
          readme: "README.md",
          findingsJson: "findings.json",
          evidenceIndex: "evidence-index.json",
          peopleProfiles: "people-profiles.md",
          identityGraph: "identity-graph.json",
          operatorReview: "operator-review.md",
          executiveSummary: "executive-summary.md",
          technicalAppendix: "technical-appendix.md",
          boardReport: "board-report.md",
          boardReportPdf: "board-report.pdf",
          cehTechnicalReport: "ceh-technical-report.md",
          cehTechnicalReportPdf: "ceh-technical-report.pdf",
          ulmTeamReport: "ulm-team-report.md",
          ulmTeamReportPdf: "ulm-team-report.pdf",
          runtimeSummaryMarkdown: "runtime-summary.md",
        },
      },
      null,
      2,
    ) + "\n",
  )
  for (const [file, content] of stakeholderFixtureFiles(operationID, { minPdfPages: options.minPdfPages })) {
    await fs.writeFile(path.join(root, "deliverables", "final", file), content)
  }
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
                  ok: true,
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

async function writeDaemonContinuityLog(
  schedulerDir: string,
  start = "2026-05-05T00:00:00.000Z",
  middle = "2026-05-05T10:00:00.000Z",
  end = "2026-05-05T20:00:00.000Z",
) {
  await fs.writeFile(
    path.join(schedulerDir, "daemon.jsonl"),
    [
      { tick: 1, startedAt: start, updatedAt: start, elapsedSeconds: 0 },
      { tick: 40, startedAt: start, updatedAt: middle, elapsedSeconds: 10 * 60 * 60 },
      { tick: 80, startedAt: start, updatedAt: end, endedAt: end, elapsedSeconds: 20 * 60 * 60 },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
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
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T20:05:00.000Z")

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
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T21:05:00.000Z")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("ok")
    expect(result.checks.find((item) => item.id === "literal-work-proof")?.status).toBe("fail")
  })

  test("rejects long-run literal proof when the daemon used the laptop preflight bypass", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Bypassed Laptop"
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
    const root = operationPath(dir.path, operationID)
    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "bypassed-laptop",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-05T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(
      path.join(schedulerDir, "laptop-preflight-bypass.json"),
      JSON.stringify(
        {
          operationID: "bypassed-laptop",
          durationSeconds: 20 * 60 * 60,
          reason: "ULMCODE_ALLOW_LONG_RUN_PREFLIGHT_BYPASS=1 controlled test bypass",
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T20:05:00.000Z")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "laptop-preflight-bypass")?.status).toBe("fail")
    expect(result.gaps.some((gap) => gap.includes("controlled test bypass"))).toBe(true)
  })

  test("rejects long-run literal proof without a ready laptop preflight artifact", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Missing Laptop Preflight"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    const root = operationPath(dir.path, operationID)
    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "missing-laptop-preflight",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-05T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T20:05:00.000Z")
    await fs.rm(path.join(schedulerDir, "laptop-preflight.json"), { force: true })

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "laptop-preflight-proof")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "laptop-preflight-proof")?.detail).toContain(
      "laptop-preflight.json is missing",
    )
  })

  test("rejects one-line daemon logs even when final elapsed time claims 20h", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "One Line Daemon"
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
          operationID: "one-line-daemon",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(
      path.join(schedulerDir, "daemon.jsonl"),
      JSON.stringify({ tick: 80, updatedAt: "2026-05-05T20:00:00.000Z", elapsedSeconds: 20 * 60 * 60 }) + "\n",
    )
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T21:05:00.000Z")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("ok")
    expect(result.checks.find((item) => item.id === "daemon-heartbeat-continuity")?.status).toBe("fail")
  })

  test("counts CLI launch records inside the daemon window as work proof across heartbeat rewrites", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "CLI Launch Proof"
    const root = operationPath(dir.path, operationID)
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

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(path.join(schedulerDir, "cli-launches"), { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "cli-launch-proof",
          startedAt: "2026-05-05T00:00:00.000Z",
          endedAt: "2026-05-05T20:00:00.000Z",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await fs.writeFile(
      path.join(schedulerDir, "cli-launches", "2026-05-05T00-00-00-model-report_repair.json"),
      JSON.stringify(
        {
          kind: "model",
          id: "report_repair",
          createdAt: "2026-05-05T00:30:00.000Z",
          jobID: "cli-model-lane-report_repair",
        },
        null,
        2,
      ) + "\n",
    )
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T20:05:00.000Z")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("passed")
    expect(result.checks.find((item) => item.id === "literal-work-proof")?.status).toBe("ok")
    expect(result.checks.find((item) => item.id === "literal-work-proof")?.detail).toContain("model_launches=1")
  })

  test("ignores CLI launch records created before the daemon window", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Stale CLI Launch Proof"
    const root = operationPath(dir.path, operationID)
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

    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(path.join(schedulerDir, "cli-launches"), { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "stale-cli-launch-proof",
          startedAt: "2026-05-05T01:00:00.000Z",
          endedAt: "2026-05-05T21:00:00.000Z",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await fs.writeFile(
      path.join(schedulerDir, "cli-launches", "2026-05-05T00-30-00-model-report_repair.json"),
      JSON.stringify(
        {
          kind: "model",
          id: "report_repair",
          createdAt: "2026-05-05T00:30:00.000Z",
          jobID: "cli-model-lane-report_repair",
        },
        null,
        2,
      ) + "\n",
    )
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T21:05:00.000Z")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("ok")
    expect(result.checks.find((item) => item.id === "literal-work-proof")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "literal-work-proof")?.detail).toContain("model_launches=0")
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
    await writeDaemonContinuityLog(schedulerDir)

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
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("passed")
    expect(result.checks.find((item) => item.id === "service-supervisor")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "service-supervisor")?.required).toBe(false)
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("ok")
  })

  test("rejects shallow stakeholder report package content even when manifest and final audit claim success", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Shallow Stakeholder Reports"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const root = operationPath(dir.path, operationID)
    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "shallow-stakeholder-reports",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)
    await fs.writeFile(path.join(root, "deliverables", "final", "board-report.md"), "# Board Report\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-package")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-package")?.detail).toContain(
      "board-report.md:missing:## Executive Decision Summary",
    )
  })

  test("rejects copied daemon heartbeat proof from another operation", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Copied Heartbeat"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "different-operation",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "literal-runtime-proof")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "literal-runtime-proof")?.detail).toContain(
      "heartbeat_operation_id=different-operation",
    )
  })

  test("rejects copied final package and audit artifacts from another operation", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Copied Final Artifacts"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "copied-final-artifacts",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)
    const root = operationPath(dir.path, operationID)
    const manifestPath = path.join(root, "deliverables", "final", "manifest.json")
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    manifest.operationID = "different-operation"
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    const finalAuditPath = path.join(root, "deliverables", "operation-audit.json")
    const finalAudit = JSON.parse(await fs.readFile(finalAuditPath, "utf8"))
    finalAudit.operationID = "different-operation"
    await fs.writeFile(finalAuditPath, JSON.stringify(finalAudit, null, 2) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-package")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-package")?.detail).toContain(
      "manifest_operation_id=different-operation",
    )
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "audit_operation_id=different-operation",
    )
  })

  test("rejects final manifests that omit stakeholder report package artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Sparse Final Manifest"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "sparse-final-manifest",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)
    const sparseRoot = operationPath(dir.path, operationID)
    const sparseManifestPath = path.join(sparseRoot, "deliverables", "final", "manifest.json")
    const sparseManifest = JSON.parse(await fs.readFile(sparseManifestPath, "utf8"))
    delete sparseManifest.artifacts.boardReportPdf
    delete sparseManifest.artifacts.cehTechnicalReportPdf
    delete sparseManifest.artifacts.ulmTeamReportPdf
    await fs.writeFile(sparseManifestPath, JSON.stringify(sparseManifest, null, 2) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-package")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-package")?.detail).toContain(
      "missing_manifest_artifacts=boardReportPdf,cehTechnicalReportPdf,ulmTeamReportPdf",
    )
  })

  test("rejects final manifests that omit the main and markdown report package artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Skinny Final Manifest"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "skinny-final-manifest",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)
    const root = operationPath(dir.path, operationID)
    const manifestPath = path.join(root, "deliverables", "final", "manifest.json")
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    delete manifest.artifacts.html
    delete manifest.artifacts.pdf
    delete manifest.artifacts.boardReport
    delete manifest.artifacts.cehTechnicalReport
    delete manifest.artifacts.ulmTeamReport
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-package")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-package")?.detail).toContain(
      "missing_manifest_artifacts=html,pdf,boardReport,cehTechnicalReport,ulmTeamReport",
    )
  })

  test("rejects final manifests that point stakeholder report artifacts at missing files", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Missing Stakeholder Pdf"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "missing-stakeholder-pdf",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)
    await fs.rm(path.join(operationPath(dir.path, operationID), "deliverables", "final", "board-report.pdf"), { force: true })

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-package")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-package")?.detail).toContain(
      "missing_manifest_files=boardReportPdf",
    )
  })

  test("rejects final audits that do not prove final handoff lint passed", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Weak Final Audit"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "weak-final-audit",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)
    const finalAuditPath = path.join(operationPath(dir.path, operationID), "deliverables", "operation-audit.json")
    const finalAudit = JSON.parse(await fs.readFile(finalAuditPath, "utf8"))
    delete finalAudit.checks.finalHandoff.ok
    await fs.writeFile(finalAuditPath, JSON.stringify(finalAudit, null, 2) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "final_handoff=missing",
    )
  })

  test("rejects final audits without a generated timestamp", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Untimestamped Final Audit"
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })

    const schedulerDir = path.join(operationPath(dir.path, operationID), "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "untimestamped-final-audit",
          elapsedSeconds: 20 * 60 * 60,
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID)
    const untimestampedFinalAuditPath = path.join(operationPath(dir.path, operationID), "deliverables", "operation-audit.json")
    const untimestampedFinalAudit = JSON.parse(await fs.readFile(untimestampedFinalAuditPath, "utf8"))
    delete untimestampedFinalAudit.generatedAt
    await fs.writeFile(untimestampedFinalAuditPath, JSON.stringify(untimestampedFinalAudit, null, 2) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "generated_at=missing",
    )
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
    await writeDaemonContinuityLog(schedulerDir)

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
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T19:00:00.000Z")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain("fresh=false")
  })

  test("rejects final audits generated before the final package manifest", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Stale Final Manifest Audit"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    const schedulerDir = path.join(root, "scheduler")
    await fs.mkdir(schedulerDir, { recursive: true })
    await fs.writeFile(
      path.join(schedulerDir, "daemon-heartbeat.json"),
      JSON.stringify(
        {
          operationID: "stale-final-manifest-audit",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir, "2026-05-08T00:00:00.000Z", "2026-05-08T10:00:00.000Z", "2026-05-08T20:00:00.000Z")
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z")
    const manifestPath = path.join(root, "deliverables", "final", "manifest.json")
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
    manifest.generatedAt = "2026-05-08T20:10:00.000Z"
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n")

    const result = await auditLiteralRunReadiness(dir.path, { operationID })

    expect(result.status).toBe("incomplete")
    const finalAudit = result.checks.find((item) => item.id === "final-operation-audit")
    expect(finalAudit?.status).toBe("fail")
    expect(finalAudit?.detail).toContain("generated_at=2026-05-08T20:05:00.000Z")
    expect(finalAudit?.detail).toContain("final_manifest_generated_at=2026-05-08T20:10:00.000Z")
    expect(finalAudit?.detail).toContain("fresh=false")
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
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z", {})

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.status).toBe("fail")
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "required_min_outline_target_pages=50",
    )
  })

  test("requires 75 page outline and final handoff gates for school-laptop-48h readiness", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "school-laptop-shallow-report"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await fs.mkdir(path.join(root, "goals"), { recursive: true })
    await fs.writeFile(
      path.join(root, "goals", "operation-goal.json"),
      JSON.stringify({ operationID, targetDurationHours: 48 }, null, 2) + "\n",
    )
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID,
          templateName: "school-laptop-48h",
          timeBudget: { targetHours: 48 },
          phases: [],
        },
        null,
        2,
      ) + "\n",
    )
    await writeRuntimeSupervisor({
      operationID,
      worktree: dir.path,
      bunPath: "bun",
      scriptPath: path.join(__dirname, "../..", "script", "ulm-runtime-daemon.ts"),
      durationSeconds: 48 * 60 * 60,
      intervalSeconds: 60,
      schedulerCyclesPerTick: 1,
      supervisor: "all",
    })
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-05T20:05:00.000Z", {
      minOutlineTargetPages: 50,
      minPdfPages: 50,
    })
    await fs.writeFile(
      path.join(root, "scheduler", "laptop-preflight.json"),
      JSON.stringify({ operationID, status: "ready", targetHours: 48, gaps: [] }, null, 2) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, {
      operationID,
      targetElapsedSeconds: 48 * 60 * 60,
      now: () => new Date("2026-05-05T21:00:00.000Z"),
    })

    expect(result.status).toBe("incomplete")
    expect(result.checks.find((item) => item.id === "report-outline-proof")?.detail).toContain(
      "required_min_outline_target_pages=75",
    )
    expect(result.checks.find((item) => item.id === "final-operation-audit")?.detail).toContain(
      "required_min_outline_target_pages=75",
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
    await writeDaemonContinuityLog(schedulerDir)
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
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z", {})

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    expect(result.status).toBe("blocked")
    expect(result.checks.find((item) => item.id === "duration-plan-proof")?.status).toBe("fail")
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
    await writeDaemonContinuityLog(schedulerDir)
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
    await writeDaemonContinuityLog(schedulerDir)
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
    await writeDaemonContinuityLog(schedulerDir)
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

  test("rejects credentialed runs when vault review is copied from another operation id", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Copied Credential Review Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "copied-credential-review-run",
          timeBudget: { targetHours: 20 },
          phases: [{ actions: ["Use provided credentials for authenticated router checks."] }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          operationID: "other-operation",
          submittedAt: "2026-05-08T20:01:00.000Z",
          credentials: [{ credentialID: "router-admin", label: "Router admin", password: "********" }],
          file: path.join(root, "credentials", "review-submission.json"),
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
          operationID: "copied-credential-review-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("credential review operation id does not match operation")
  })

  test("rejects credentialed runs when vault review file reference is noncanonical", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Noncanonical Credential Review Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "noncanonical-credential-review-run",
          timeBudget: { targetHours: 20 },
          phases: [{ actions: ["Use provided credentials for authenticated router checks."] }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          operationID: "noncanonical-credential-review-run",
          submittedAt: "2026-05-08T20:01:00.000Z",
          credentials: [{ credentialID: "router-admin", label: "Router admin", password: "********" }],
          file: path.join(dir.path, "external", "review-submission.json"),
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
          operationID: "noncanonical-credential-review-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("credential review file reference is not canonical")
  })

  test("rejects credentialed runs when vault review was submitted after the daemon ended", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Late Credential Review Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "late-credential-review-run",
          timeBudget: { targetHours: 20 },
          phases: [{ actions: ["Use provided credentials for authenticated router checks."] }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          operationID: "late-credential-review-run",
          submittedAt: "2026-05-08T20:10:00.000Z",
          credentials: [{ credentialID: "router-admin", label: "Router admin", password: "********" }],
          file: path.join(root, "credentials", "review-submission.json"),
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
          operationID: "late-credential-review-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:20:00.000Z")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:20:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("credential review was submitted after daemon ended")
  })

  test("rejects credentialed runs when vault review was submitted after the daemon started", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Mid Run Credential Review"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "mid-run-credential-review",
          timeBudget: { targetHours: 20 },
          phases: [{ actions: ["Use provided credentials for authenticated router checks."] }],
        },
        null,
        2,
      ) + "\n",
    )
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          operationID: "mid-run-credential-review",
          submittedAt: "2026-05-08T20:10:00.000Z",
          credentials: [{ credentialID: "router-admin", label: "Router admin", password: "********" }],
          file: path.join(root, "credentials", "review-submission.json"),
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
          operationID: "mid-run-credential-review",
          elapsedSeconds: 20 * 60 * 60,
          startedAt: "2026-05-08T20:00:00.000Z",
          endedAt: "2026-05-09T16:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(
      schedulerDir,
      "2026-05-08T20:00:00.000Z",
      "2026-05-09T06:00:00.000Z",
      "2026-05-09T16:00:00.000Z",
    )
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-09T16:20:00.000Z")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-09T16:20:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("credential review was submitted after daemon started")
  })

  test("rejects school laptop runs when vault review omits an expected service", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "School Laptop Missing Credential Service"
    const operationSlug = "school-laptop-missing-credential-service"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify({ operationID: operationSlug, templateName: "school-laptop-48h", timeBudget: { targetHours: 48 }, phases: [] }, null, 2) +
        "\n",
    )
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          operationID: operationSlug,
          submittedAt: "2026-05-08T19:55:00.000Z",
          credentials: [{ credentialID: "genesis-test", label: "Genesis SIS test account", password: "********" }],
          file: path.join(root, "credentials", "review-submission.json"),
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
          operationID: operationSlug,
          elapsedSeconds: 48 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(
      schedulerDir,
      "2026-05-06T20:00:00.000Z",
      "2026-05-07T20:00:00.000Z",
      "2026-05-08T20:00:00.000Z",
    )
    await fs.mkdir(path.join(root, "deliverables", "final"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "final", "manifest.json"),
      JSON.stringify({ operationID: operationSlug, artifacts: { html: "report.html", pdf: "report.pdf" } }, null, 2) + "\n",
    )
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID: operationSlug,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 75, minPdfPages: 75 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID, targetElapsedSeconds: 48 * 60 * 60 })

    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("blocked")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("expected_services=genesis,google")
    expect(credentialCheck?.detail).toContain("credential review is missing a submitted record for plan service: google")
  })

  test("rejects credentialed runs when vault review contains a synthetic credential placeholder", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Synthetic Credentialed Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "synthetic-credentialed-run",
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
          operationID: "synthetic-credentialed-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await fs.mkdir(path.join(root, "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, "reports", "report-outline.md"),
      ["# Report Outline", "", "- target_pages: 50", "", "## Page Budget", "- Executive Summary: 5 pages"].join("\n") +
        "\n",
    )
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          submittedAt: "2026-05-08T20:01:00.000Z",
          credentials: [{ label: "rehearsal synthetic admin placeholder", reviewed: true }],
        },
        null,
        2,
      ) + "\n",
    )
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
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("synthetic credential placeholder")
  })

  test("rejects credentialed runs when vault review contains raw secret fields", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Raw Secret Credentialed Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "raw-secret-credentialed-run",
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
          operationID: "raw-secret-credentialed-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          submittedAt: "2026-05-08T20:01:00.000Z",
          credentials: [{ credentialID: "router-admin", label: "Router admin", password: "real-password" }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("raw secret fields")
  })

  test("rejects credentialed runs when vault review contains malformed credential indexes", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Malformed Credential Index Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "malformed-credential-index-run",
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
          operationID: "malformed-credential-index-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          submittedAt: "2026-05-08T20:01:00.000Z",
          credentials: [
            { credentialID: "router-admin", label: "Router admin", password: "********" },
            { credentialID: "router-admin", label: "Router duplicate", password: "********" },
          ],
        },
        null,
        2,
      ) + "\n",
    )
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 2 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("credential review index has duplicate credential id: router-admin")
  })

  test("rejects credentialed runs when vault review has an invalid submitted timestamp", async () => {
    await using dir = await tmpdir({ git: true })
    const operationID = "Invalid Credential Submitted Time Run"
    const root = operationPath(dir.path, operationID)
    await writeOperationGraph(dir.path, { operationID, budgetUSD: 20 })
    await writeOperationalPreflight(root, operationID)
    await fs.mkdir(path.join(root, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(root, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "invalid-credential-submitted-time-run",
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
          operationID: "invalid-credential-submitted-time-run",
          elapsedSeconds: 20 * 60 * 60,
          endedAt: "2026-05-08T20:00:00.000Z",
          reason: "runtime window elapsed",
          cycles: [{ launchedJobs: ["job-recon"], run: { syncedJobs: ["job-recon"] } }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeDaemonContinuityLog(schedulerDir)
    await fs.mkdir(path.join(root, "credentials"), { recursive: true })
    await fs.writeFile(
      path.join(root, "credentials", "review-submission.json"),
      JSON.stringify(
        {
          submittedAt: "after lunch",
          credentials: [{ credentialID: "router-admin", label: "Router admin", password: "********" }],
        },
        null,
        2,
      ) + "\n",
    )
    await writeFinalHandoffProof(dir.path, operationID, "2026-05-08T20:05:00.000Z")
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify(
        {
          operationID,
          ok: true,
          blockers: [],
          generatedAt: "2026-05-08T20:05:00.000Z",
          checks: {
            finalHandoff: { ok: true, gates: { minOutlineTargetPages: 50, minPdfPages: 50 } },
            credentialHandoff: { ok: true, required: true, credentialCount: 1 },
          },
        },
        null,
        2,
      ) + "\n",
    )

    const result = await auditLiteralRunReadiness(dir.path, { operationID })
    const credentialCheck = result.checks.find((item) => item.id === "credential-handoff-proof")
    expect(result.status).toBe("incomplete")
    expect(credentialCheck?.status).toBe("fail")
    expect(credentialCheck?.detail).toContain("credential review submittedAt is not a valid timestamp")
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
