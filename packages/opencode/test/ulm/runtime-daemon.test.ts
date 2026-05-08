import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { createOperationGoal } from "@/ulm/operation-goal"
import { operationPath, writeOperationPlan, writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { runRuntimeDaemon } from "@/ulm/runtime-daemon"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")

function fakeClock(start: string, stepSeconds: number) {
  let tick = 0
  return () => new Date(Date.parse(start) + tick++ * stepSeconds * 1000)
}

async function writeDaemonSupervisorFixture(worktree: string) {
  await createOperationGoal(worktree, {
    operationID: "School",
    objective: "Authorized overnight internal assessment.",
    targetDurationHours: 20,
  })
  await writeOperationPlan(worktree, {
    operationID: "School",
    phases: [
      {
        stage: "recon",
        objective: "Build a bounded inventory.",
        actions: ["Run passive discovery."],
        successCriteria: ["Inventory is recorded."],
        subagents: ["recon"],
        noSubagents: [],
      },
    ],
    reportingCloseout: [
      "report_lint before handoff",
      "report_render final package",
      "runtime_summary final accounting",
    ],
  })
  await writeOperationGraph(worktree, { operationID: "School", budgetUSD: 10 })
  const root = operationPath(worktree, "School")
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8"))
  graph.lanes.push({
    id: "supervisor",
    title: "Supervisor heartbeat",
    agent: "pentest",
    status: "complete",
    dependsOn: [],
    modelRoute: "openai/gpt-5.5-fast",
    fallbackModelRoutes: ["openai/gpt-5.4-mini-fast"],
    allowedTools: ["operation_supervise", "operation_resume", "operation_status"],
    expectedArtifacts: ["supervisor/latest.md"],
    budget: {},
    restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 30 },
    operationID: "school",
  })
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
  await writeRuntimeSummary(worktree, {
    operationID: "School",
    usage: { costUSD: 1, budgetUSD: 10 },
    compaction: { pressure: "low" },
  })
}

