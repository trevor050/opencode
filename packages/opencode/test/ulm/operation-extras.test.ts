import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import {
  createOperationFromTemplate,
  normalizeToolOutput,
  updateOperationMemory,
  writeAssetGraph,
  writeAttackChain,
  writeBrowserEvidence,
  writeOperationAlert,
} from "@/ulm/operation-extras"
import { operationPath, operationPlanRequiresCredentialHandoff, writeCoverageContract } from "@/ulm/artifact"
import { auditLaptopPreflight } from "@/ulm/laptop-preflight"
import { runRuntimeDaemon } from "@/ulm/runtime-daemon"
import { writeRuntimeSupervisor } from "@/ulm/runtime-supervisor"
import { tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")
const testConfigDir = path.join(packageRoot, ".artifacts", "operation-extras-test-config")
const profileConfigPath = path.resolve(packageRoot, "../../tools/ulmcode-profile/opencode.json")

await fs.mkdir(testConfigDir, { recursive: true })
await fs.copyFile(profileConfigPath, path.join(testConfigDir, "opencode.json"))
await fs.copyFile(profileConfigPath, path.join(testConfigDir, "ulmcode.json"))

const testLaunchEnv: NodeJS.ProcessEnv = {
  OPENCODE_APP_NAME: "ulmcode",
  OPENCODE_CONFIG_DIR: testConfigDir,
  OPENCODE_CONFIG: path.join(testConfigDir, "opencode.json"),
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n")
}

async function completeOperationGraph(worktree: string, operationID: string, graphPath: string) {
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8")) as {
    lanes: Array<{ id: string; status: string }>
  }
  for (const lane of graph.lanes) {
    lane.status = "complete"
  }
  await fs.writeFile(graphPath, JSON.stringify(graph, null, 2) + "\n")
  await writeCoverageContract(worktree, {
    operationID,
    status: "released",
    goals: ["Synthetic first-real-test integration smoke completed all lanes."],
    minimumEvidence: ["laptop preflight artifact", "operation graph completion"],
    requiredLanes: graph.lanes.map((lane) => lane.id),
    allowedSkippedLanes: [],
    fallbackRules: ["No fallback required for the local integration fixture."],
    retryRules: ["No retry required for the local integration fixture."],
    subagentOpportunities: ["report writing", "validation"],
    reportGates: ["laptop_preflight", "runtime_daemon"],
  })
}

