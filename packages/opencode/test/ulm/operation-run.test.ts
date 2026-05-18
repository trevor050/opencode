import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { lintReport, writeCoverageContract, writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { formatOperationRun, runOperationStep } from "@/ulm/operation-run"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation run controller", () => {
  test("returns repair guidance instead of throwing for pre-graph terminal lane updates", async () => {
    await using dir = await tmpdir({ git: true })

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "block_lane",
      laneID: "charter_research",
      summary: "Service inventory cannot start until target variables are clarified.",
    })

    expect(result.action).toBe("wait")
    expect(result.reason).toContain("operation graph is missing")
    expect(result.blockers).toContain("operation graph is missing")
    expect(result.blockers).toContain("block_lane cannot update charter_research before operation_schedule writes the graph")
    expect(result.repairHints.join("\n")).toContain("operation_checkpoint")
    expect(result.repairHints.join("\n")).toContain("operation_plan")
    expect(result.taskParams).toBeUndefined()
    const runLog = await fs.readFile(result.runLogPath, "utf8")
    expect(runLog).toContain('"mode":"block_lane"')
    expect(runLog).toContain('"action":"wait"')
  })

  test("advances the first ready lane without manual graph mutation", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runOperationStep(dir.path, { operationID: "School" })

    expect(result.action).toBe("launch_lane")
    expect(result.laneID).toBe("district_profile")
    expect(result.taskParams?.background).toBe(true)
    expect(result.taskParams?.modelRoute).toBe("openai/gpt-5.4-mini-fast")
    expect(result.taskParams?.allowedTools).toEqual(
      expect.arrayContaining(["district_profile", "webfetch", "websearch", "evidence_record", "task", "operation_run", "bash", "read", "grep", "glob"]),
    )
    expect(result.taskParams?.prompt).toContain("Use the listed tools as the lane toolbox")
    expect(result.taskParams?.prompt).toContain("Bounded foreground shell is fine when bash is listed")
    expect(result.taskParams?.prompt).toContain("poll their heartbeat/stdout/stderr artifacts with read/grep")
    expect(result.taskParams?.prompt).toContain("Avoid sleep-wait loops and open-ended tail commands")
    expect(result.commandProfiles).toEqual([])
    const graph = JSON.parse(await fs.readFile(result.graphPath, "utf8"))
    expect(graph.lanes.find((lane: { id: string }) => lane.id === "district_profile")?.status).toBe("running")
  })

  test("includes operation plan scope rules in launched lane prompts", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "plans"), { recursive: true })
    await fs.writeFile(
      path.join(operationRoot, "plans", "operation-plan.json"),
      JSON.stringify(
        {
          operationID: "school",
          scopeRules: ["Only scan 10.20.0.0/16.", "Exclude payroll systems."],
        },
        null,
        2,
      ) + "\n",
    )
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runOperationStep(dir.path, { operationID: "School" })

    expect(result.action).toBe("launch_lane")
    expect(result.taskParams?.prompt).toContain("Operation scope rules:")
    expect(result.taskParams?.prompt).toContain("Only scan 10.20.0.0/16.")
    expect(result.taskParams?.prompt).toContain("Exclude payroll systems.")
  })

  test("marks complete lanes and unlocks dependent lanes", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    started.lanes.find((lane: { id: string }) => lane.id === "recon").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "commands"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "raw", "service-inventory.xml"), "<nmaprun />\n")
    await fs.writeFile(path.join(operationRoot, "commands", "service-inventory.log"), "complete\n")
    await fs.writeFile(path.join(operationRoot, "status.md"), "recon done\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "recon",
      summary: "Recon finished.",
      artifacts: ["evidence/raw/", "commands/", "status.md"],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "recon")?.status).toBe("complete")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "web_inventory")?.status).toBe("ready")
    expect(result.action).toBe("wait")
    expect(result.reason).toContain("recorded complete_lane for lane recon; scheduler will choose the next lane")
    expect(result.reason).toContain("Next lane ready:")
    expect(result.laneID).toBe("recon")
    expect(result.taskParams).toBeUndefined()
    expect(result.completedLanes).toContain("recon")
  })

  test("supplements complete-lane proof with existing expected artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    started.lanes.find((lane: { id: string }) => lane.id === "recon").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "commands", "service-inventory"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "raw", "service-inventory.xml"), "<nmaprun />\n")
    await fs.writeFile(path.join(operationRoot, "commands", "service-inventory", "command-plan.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "status.md"), "recon done\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "recon",
      summary: "Recon finished.",
      artifacts: ["evidence/raw/service-inventory.xml"],
    })

    const proof = JSON.parse(await fs.readFile(path.join(operationRoot, "lane-complete", "recon.json"), "utf8"))
    expect(result.completedLanes).toContain("recon")
    expect(proof.artifacts).toContain("commands/")
    expect(proof.artifacts).toContain("status.md")
  })

  test("rejects raw credential secrets in lane completion and terminal proofs", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    started.lanes.find((lane: { id: string }) => lane.id === "recon").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")

    await expect(
      runOperationStep(dir.path, {
        operationID: "School",
        mode: "complete_lane",
        laneID: "recon",
        summary: "Recon used password: Summer2026!",
        artifacts: ["evidence/raw/", "commands/", "status.md"],
      }),
    ).rejects.toThrow("operation run inputs must not contain raw credential secrets")

    await expect(
      runOperationStep(dir.path, {
        operationID: "School",
        mode: "block_lane",
        laneID: "recon",
        summary: "Blocked because token: raw-token-123 was pasted in chat.",
      }),
    ).rejects.toThrow("operation run inputs must not contain raw credential secrets")
  })

  test("does not reject internal background job metadata as operation run input", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "profiles"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.md"), "# District Profile\n")
    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    started.lanes.find((lane: { id: string }) => lane.id === "district_profile").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "district_profile",
      summary: "District profile finished.",
      artifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
      backgroundJobs: [
        {
          id: "job-1",
          type: "task",
          status: "completed",
          startedAt: Date.now(),
          completedAt: Date.now(),
          metadata: { note: "historical task text may mention password: raw-from-other-context" },
        },
      ] as any,
    })

    expect(result.completedLanes).toContain("district_profile")
  })

  test("ignores background jobs persisted from a different worktree for the same operation", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "profiles"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.md"), "# District Profile\n")
    const record = JSON.parse(await fs.readFile(graph.json, "utf8"))
    record.lanes.find((lane: { id: string }) => lane.id === "district_profile").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(record, null, 2) + "\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "district_profile",
      summary: "District profile finished.",
      artifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
      backgroundJobs: [
        {
          id: "old-temp-run-task",
          type: "task",
          status: "completed",
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          metadata: {
            operationID: "school",
            laneID: "district_profile",
            worktree: path.join(dir.path, "..", "previous-probe-workspace"),
          },
        },
      ] as any,
    })

    expect(result.syncedJobs).not.toContain("old-temp-run-task")
    expect(result.completedLanes).toEqual(["district_profile"])
  })

  test("ignores stale work-queue jobs from a different worktree", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.writeFile(
      path.join(operationRoot, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: new Date().toISOString(),
          units: [
            {
              id: "unit-1",
              operationID: "school",
              laneID: "recon",
              profileID: "service-inventory",
              status: "running",
              variables: { target: "10.0.0.5" },
              outputPrefix: "evidence/raw/service-inventory-10-0-0-5",
              rationale: "Synthetic stale sync regression.",
              safety: "non_destructive",
              attempts: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      ) + "\n",
    )

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "old-temp-command",
          type: "command_supervise",
          status: "completed",
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          metadata: {
            operationID: "school",
            workUnitID: "unit-1",
            worktree: path.join(dir.path, "..", "previous-probe-workspace"),
          },
        },
      ] as any,
    })
    const queue = JSON.parse(await fs.readFile(path.join(operationRoot, "work-queue.json"), "utf8"))

    expect(result.syncedWorkUnits).not.toContain("unit-1")
    expect(queue.units[0].status).toBe("running")
    expect(queue.units[0].jobID).toBeUndefined()
  })

  test("accepts empty supervised command stderr logs as completion proof", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    started.lanes.find((lane: { id: string }) => lane.id === "recon").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")

    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "commands", "service-inventory"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "raw", "service-inventory.xml"), "<nmaprun />\n")
    await fs.writeFile(path.join(operationRoot, "commands", "service-inventory", "stderr.log"), "")
    await fs.writeFile(path.join(operationRoot, "status.md"), "recon done\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "recon",
      summary: "Recon finished with clean supervised command stderr.",
      artifacts: ["evidence/raw/", "commands/service-inventory/stderr.log", "status.md"],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(result.blockers).toEqual([])
    expect(result.completedLanes).toContain("recon")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "recon")?.status).toBe("complete")
  })

  test("completes a ready lane when explicit proof artifacts exist", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "commands"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "raw", "service-inventory.xml"), "<nmaprun />\n")
    await fs.writeFile(path.join(operationRoot, "commands", "service-inventory.log"), "complete\n")
    await fs.writeFile(path.join(operationRoot, "status.md"), "recon done\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "recon",
      summary: "Recon finished.",
      artifacts: ["evidence/raw/", "commands/", "status.md"],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(result.blockers).toEqual([])
    expect(result.completedLanes).toContain("recon")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "recon")?.status).toBe("complete")
  })

  test("does not complete a lane when proof artifacts are missing", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "district_profile",
      summary: "District profile finished.",
      artifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(result.blockers).toContain("proof artifact is missing or empty: profiles/district-profile.json")
    expect(result.completedLanes).not.toContain("district_profile")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "district_profile")?.status).toBe("running")
  })

  test("points successful lane completion at the next scheduler action instead of rescheduling", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "profiles"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.md"), "# District Profile\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "district_profile",
      summary: "District profile finished.",
      artifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
    })

    expect(result.completedLanes).toContain("district_profile")
    expect(result.reason).toContain("Next lane ready:")
    expect(result.repairHints.some((hint) => hint.includes("Do not call operation_schedule"))).toBe(true)
  })

  test("points report lane proof failures at the render and runtime tools", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "reports"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "reports", "report.md"), "# Report\n\nEvidence-backed report draft.\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "report_writing",
      summary: "Report writing finished.",
      artifacts: ["reports/report.md"],
      evidenceRefs: ["ev-report"],
    })

    expect(result.blockers).toContain("proof does not cover expected artifact: deliverables/final/report.html")
    expect(result.repairHints).toContain(
      "Final package proof is missing deliverables/final/report.html. Run report_render, then runtime_summary if runtime-summary.md is expected, then retry operation_run complete_lane with the generated deliverables/final paths.",
    )
    expect(formatOperationRun(result)).toContain("## Repair Hints")
    expect(formatOperationRun(result)).toContain("Run report_render")
  })

  test("auto-completes report lanes from rendered final package artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    const finalDir = path.join(operationRoot, "deliverables", "final")
    await fs.mkdir(path.join(operationRoot, "evidence"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "reports"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "deliverables"), { recursive: true })
    await fs.mkdir(finalDir, { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "ev-report.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "evidence-index.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "reports", "report-outline.md"), "# Outline\n")
    await fs.writeFile(path.join(operationRoot, "reports", "report.md"), "# Report\n")
    await fs.writeFile(path.join(operationRoot, "deliverables", "eval-scorecard.json"), "{}\n")
    for (const file of [
      "evidence-index.json",
      "report.html",
      "report.pdf",
      "findings.json",
      "operator-review.md",
      "executive-summary.md",
      "technical-appendix.md",
      "runtime-summary.md",
      "manifest.json",
      "README.md",
    ]) {
      await fs.writeFile(path.join(finalDir, file), `${file}\n`)
    }
    const record = JSON.parse(await fs.readFile(graph.json, "utf8"))
    for (const lane of record.lanes) {
      if (lane.id === "evidence_normalization" || lane.id === "finding_validation") lane.status = "complete"
      if (
        [
          "report_evidence_index",
          "report_writing",
          "report_technical_review",
          "report_executive_review",
          "report_review",
          "operator_summary",
        ].includes(lane.id)
      ) {
        lane.status = lane.id === "report_evidence_index" ? "ready" : "pending"
      }
    }
    await fs.writeFile(graph.json, JSON.stringify(record, null, 2) + "\n")

    const result = await runOperationStep(dir.path, { operationID: "School" })
    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const completed = updated.lanes
      .filter((lane: { status: string }) => lane.status === "complete")
      .map((lane: { id: string }) => lane.id)

    expect(result.completedLanes).toEqual([
      "report_evidence_index",
      "report_writing",
      "report_technical_review",
      "report_executive_review",
      "report_review",
      "operator_summary",
    ])
    expect(completed).toEqual(expect.arrayContaining(result.completedLanes))
    const proof = JSON.parse(
      await fs.readFile(path.join(operationRoot, "lane-complete", "report_review.json"), "utf8"),
    )
    expect(proof.jobID).toBe("auto-final-package-proof")
    expect(proof.evidenceRefs).toEqual(["ev-report"])
  })

  test("does not auto-complete report lanes while planned duration work is incomplete", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    const finalDir = path.join(operationRoot, "deliverables", "final")
    await fs.mkdir(path.join(operationRoot, "evidence"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "reports"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "deliverables"), { recursive: true })
    await fs.mkdir(finalDir, { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "ev-report.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "evidence-index.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "reports", "report-outline.md"), "# Outline\n")
    await fs.writeFile(path.join(operationRoot, "reports", "report.md"), "# Report\n")
    for (const file of [
      "evidence-index.json",
      "report.html",
      "report.pdf",
      "findings.json",
      "operator-review.md",
      "executive-summary.md",
      "technical-appendix.md",
      "runtime-summary.md",
      "manifest.json",
      "README.md",
    ]) {
      await fs.writeFile(path.join(finalDir, file), `${file}\n`)
    }
    const record = JSON.parse(await fs.readFile(graph.json, "utf8"))
    record.lanes.splice(record.lanes.findIndex((lane: { id: string }) => lane.id === "report_evidence_index"), 0, {
      id: "planned_work_recon_1",
      title: "Planned recon block",
      agent: "recon",
      status: "pending",
      dependsOn: [],
      modelRoute: "openai/gpt-5.4-mini-fast",
      fallbackModelRoutes: ["openai/gpt-5.5"],
      allowedTools: ["operation_checkpoint", "operation_run"],
      expectedArtifacts: ["work-blocks/recon-1.md"],
      budget: {},
      restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 60 },
      coverageImpact: "high",
      releaseRequired: false,
      operationID: "school",
    })
    for (const lane of record.lanes) {
      if (!lane.id.startsWith("planned_work_") && !lane.id.startsWith("report_")) {
        lane.status = "complete"
        lane.terminalState = "complete"
      }
      if (lane.id === "evidence_normalization" || lane.id === "finding_validation") lane.status = "complete"
      if (lane.id === "report_evidence_index") lane.status = "ready"
    }
    await fs.writeFile(graph.json, JSON.stringify(record, null, 2) + "\n")

    const result = await runOperationStep(dir.path, { operationID: "School" })
    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))

    expect(result.completedLanes).not.toContain("report_evidence_index")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "planned_work_recon_1")?.status).toBe("running")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "report_evidence_index")?.status).toBe("ready")
  })

  test("rejects planned work completion before the lane wall-clock floor", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "work-blocks"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "evidence"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "work-blocks", "recon-1.md"), "# Recon block\n")
    await fs.writeFile(path.join(operationRoot, "evidence", "ev-recon-1.json"), "{}\n")
    const record = JSON.parse(await fs.readFile(graph.json, "utf8"))
    record.lanes.splice(0, 0, {
      id: "planned_work_recon_1",
      title: "Planned recon block",
      agent: "recon",
      status: "running",
      dependsOn: [],
      modelRoute: "openai/gpt-5.4-mini-fast",
      fallbackModelRoutes: ["openai/gpt-5.5"],
      allowedTools: ["operation_checkpoint", "operation_run"],
      expectedArtifacts: ["work-blocks/recon-1.md"],
      budget: {},
      restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 60 },
      startedAt: "2026-05-05T00:00:00.000Z",
      plannedDurationMinutes: 30,
      minRuntimeMinutes: 20,
      coverageImpact: "high",
      releaseRequired: false,
      operationID: "school",
    })
    await fs.writeFile(graph.json, JSON.stringify(record, null, 2) + "\n")

    const early = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "planned_work_recon_1",
      now: "2026-05-05T00:05:00.000Z",
      summary: "Recon block finished.",
      artifacts: ["work-blocks/recon-1.md"],
      evidenceRefs: ["ev-recon-1"],
    })
    const afterEarly = JSON.parse(await fs.readFile(graph.json, "utf8"))

    expect(early.blockers.join("\n")).toContain("requires at least 20m before completion")
    expect(afterEarly.lanes.find((lane: { id: string }) => lane.id === "planned_work_recon_1")?.status).toBe("running")

    const accepted = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "planned_work_recon_1",
      now: "2026-05-05T00:21:00.000Z",
      summary: "Recon block finished after the wall-clock floor.",
      artifacts: ["work-blocks/recon-1.md"],
      evidenceRefs: ["ev-recon-1"],
    })
    const afterAccepted = JSON.parse(await fs.readFile(graph.json, "utf8"))

    expect(accepted.blockers).toEqual([])
    expect(afterAccepted.lanes.find((lane: { id: string }) => lane.id === "planned_work_recon_1")?.status).toBe("complete")
  })

  test("allows planned work recovery from existing artifacts when scheduler start time is missing", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "work-blocks"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "evidence"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "work-blocks", "recon-1.md"), "# Recon block\n")
    await fs.writeFile(path.join(operationRoot, "evidence", "ev-recon-1.json"), "{}\n")
    const record = JSON.parse(await fs.readFile(graph.json, "utf8"))
    record.lanes.splice(0, 0, {
      id: "planned_work_recon_1",
      title: "Planned recon block",
      agent: "recon",
      status: "ready",
      dependsOn: [],
      modelRoute: "openai/gpt-5.4-mini-fast",
      fallbackModelRoutes: ["openai/gpt-5.5"],
      allowedTools: ["operation_checkpoint", "operation_run"],
      expectedArtifacts: ["work-blocks/recon-1.md"],
      budget: {},
      restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 60 },
      plannedDurationMinutes: 30,
      minRuntimeMinutes: 20,
      coverageImpact: "high",
      releaseRequired: false,
      operationID: "school",
    })
    await fs.writeFile(graph.json, JSON.stringify(record, null, 2) + "\n")

    const recovered = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "planned_work_recon_1",
      now: "2026-05-05T00:05:00.000Z",
      summary: "Recovered completed recon block from durable artifacts after scheduler state was lost.",
      artifacts: ["work-blocks/recon-1.md"],
      evidenceRefs: ["ev-recon-1"],
    })
    const afterRecovered = JSON.parse(await fs.readFile(graph.json, "utf8"))

    expect(recovered.blockers).toEqual([])
    expect(afterRecovered.lanes.find((lane: { id: string }) => lane.id === "planned_work_recon_1")?.status).toBe(
      "complete",
    )
  })

  test("rejects planned work terminal blockers that do not leave durable fallback proof", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    const record = JSON.parse(await fs.readFile(graph.json, "utf8"))
    record.lanes.splice(0, 0, {
      id: "planned_work_recon_1",
      title: "Planned recon block",
      agent: "recon",
      status: "running",
      dependsOn: [],
      modelRoute: "openai/gpt-5.4-mini-fast",
      fallbackModelRoutes: ["openai/gpt-5.5"],
      allowedTools: ["operation_checkpoint", "operation_run"],
      expectedArtifacts: ["work-blocks/recon-1.md"],
      budget: {},
      restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 60 },
      startedAt: "2026-05-05T00:00:00.000Z",
      plannedDurationMinutes: 30,
      minRuntimeMinutes: 20,
      coverageImpact: "high",
      releaseRequired: false,
      operationID: "school",
    })
    await fs.writeFile(graph.json, JSON.stringify(record, null, 2) + "\n")

    const emptyBlock = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "block_lane",
      laneID: "planned_work_recon_1",
      now: "2026-05-05T00:10:00.000Z",
      summary: "Blocked.",
    })

    expect(emptyBlock.blockers.join("\n")).toContain("planned work blocked proof requires artifacts")
    expect(emptyBlock.blockers.join("\n")).toContain("planned work blocked proof requires evidenceRefs")

    await fs.mkdir(path.join(operationRoot, "work-blocks"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "work-blocks", "recon-1.md"), "# Recon fallback\n")
    const recordedBlock = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "block_lane",
      laneID: "planned_work_recon_1",
      now: "2026-05-05T00:12:00.000Z",
      summary: "Primary recon profile blocked; fallback limitations were recorded.",
      artifacts: ["work-blocks/recon-1.md"],
      evidenceRefs: ["ev-recon-limitation"],
    })
    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))

    expect(recordedBlock.blockers).toEqual([])
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "planned_work_recon_1")?.status).toBe("blocked")
  })

  test("records skipped lanes with release impact and does not treat them as complete", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "skip_lane",
      laneID: "district_profile",
      summary: "District profile was skipped because the target public site was unavailable; continue with network-safe recon.",
      coverageImpact: "blocks_release",
      releaseRequired: true,
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const lane = updated.lanes.find((item: { id: string }) => item.id === "district_profile")
    const proof = JSON.parse(
      await fs.readFile(path.join(dir.path, ".ulmcode", "operations", "school", "lane-complete", "district_profile.json"), "utf8"),
    )
    expect(result.skippedLanes).toContain("district_profile")
    expect(result.completedLanes).not.toContain("district_profile")
    expect(lane?.status).toBe("skipped")
    expect(lane?.terminalState).toBe("skipped")
    expect(lane?.coverageImpact).toBe("blocks_release")
    expect(proof.status).toBe("skipped")
  })

  test("allows valid complete proof to repair a terminal release report lane", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    const finalDir = path.join(operationRoot, "deliverables", "final")
    await fs.mkdir(path.join(operationRoot, "evidence"), { recursive: true })
    await fs.mkdir(finalDir, { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "ev-report.json"), "{}\n")
    for (const file of [
      "evidence-index.json",
      "report.html",
      "report.pdf",
      "findings.json",
      "operator-review.md",
      "executive-summary.md",
      "technical-appendix.md",
      "runtime-summary.md",
      "manifest.json",
    ]) {
      await fs.writeFile(path.join(finalDir, file), `${file}\n`)
    }
    const record = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const lane = record.lanes.find((item: { id: string }) => item.id === "report_review")
    lane.status = "skipped"
    lane.terminalState = "skipped"
    await fs.mkdir(path.join(operationRoot, "lane-complete"), { recursive: true })
    await fs.writeFile(
      path.join(operationRoot, "lane-complete", "report_review.json"),
      JSON.stringify(
        {
          operationID: "school",
          laneID: "report_review",
          status: "skipped",
          completedAt: new Date().toISOString(),
          summary: "Report review was previously skipped before final artifacts existed.",
          artifacts: ["deliverables/final/report.pdf"],
          evidenceRefs: ["ev-report"],
          coverageImpact: "blocks_release",
          releaseRequired: true,
        },
        null,
        2,
      ) + "\n",
    )
    await fs.writeFile(graph.json, JSON.stringify(record, null, 2) + "\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "complete_lane",
      laneID: "report_review",
      summary: "Report review repaired after final artifacts were rendered and linted.",
      artifacts: [
        "deliverables/final/report.pdf",
        "deliverables/final/report.html",
        "deliverables/final/findings.json",
        "deliverables/final/evidence-index.json",
        "deliverables/final/operator-review.md",
        "deliverables/final/executive-summary.md",
        "deliverables/final/technical-appendix.md",
        "deliverables/final/runtime-summary.md",
        "deliverables/final/manifest.json",
      ],
      evidenceRefs: ["ev-report"],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const updatedLane = updated.lanes.find((item: { id: string }) => item.id === "report_review")
    const proof = JSON.parse(await fs.readFile(path.join(operationRoot, "lane-complete", "report_review.json"), "utf8"))
    expect(result.blockers).toEqual([])
    expect(result.completedLanes).toContain("report_review")
    expect(updatedLane.status).toBe("complete")
    expect(updatedLane.terminalState).toBe("complete")
    expect(proof.status).toBe("complete")
  })

  test("does not let a tool downgrade release-required lane impact while skipping", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      mode: "skip_lane",
      laneID: "recon",
      summary: "Trying to make a release-required lane disappear.",
      coverageImpact: "low",
      releaseRequired: false,
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const lane = updated.lanes.find((item: { id: string }) => item.id === "recon")
    expect(result.blockers).toContain("recon: releaseRequired cannot be downgraded by skipped")
    expect(result.blockers).toContain("recon: coverageImpact cannot be downgraded from blocks_release to low")
    expect(result.skippedLanes).not.toContain("recon")
    expect(lane?.status).toBe("ready")
    await expect(
      fs.readFile(path.join(dir.path, ".ulmcode", "operations", "school", "lane-complete", "recon.json"), "utf8"),
    ).rejects.toThrow()
  })

  test("allows non-release no-impact skipped synthetic lanes to satisfy final graph gates", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, {
      operationID: "Synthetic Fanout",
      template: "benchmark-suite",
      includeSupervisor: true,
      budgetUSD: 10,
    })
    await writeRuntimeSummary(dir.path, {
      operationID: "Synthetic Fanout",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await writeCoverageContract(dir.path, {
      operationID: "Synthetic Fanout",
      status: "released",
      goals: ["Synthetic benchmark release."],
      minimumEvidence: ["Supplied synthetic evidence."],
      requiredLanes: ["recon"],
      allowedSkippedLanes: [],
      fallbackRules: ["No live web targets were authorized."],
      retryRules: ["Retry idempotent report gates only."],
      subagentOpportunities: ["probe_recon"],
      reportGates: ["operation_audit finalHandoff=true"],
      releaseNotes: ["Synthetic web inventory is non-release and no-impact."],
    })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "synthetic-fanout")
    await fs.mkdir(path.join(operationRoot, "evidence"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "synthetic-web-inventory.md"), "# Synthetic Web Inventory\n")

    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const webInventory = started.lanes.find((lane: { id: string }) => lane.id === "web_inventory")
    webInventory.status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")

    const result = await runOperationStep(dir.path, {
      operationID: "Synthetic Fanout",
      mode: "skip_lane",
      laneID: "web_inventory",
      summary:
        "No live web targets were authorized; synthetic web inventory proof records supplied-evidence scope and mapping.",
      artifacts: ["evidence/synthetic-web-inventory.md"],
      coverageImpact: "none",
      releaseRequired: false,
    })

    expect(result.blockers).toEqual([])
    const lint = await lintReport(dir.path, "Synthetic Fanout", { finalHandoff: true })
    expect(lint.gaps).not.toContain("operation lane web_inventory is not complete")
    expect(lint.gaps).not.toContain("operation lane web_inventory has invalid completion proof")
  })

  test("auto-completes running lanes only when lane completion proof references real artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "profiles"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.json"), "{}\n")
    await fs.writeFile(path.join(operationRoot, "profiles", "district-profile.md"), "# District Profile\n")
    await fs.mkdir(path.join(operationRoot, "lane-complete"), { recursive: true })
    await fs.writeFile(
      path.join(operationRoot, "lane-complete", "district_profile.json"),
      JSON.stringify(
        {
          operationID: "school",
          laneID: "district_profile",
          status: "complete",
          completedAt: new Date().toISOString(),
          summary: "District profile has concrete artifacts.",
          artifacts: ["profiles/district-profile.json", "profiles/district-profile.md"],
          evidenceRefs: [],
        },
        null,
        2,
      ),
    )

    const result = await runOperationStep(dir.path, { operationID: "School" })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    expect(result.completedLanes).toContain("district_profile")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "district_profile")?.status).toBe("complete")
    expect(updated.lanes.find((lane: { id: string }) => lane.id === "person_recon")?.status).toBe("running")
  })

  test("syncs completed background jobs back to lane state", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const operationRoot = path.join(dir.path, ".ulmcode", "operations", "school")
    await fs.mkdir(path.join(operationRoot, "evidence", "raw"), { recursive: true })
    await fs.mkdir(path.join(operationRoot, "commands"), { recursive: true })
    await fs.writeFile(path.join(operationRoot, "evidence", "raw", "service-inventory.xml"), "<nmaprun />\n")
    await fs.writeFile(path.join(operationRoot, "commands", "service-inventory.log"), "complete\n")
    await fs.writeFile(path.join(operationRoot, "status.md"), "recon done\n")
    await fs.mkdir(path.join(operationRoot, "lane-complete"), { recursive: true })
    await fs.writeFile(
      path.join(operationRoot, "lane-complete", "recon.json"),
      JSON.stringify(
        {
          operationID: "school",
          laneID: "recon",
          status: "complete",
          completedAt: new Date().toISOString(),
          summary: "Recon completed in a background job.",
          artifacts: ["evidence/raw/", "commands/", "status.md"],
          evidenceRefs: [],
        },
        null,
        2,
      ),
    )
    await fs.writeFile(
      path.join(operationRoot, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: new Date().toISOString(),
          units: [
            {
              id: "work-unit-recon",
              operationID: "school",
              laneID: "recon",
              profileID: "service-inventory",
              status: "running",
              variables: { target: "10.0.0.5" },
              outputPrefix: "evidence/raw/service-inventory-10-0-0-5",
              rationale: "test",
              safety: "non_destructive",
              attempts: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      ),
    )

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "task_123",
          type: "task",
          title: "Recon",
          status: "completed",
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          metadata: { operationID: "school", laneID: "recon", workUnitID: "work-unit-recon" },
        },
      ],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const recon = updated.lanes.find((lane: { id: string }) => lane.id === "recon")
    expect(result.syncedJobs).toContain("task_123")
    expect(result.completedLanes).toContain("recon")
    expect(result.completedWorkUnits).toContain("work-unit-recon")
    expect(recon?.status).toBe("complete")
    expect(recon?.activeJobs[0]?.status).toBe("completed")
    const queue = JSON.parse(await fs.readFile(path.join(operationRoot, "work-queue.json"), "utf8"))
    expect(queue.units[0]?.status).toBe("complete")
  })

  test("does not fail a running lane just because one supervised command errors", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    started.lanes.find((lane: { id: string }) => lane.id === "recon").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "cmd_udp_scan",
          type: "command_supervise",
          title: "udp-top-ports-sweep",
          status: "error",
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          metadata: { operationID: "school", laneID: "recon", profileID: "udp-top-ports-sweep" },
        },
      ],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const recon = updated.lanes.find((lane: { id: string }) => lane.id === "recon")
    expect(result.syncedJobs).toContain("cmd_udp_scan")
    expect(result.failedLanes).not.toContain("recon")
    expect(recon?.status).toBe("running")
    expect(recon?.activeJobs[0]?.status).toBe("error")
  })

  test("completed model jobs without lane proof become recoverable instead of passive wait", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    const started = JSON.parse(await fs.readFile(graph.json, "utf8"))
    started.lanes.find((lane: { id: string }) => lane.id === "recon").status = "running"
    await fs.writeFile(graph.json, JSON.stringify(started, null, 2) + "\n")

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "task_recon_no_proof",
          type: "task",
          title: "Recon",
          status: "completed",
          startedAt: Date.now() - 1000,
          completedAt: Date.now(),
          metadata: { operationID: "school", laneID: "recon" },
        },
      ],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const recon = updated.lanes.find((lane: { id: string }) => lane.id === "recon")
    expect(result.syncedJobs).toContain("task_recon_no_proof")
    expect(result.action).toBe("launch_lane")
    expect(result.laneID).not.toBeUndefined()
    expect(result.taskParams?.laneID).not.toBeUndefined()
    expect(recon?.status).toBe("ready")
    expect(recon?.activeJobs[0]?.status).toBe("completed_missing_proof")
  })

  test("syncs a recovered running job back from failed to running", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await runOperationStep(dir.path, { operationID: "School" })
    await runOperationStep(dir.path, { operationID: "School", mode: "fail_lane", laneID: "recon" })

    const result = await runOperationStep(dir.path, {
      operationID: "School",
      backgroundJobs: [
        {
          id: "task_recovered",
          type: "task",
          title: "Recon",
          status: "running",
          startedAt: Date.now(),
          metadata: { operationID: "school", laneID: "recon" },
        },
      ],
    })

    const updated = JSON.parse(await fs.readFile(graph.json, "utf8"))
    const recon = updated.lanes.find((lane: { id: string }) => lane.id === "recon")
    expect(result.syncedJobs).toContain("task_recovered")
    expect(recon?.status).toBe("running")
  })
})