describe("ULM runtime daemon", () => {
  test("owns a wall-clock scheduler loop with heartbeats and a released lock", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const sleeps: number[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 5,
      maxCycles: 2,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    })

    expect(result.cycles.length).toBeGreaterThanOrEqual(1)
    expect(sleeps).toEqual([5000])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.operationID).toBe("school")
    await expect(fs.access(result.lockPath)).rejects.toThrow()
    expect(await fs.readFile(result.logPath, "utf8")).toContain('"operationID":"school"')
  })

  test("passes scheduler launch hooks through daemon ticks", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const launched: string[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      supervisorEnabled: false,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
      launchModelLane: async (params) => {
        launched.push(params.laneID)
        return { jobID: `job-${params.laneID}` }
      },
    })

    expect(launched).toEqual(["district_profile"])
    expect(result.cycles[0]?.launchedJobs).toEqual(["job-district_profile"])
  })

  test("bootstraps readiness proof artifacts for literal long runs", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const manifestPath = path.join(dir.path, "tool-manifest.json")
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
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
        },
        null,
        2,
      ) + "\n",
    )

    await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 20 * 60 * 60,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      toolManifestPath: manifestPath,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
    })

    const root = operationPath(dir.path, "School")
    const preflight = JSON.parse(await fs.readFile(path.join(root, "tools", "tool-preflight.json"), "utf8"))
    const routeAudit = JSON.parse(await fs.readFile(path.join(root, "deliverables", "model-route-audit.json"), "utf8"))
    const runtime = JSON.parse(await fs.readFile(path.join(root, "deliverables", "runtime-summary.json"), "utf8"))
    expect(preflight.blocked).toBe(0)
    expect(preflight.tools[0]?.toolID).toBe("fixture-tool")
    expect(routeAudit.routes.some((route: { route?: string }) => route.route === "opencode-go/qwen3.6-plus")).toBe(true)
    expect(runtime.usage.costUSD).toBe(0)
    expect(runtime.compaction.pressure).toBe("low")
  })

  test("does not exit the wall-clock daemon on compact maintenance decisions", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "high" },
    })

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      maxCycles: 2,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
    })

    expect(result.cycles).toHaveLength(2)
    expect(result.cycles.every((cycle) => cycle.run?.action === "compact")).toBe(true)
    expect(result.stopped).toBe(false)
    expect(result.reason).toBe("max scheduler cycles reached")
  })

  test("stops early when no scheduled operation work remains before the literal window elapses", async () => {
    await using dir = await tmpdir({ git: true })
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete" }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 20 * 60 * 60,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      supervisorEnabled: false,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
    })

    expect(result.stopped).toBe(true)
    expect(result.reason).toBe("no scheduled operation work remains before target runtime elapsed")
  })

  test("enables supervisor review from the daemon target window even when the stored goal is short", async () => {
    await using dir = await tmpdir({ git: true })
    await createOperationGoal(dir.path, {
      operationID: "School",
      objective: "Accelerated proof that is being rerun as a literal daemon.",
      targetDurationHours: 0.02,
    })
    await writeOperationPlan(dir.path, {
      operationID: "School",
      phases: [
        {
          stage: "reporting",
          objective: "Fix final report blockers.",
          actions: ["Expand report"],
          successCriteria: ["Final audit passes"],
          subagents: ["report-writer"],
          noSubagents: ["final audit decision"],
        },
      ],
      reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary", "Run operation_audit"],
    })
    const written = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const graph = JSON.parse(await fs.readFile(written.json, "utf8"))
    graph.lanes = graph.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(written.json, JSON.stringify(graph, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    await fs.mkdir(path.join(root, "deliverables"), { recursive: true })
    await fs.writeFile(
      path.join(root, "deliverables", "operation-audit.json"),
      JSON.stringify({ operationID: "school", ok: false, blockers: ["final_handoff: report is too short"] }, null, 2) + "\n",
    )

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 20 * 60 * 60,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      supervisorIntervalMinutes: 0,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
    })

    expect(result.cycles[0]?.supervisor?.enabled).toBe(true)
    expect(result.cycles[0]?.supervisor?.ran).toBe(true)
    expect(result.cycles[0]?.supervisor?.action).toBe("continue_reporting")
    expect(result.cycles[0]?.supervisor?.reason).toBe("final operation audit has unresolved blockers")
    expect(result.stopped).toBe(false)
    expect(result.reason).toBe("final operation audit has unresolved blockers")
  })

  test("recovers stale operation jobs before scheduler ticks", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const recovered: string[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
      backgroundJobs: [
        {
          id: "task_stale_recon",
          type: "task",
          title: "Recon",
          status: "stale",
          startedAt: Date.now(),
          metadata: {
            operationID: "school",
            laneID: "recon",
            prompt: "resume recon",
            subagent_type: "recon",
          },
        },
      ],
      recoverBackgroundJob: async (job) => {
        recovered.push(job.id)
        return { jobID: `${job.id}_recovered` }
      },
    })

    expect(recovered).toEqual(["task_stale_recon"])
    expect(result.recoveredJobs).toEqual(["task_stale_recon_recovered"])
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.recoveredJobs).toEqual(["task_stale_recon_recovered"])
  })

  test("passes command work-unit launch hooks through daemon ticks", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, "work-queue.json"),
      JSON.stringify(
        {
          operationID: "school",
          generatedAt: "2026-05-05T00:00:00.000Z",
          units: [
            {
              id: "work-unit-http",
              operationID: "school",
              laneID: "web_inventory",
              profileID: "http-discovery",
              status: "queued",
              variables: { inputFile: "queues/hosts.txt" },
              outputPrefix: "evidence/raw/http-discovery",
              rationale: "test",
              safety: "non_destructive",
              attempts: 0,
              createdAt: "2026-05-05T00:00:00.000Z",
              updatedAt: "2026-05-05T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    )
    const launched: string[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async () => {},
      launchCommandWorkUnit: async (params) => {
        launched.push(params.workUnitID)
        return { jobID: `cmd-${params.workUnitID}` }
      },
    })

    expect(launched).toEqual(["work-unit-http"])
    expect(result.cycles[0]?.launchedCommandJobs).toEqual(["cmd-work-unit-http"])
    const queue = JSON.parse(await fs.readFile(path.join(root, "work-queue.json"), "utf8"))
    expect(queue.units[0].jobID).toBe("cmd-work-unit-http")
  })

  test("passes supervisor cadence through daemon ticks", async () => {
    await using dir = await tmpdir({ git: true })
    await writeDaemonSupervisorFixture(dir.path)

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxRuntimeSeconds: 3600,
      cycleIntervalSeconds: 0,
      maxCycles: 2,
      supervisorIntervalMinutes: 30,
      now: fakeClock("2026-05-05T00:00:00.000Z", 600),
      sleep: async () => {},
    })

    expect(result.cycles).toHaveLength(2)
    expect(result.cycles[0]?.supervisor?.ran).toBe(true)
    expect(result.cycles[1]?.supervisor?.ran).toBe(false)
    const heartbeat = JSON.parse(await fs.readFile(result.heartbeatPath, "utf8"))
    expect(heartbeat.cycles[0].supervisor.ran).toBe(true)
    expect(heartbeat.cycles[1].supervisor.ran).toBe(false)
  })

  test("refuses an active daemon lock and replaces a stale lock", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    const lockPath = path.join(root, "scheduler", "daemon.lock.json")
    await fs.mkdir(path.dirname(lockPath), { recursive: true })
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:00:00.000Z",
      }),
    )

    await expect(
      runRuntimeDaemon(dir.path, {
        operationID: "School",
        maxCycles: 1,
        now: () => new Date("2026-05-05T00:00:10.000Z"),
        sleep: async () => {},
      }),
    ).rejects.toThrow("runtime daemon lock is active")

    const recovered = await runRuntimeDaemon(dir.path, {
      operationID: "School",
      maxCycles: 1,
      staleLockSeconds: 1,
      now: fakeClock("2026-05-05T00:10:00.000Z", 1),
      sleep: async () => {},
    })

    expect(recovered.operationID).toBe("school")
    await expect(fs.access(lockPath)).rejects.toThrow()
  })

  test("runs through the operator CLI wrapper", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
        "School",
        "--duration-seconds",
        "5",
        "--interval-seconds",
        "0",
        "--max-cycles",
        "1",
        "--json",
      ],
      {
        cwd: dir.path,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ULMCODE_DAEMON_DRY_RUN_LAUNCHES: "1" },
      },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const parsed = JSON.parse(stdout)
    expect(parsed.operationID).toBe("school")
    expect(parsed.heartbeatPath).toContain("daemon-heartbeat.json")
    expect(parsed.cycles[0].launchedJobs).toEqual(["cli-model-lane-district_profile"])
    const launches = await fs.readdir(
      path.join(dir.path, ".ulmcode", "operations", "school", "scheduler", "cli-launches"),
    )
    expect(launches.some((item) => item.includes("district_profile"))).toBe(true)
  })

  test("detaches the operator CLI wrapper for long wall-clock runs", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
        "School",
        "--duration-seconds",
        "5",
        "--interval-seconds",
        "0",
        "--max-cycles",
        "1",
        "--detach",
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
    expect(parsed.operationID).toBe("school")
    expect(parsed.pid).toBeGreaterThan(0)
    expect(await fs.readFile(parsed.launchPath, "utf8")).toContain('"operationID": "school"')
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        const heartbeat = JSON.parse(await fs.readFile(parsed.heartbeatPath, "utf8"))
        expect(heartbeat.operationID).toBe("school")
        return
      } catch {
        await Bun.sleep(100)
      }
    }
    throw new Error("detached daemon did not write heartbeat")
  })

  test("writes launchd and systemd supervisor artifacts without daemonizing under the supervisor", async () => {
    await using dir = await tmpdir({ git: true })

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
        "School",
        "--duration-hours",
        "20",
        "--interval-seconds",
        "60",
        "--supervisor",
        "all",
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
    expect(parsed.operationID).toBe("school")
    expect(parsed.files.launchdPlist).toContain("com.ulmcode.runtime-daemon.school.plist")
    expect(parsed.files.systemdService).toContain("ulmcode-runtime-daemon-school.service")
    expect(parsed.files.runbook).toContain("supervisor-install.md")
    expect(parsed.files.manifest).toContain("supervisor-manifest.json")

    const launchd = await fs.readFile(parsed.files.launchdPlist, "utf8")
    expect(launchd).toContain("<key>ProgramArguments</key>")
    expect(launchd).toContain("ulm-runtime-daemon.ts")
    expect(launchd).toContain("<key>WorkingDirectory</key>")
    expect(launchd).toContain("<key>StandardOutPath</key>")
    expect(launchd).toContain("<key>KeepAlive</key>")
    expect(launchd).not.toContain("--detach")

    const systemd = await fs.readFile(parsed.files.systemdService, "utf8")
    expect(systemd).toContain("[Service]")
    expect(systemd).toContain(`WorkingDirectory=${dir.path}`)
    expect(systemd).toContain("Restart=on-failure")
    expect(systemd).toContain("ulm-runtime-daemon.ts")
    expect(systemd).not.toContain("--detach")

    const runbook = await fs.readFile(parsed.files.runbook, "utf8")
    expect(runbook).toContain("launchctl bootstrap")
    expect(runbook).toContain("systemctl --user enable --now")
  })

  test("CLI launcher reuses an active model child instead of duplicating it", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    const root = operationPath(dir.path, "School")
    const launchDir = path.join(root, "scheduler", "cli-launches")
    await fs.mkdir(launchDir, { recursive: true })
    await fs.writeFile(
      path.join(launchDir, "2026-05-05T00-00-00-model-pid-district_profile.json"),
      JSON.stringify(
        {
          operationID: "school",
          kind: "model-pid",
          id: "district_profile",
          createdAt: "2026-05-05T00:00:00.000Z",
          pid: process.pid,
          jobID: "cli-model-lane-district_profile",
        },
        null,
        2,
      ) + "\n",
    )

    const proc = Bun.spawn(
      [
        "bun",
        "run",
        path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
        "School",
        "--duration-seconds",
        "120",
        "--interval-seconds",
        "0",
        "--max-cycles",
        "1",
        "--disable-operation-supervisor",
        "--json",
      ],
      {
        cwd: dir.path,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ULMCODE_DAEMON_DRY_RUN_LAUNCHES: "1" },
      },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exit).toBe(0)
    expect(stderr).toBe("")
    const result = JSON.parse(stdout)
    expect(result.cycles[0].launchedJobs).toEqual(["cli-model-lane-district_profile"])
    const records = await fs.readdir(launchDir)
    expect(records.filter((file) => file.includes("model-pid-district_profile"))).toHaveLength(1)
    expect(records.some((file) => file.includes("model-reuse-district_profile"))).toBe(true)
    expect(records.some((file) => file.includes("model-district_profile") && !file.includes("model-pid"))).toBe(false)
  })

  test("records scheduler errors, backs off, and stops after the error budget", async () => {
    await using dir = await tmpdir({ git: true })
    const sleeps: number[] = []

    const result = await runRuntimeDaemon(dir.path, {
      operationID: "MissingGraph",
      maxRuntimeSeconds: 120,
      cycleIntervalSeconds: 0,
      errorBackoffSeconds: 7,
      maxConsecutiveErrors: 2,
      maxCycles: 3,
      now: fakeClock("2026-05-05T00:00:00.000Z", 10),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
      },
    })

    expect(result.stopped).toBe(true)
    expect(result.reason).toContain("scheduler error")
    expect(sleeps).toEqual([7000])
    const log = await fs.readFile(result.logPath, "utf8")
    expect(log).toContain('"consecutiveErrors":1')
    expect(log).toContain('"consecutiveErrors":2')
  })
})