describe("ULM operation extras", () => {
  test("writes operation-local memory", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await updateOperationMemory(dir.path, {
      operationID: "School",
      action: "append",
      section: "Scope",
      note: "Do not touch out-of-scope hosts after compaction.",
    })

    expect(result.operationID).toBe("school")
    expect(result.file).toEndWith("memory.md")
    expect(await fs.readFile(result.file, "utf8")).toContain("Do not touch out-of-scope hosts")
  })

  test("rejects raw credential secrets in operation-local memory notes", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      updateOperationMemory(dir.path, {
        operationID: "School",
        action: "append",
        section: "Credentials",
        note: "Genesis admin password: Summer2026!",
      }),
    ).rejects.toThrow("operation memory notes must not contain raw credential secrets")
  })

  test("writes graph, chain, browser evidence, alert, and normalized output artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeAssetGraph(dir.path, {
      operationID: "School",
      nodes: [{ id: "app", kind: "route", label: "/login" }],
      edges: [{ from: "app", to: "finding-1", relationship: "supports", confidence: "medium" }],
    })
    const chain = await writeAttackChain(dir.path, {
      operationID: "School",
      title: "Weak login chain",
      summary: "A browser-observed login issue leads to exposed data.",
      steps: [{ title: "Reach login", assetID: "app" }],
    })
    const browser = await writeBrowserEvidence(dir.path, {
      operationID: "School",
      title: "Login page state",
      url: "https://example.test/login",
      authState: "unauthenticated",
      summary: "Login page rendered.",
    })
    const alert = await writeOperationAlert(dir.path, {
      operationID: "School",
      kind: "blocked",
      title: "Manual auth needed",
      message: "Authenticated review is blocked until credentials are provided.",
      sinks: ["console", "slack"],
    })
    const normalized = await normalizeToolOutput(dir.path, {
      operationID: "School",
      tool: "nmap",
      content: "80/tcp open http\nhttps://example.test/login\n",
    })

    expect(graph.nodes).toBe(1)
    expect(graph.edges).toBe(1)
    expect(chain.steps).toBe(1)
    expect(browser.evidenceID).toBe("login-page-state")
    expect(alert.sinks).toBe(2)
    expect(normalized.counts.ports).toBe(1)
    expect(normalized.counts.urls).toBe(1)
  })

  test("rejects raw credential secrets in operation graph and recon helper artifacts", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      writeAssetGraph(dir.path, {
        operationID: "School",
        nodes: [{ id: "app", kind: "route", label: "/login", notes: "password: Summer2026!" }],
      }),
    ).rejects.toThrow("asset graph records must not contain raw credential secrets")

    await expect(
      writeAttackChain(dir.path, {
        operationID: "School",
        title: "Weak login chain",
        summary: "Used genesis token: raw-token-123",
        steps: [{ title: "Reach login" }],
      }),
    ).rejects.toThrow("attack chain records must not contain raw credential secrets")

    await expect(
      writeBrowserEvidence(dir.path, {
        operationID: "School",
        title: "Login page state",
        url: "https://example.test/login",
        summary: "Observed login with password: Summer2026!",
      }),
    ).rejects.toThrow("browser evidence records must not contain raw credential secrets")

    await expect(
      writeOperationAlert(dir.path, {
        operationID: "School",
        kind: "blocked",
        title: "Manual auth needed",
        message: "Operator pasted password: Summer2026!",
      }),
    ).rejects.toThrow("operation alerts must not contain raw credential secrets")
  })

  test("rejects destructive exploit execution claims in attack chain artifacts", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      writeAttackChain(dir.path, {
        operationID: "School",
        title: "Unsafe SIS chain",
        summary: "Ran the exploit against production and changed grades to demonstrate impact.",
        steps: [
          { title: "RCE to SIS admin", notes: "Exported bulk roster student records for proof." },
          { title: "Persistence", notes: "Added a new admin user for persistence." },
        ],
      }),
    ).rejects.toThrow("attack chain records must not contain destructive exploit execution claims")
  })

  test("attack chain tool preserves domain error messages", async () => {
    const source = await Bun.file(path.join(__dirname, "../../src/tool/attack_chain.ts")).text()

    expect(source).toContain("catch: (error) => new Error(error instanceof Error ? error.message : String(error))")
    expect(source).not.toContain("Effect.tryPromise(() => writeAttackChain")
  })

  test("allows non-destructive attack chain stop-condition language", async () => {
    await using dir = await tmpdir({ git: true })

    const chain = await writeAttackChain(dir.path, {
      operationID: "School",
      title: "Safe SIS chain",
      summary: "Maps RCE to SIS export scope using non-destructive validation.",
      steps: [
        {
          title: "RCE to SIS admin",
          notes: "Stop condition: do not dump student records, change grades, persist access, or execute destructive payloads.",
        },
      ],
      blockers: ["No destructive validation performed."],
    })

    expect(chain.steps).toBe(1)
  })

  test("allows negated attack-chain boundary language from live probes", async () => {
    await using dir = await tmpdir({ git: true })

    const chain = await writeAttackChain(dir.path, {
      operationID: "School",
      title: "Synthetic governance chain",
      summary: "Synthetic evidence describes governance risk, not production compromise.",
      steps: [{ title: "Review role concentration", notes: "Actual delegated scope requires authorized validation." }],
      blockers: [
        "No credentials, secrets, student records, exploit execution, persistence, disruptive action, or production changes were used.",
      ],
    })

    expect(chain.steps).toBe(1)
  })

  test("rejects raw credential secrets in normalized tool output artifacts", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      normalizeToolOutput(dir.path, {
        operationID: "School",
        tool: "generic",
        title: "Portal login response",
        content: "200 OK\nSet-Cookie: session=raw-cookie-123\npassword: Summer2026!\n",
      }),
    ).rejects.toThrow("normalized tool output must not contain raw credential secrets")
  })

  test("rejects raw credential secrets in runtime supervisor manifests", async () => {
    await using dir = await tmpdir({ git: true })

    await expect(
      writeRuntimeSupervisor({
        operationID: "School",
        worktree: dir.path,
        bunPath: "bun",
        scriptPath: "script/ulm-runtime-daemon.ts?token=raw-token-123",
        durationSeconds: 120,
        intervalSeconds: 30,
        schedulerCyclesPerTick: 1,
        supervisor: "launchd",
      }),
    ).rejects.toThrow("runtime supervisor manifests must not contain raw credential secrets")
  })

  test("creates an operation from a template", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await createOperationFromTemplate(dir.path, {
      template: "single-url-web",
      objective: "Authorized single URL review",
      targetDurationHours: 20,
      trustLevel: "unattended",
      scanProfile: "balanced",
      budgetUSD: 10,
    })

    expect(result.operationID).toMatch(/^[a-z]+-[a-z]+(-[a-z]+)?-[a-f0-9]{6}$/)
    const plan = JSON.parse(await fs.readFile(result.plan.json, "utf8"))
    expect(plan.templateName).toBe("single-url-web")
    expect(plan.timeBudget.targetHours).toBe(20)
    expect(plan.timeBudget.durationFit.confidence).toBe("duration_sized")
    expect(plan.coverageContract.requiredLanes).toContain("recon")
    expect(await fs.readFile(result.graph.json, "utf8")).toContain('"trustLevel": "unattended"')
    expect(await fs.readFile(result.outline.file, "utf8")).toContain("Coverage, Browser Evidence, and Testing Limits")
    expect(await fs.readFile(result.memory, "utf8")).toContain("Started from single-url-web")
  })

  test("creates short report-only templates with report-only coverage lanes", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await createOperationFromTemplate(dir.path, {
      template: "report-only",
      objective: "Focused report repair drill",
      targetDurationHours: 1,
      trustLevel: "guided",
      scanProfile: "paranoid",
    })

    const plan = JSON.parse(await fs.readFile(result.plan.json, "utf8"))
    const graph = JSON.parse(await fs.readFile(result.graph.json, "utf8"))
    const outline = await fs.readFile(result.outline.file, "utf8")

    expect(plan.templateName).toBe("report-only")
    expect(plan.coverageContract.requiredLanes).not.toContain("recon")
    expect(plan.coverageContract.requiredLanes).not.toContain("web_inventory")
    expect(plan.coverageContract.requiredLanes).toContain("report_writing")
    expect(graph.lanes.map((lane: { id: string }) => lane.id)).not.toContain("recon")
    expect(outline).toContain("target_pages: 12")
  })

  test("uses report-only coverage lanes for longer report-only templates", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await createOperationFromTemplate(dir.path, {
      template: "report-only",
      objective: "Long report handoff",
      targetDurationHours: 3,
    })

    const plan = JSON.parse(await fs.readFile(result.plan.json, "utf8"))

    expect(plan.coverageContract.requiredLanes).not.toContain("recon")
    expect(plan.coverageContract.requiredLanes).not.toContain("web_inventory")
    expect(plan.coverageContract.requiredLanes).toContain("report_writing")
    expect(plan.discoveryCharter.operatorQuestions.join("\n")).toContain("credentialed testing is not required")
    expect(operationPlanRequiresCredentialHandoff(plan)).toBe(false)
  })

  test("creates a first-real-test school laptop template with 48h/report defaults", async () => {
    await using dir = await tmpdir({ git: true })
    const result = await createOperationFromTemplate(dir.path, {
      template: "school-laptop-48h",
      objective: "Authorized private Wi-Fi school assessment with Genesis and Google auth",
      budgetUSD: 20,
    })

    const goal = JSON.parse(await fs.readFile(result.goal.files.json, "utf8"))
    const plan = JSON.parse(await fs.readFile(result.plan.json, "utf8"))
    const graph = JSON.parse(await fs.readFile(result.graph.json, "utf8"))
    const outline = await fs.readFile(result.outline.file, "utf8")
    const memory = await fs.readFile(result.memory, "utf8")

    expect(goal.targetDurationHours).toBe(48)
    expect(plan.templateName).toBe("school-laptop-48h")
    expect(plan.trustLevel).toBe("unattended")
    expect(plan.scanProfile).toBe("aggressive")
    expect(plan.credentialTargets).toEqual(["genesis", "google"])
    expect(plan.scopeRules).toContain(
      "Person and account research must stay limited to role, authorization, identity, and workflow risk; exclude private-life dossier material.",
    )
    expect(plan.timeBudget.targetHours).toBe(48)
    expect(plan.reportingCloseout).toContain("Run laptop_preflight before starting runtime_daemon or supervisor handoff.")
    expect(graph.lanes.some((lane: { id?: string }) => lane.id === "supervisor")).toBe(true)
    expect(outline).toContain("target_pages: 75")
    expect(memory).toContain("Surface/private Wi-Fi first-real-test defaults")
  })

  test("school laptop template can prepare preflight proof but still blocks daemon launch until first-run readiness", async () => {
    await using dir = await tmpdir({ git: true })
    const operation = await createOperationFromTemplate(dir.path, {
      operationID: "First Real School Laptop",
      template: "school-laptop-48h",
      objective: "Authorized private Wi-Fi school assessment",
      budgetUSD: 20,
    })
    const root = operationPath(dir.path, operation.operationID)
    const goal = JSON.parse(await fs.readFile(operation.goal.files.json, "utf8"))
    goal.createdAt = "2026-05-01T00:00:00.000Z"
    await fs.writeFile(operation.goal.files.json, JSON.stringify(goal, null, 2) + "\n")
    await writeRuntimeSupervisor({
      operationID: operation.operationID,
      worktree: dir.path,
      bunPath: "bun",
      scriptPath: path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
      durationSeconds: 48 * 60 * 60,
      intervalSeconds: 60,
      schedulerCyclesPerTick: 1,
      launchReadinessCommand: `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id ${operation.operationID} --require-launch-ready --json`,
      supervisor: "all",
    })
    await writeJson(path.join(root, "credentials", "review-submission.json"), {
      operationID: operation.operationID,
      submittedAt: "2026-05-03T23:55:00.000Z",
      credentials: [
        { id: "genesis-test", label: "Genesis SIS test account" },
        { id: "google-workspace-test", label: "Google Workspace test account" },
      ],
    })
    const toolManifestPath = path.join(dir.path, "tool-manifest.json")
    await writeJson(toolManifestPath, {
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

    const preflight = await auditLaptopPreflight(dir.path, {
      operationID: operation.operationID,
      preparePrerequisites: true,
      toolManifestPath,
      modelRouteLaunchEnv: testLaunchEnv,
      operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
    })
    await completeOperationGraph(dir.path, operation.operationID, operation.graph.json)

    const daemon = await runRuntimeDaemon(dir.path, {
      operationID: operation.operationID,
      maxRuntimeSeconds: 48 * 60 * 60,
      cycleIntervalSeconds: 0,
      maxCycles: 1,
      supervisorEnabled: false,
      modelRouteLaunchEnv: testLaunchEnv,
      now: () => new Date("2026-05-04T00:00:00.000Z"),
    })

    expect(preflight.status).toBe("ready")
    expect(preflight.files.json).toBe(path.join(root, "scheduler", "laptop-preflight.json"))
    expect(daemon.reason).toContain("first-run launch readiness blocked")
    expect(daemon.reason).toContain("submit-credential-vault")
    expect(daemon.reason).not.toContain("laptop preflight blocked")
    expect(daemon.cycles).toHaveLength(0)
  })
})
