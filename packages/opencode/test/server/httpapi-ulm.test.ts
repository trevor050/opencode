import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Server } from "../../src/server/server"
import { writeOperationCheckpoint } from "../../src/ulm/artifact"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI

function app() {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = true
  return Server.Default().app
}

async function expectStatus(response: Response, status: number) {
  if (response.status !== status) throw new Error(`Expected ${status}, got ${response.status}: ${await response.text()}`)
}

async function instanceWorktree(directory: string) {
  const response = await app().request("/path", { headers: { "x-opencode-directory": directory } })
  await expectStatus(response, 200)
  return ((await response.json()) as { worktree: string }).worktree
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

describe("ULM HttpApi", () => {
  test("serves operation dashboards through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const root = await instanceWorktree(tmp.path)
    await writeOperationCheckpoint(root, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
      riskLevel: "high",
      nextActions: ["Promote confirmed findings"],
    })
    await writeJson(path.join(root, ".ulmcode", "operations", "school", "goals", "operation-goal.json"), {
      operationID: "school",
      objective: "Authorized school assessment",
      targetDurationHours: 20,
      status: "active",
      updatedAt: "2026-05-05T10:05:00.000Z",
    })
    await writeJson(path.join(root, ".ulmcode", "operations", "school", "supervisor", "supervisor-review-1.json"), {
      generatedAt: "2026-05-05T10:06:00.000Z",
      decisions: [{ action: "blocked", reason: "operation plan is missing", requiredNextTool: "operation_plan" }],
    })
    await writeJson(path.join(root, ".ulmcode", "operations", "school", "tool-inventory", "tool-inventory.json"), {
      generatedAt: "2026-05-05T10:07:00.000Z",
      counts: { total: 20, installed: 12, missing: 8, highValueMissing: 2 },
      tools: [
        { id: "nmap", installed: true, highValue: true },
        { id: "httpx", installed: true, highValue: true },
        { id: "nuclei", installed: false, highValue: true },
        { id: "ffuf", installed: false, highValue: true },
      ],
    })

    const headers = { "x-opencode-directory": tmp.path }
    const listed = await app().request("/ulm/operation", { headers })
    await expectStatus(listed, 200)
    expect((await listed.json()) as unknown).toMatchObject([
      {
        operationID: "school",
        operation: { stage: "validation", status: "running", riskLevel: "high" },
        goal: { status: "active", targetDurationHours: 20 },
        supervisor: { action: "blocked", requiredNextTool: "operation_plan" },
        toolInventory: { installed: 12, total: 20, highValueMissing: 2 },
      },
    ])

    const status = await app().request("/ulm/operation/school/status", { headers })
    await expectStatus(status, 200)
    expect((await status.json()) as unknown).toMatchObject({
      operationID: "school",
      operation: { objective: "Authorized school assessment", stage: "validation" },
      policies: { foregroundCommand: expect.stringContaining("command_supervise") },
      supervisor: { blockers: ["operation plan is missing"] },
    })
  })

  test("serves operation resume and audit payloads through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const root = await instanceWorktree(tmp.path)
    await writeOperationCheckpoint(root, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
    })

    const headers = { "x-opencode-directory": tmp.path }
    const resume = await app().request("/ulm/operation/school/resume?staleAfterMinutes=1", { headers })
    await expectStatus(resume, 200)
    expect((await resume.json()) as unknown).toMatchObject({
      operationID: "school",
      recommendedTools: expect.arrayContaining(["operation_status"]),
    })

    const audit = await app().request("/ulm/operation/school/audit?finalHandoff=true", { headers })
    await expectStatus(audit, 200)
    expect((await audit.json()) as unknown).toMatchObject({
      operationID: "school",
      ok: false,
      recommendedTools: expect.arrayContaining(["operation_plan"]),
    })
  })

  test("starts an operation from a template through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const root = await instanceWorktree(tmp.path)

    const response = await app().request("/ulm/operation/template", {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "school-web",
        template: "single-url-web",
        objective: "Authorized school web assessment",
        targetDurationHours: 4,
        trustLevel: "guided",
        scanProfile: "balanced",
      }),
    })
    await expectStatus(response, 200)
    expect((await response.json()) as unknown).toMatchObject({
      operationID: "school-web",
      template: "single-url-web",
      files: {
        goal: expect.stringContaining("operation-goal.json"),
        plan: expect.stringContaining("operation-plan.json"),
        graph: expect.stringContaining("operation-graph.json"),
        outline: expect.stringContaining("report-outline.md"),
        memory: expect.stringContaining("memory.md"),
      },
    })
    expect(await fs.readFile(path.join(root, ".ulmcode", "operations", "school-web", "plans", "operation-plan.json"), "utf8")).toContain(
      "single-url-web",
    )
  })

  test("serves write audit, recovery, and daemon control metadata through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const root = await instanceWorktree(tmp.path)
    await writeOperationCheckpoint(root, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "validation",
      status: "running",
      summary: "Validation running.",
    })

    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const audit = await app().request("/ulm/operation/school/audit", {
      method: "POST",
      headers,
      body: JSON.stringify({ finalHandoff: true, minWords: 1000 }),
    })
    await expectStatus(audit, 200)
    const auditPayload = (await audit.json()) as { files: { json: string }; ok: boolean }
    expect(auditPayload.ok).toBe(false)
    expect(await fs.readFile(auditPayload.files.json, "utf8")).toContain("\"operationID\": \"school\"")

    const recover = await app().request("/ulm/operation/school/recover", {
      method: "POST",
      headers,
      body: JSON.stringify({ dryRun: true, maxTasks: 2 }),
    })
    await expectStatus(recover, 200)
    expect((await recover.json()) as unknown).toMatchObject({
      operationID: "school",
      action: "recover",
      mode: "planned",
      dryRun: true,
      command: expect.stringContaining("operation_recover operationID=school"),
    })

    const daemonStart = await app().request("/ulm/operation/school/daemon/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ maxRuntimeSeconds: 60, cycleIntervalSeconds: 1 }),
    })
    await expectStatus(daemonStart, 200)
    expect((await daemonStart.json()) as unknown).toMatchObject({
      operationID: "school",
      action: "start",
      mode: "planned",
      command: expect.stringContaining("ulm:runtime-daemon"),
      daemon: { running: false },
    })

    await writeJson(path.join(root, ".ulmcode", "operations", "school", "scheduler", "daemon-heartbeat.json"), {
      operationID: "school",
      pid: 123,
      updatedAt: "2026-05-07T10:00:00.000Z",
      stopped: false,
      reason: "running",
    })
    const daemonStatus = await app().request("/ulm/operation/school/daemon/status", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    await expectStatus(daemonStatus, 200)
    expect((await daemonStatus.json()) as unknown).toMatchObject({
      operationID: "school",
      action: "status",
      mode: "metadata",
      daemon: { running: true, pid: 123, updatedAt: "2026-05-07T10:00:00.000Z" },
    })

    const daemonStop = await app().request("/ulm/operation/school/daemon/stop", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    await expectStatus(daemonStop, 200)
    expect((await daemonStop.json()) as unknown).toMatchObject({
      operationID: "school",
      action: "stop",
      mode: "planned",
      command: expect.stringContaining("kill -TERM 123"),
    })
  })

  test("serves final artifact and open metadata through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const root = await instanceWorktree(tmp.path)
    await writeOperationCheckpoint(root, {
      operationID: "school",
      objective: "Authorized school assessment",
      stage: "handoff",
      status: "running",
      summary: "Handoff running.",
    })
    await fs.mkdir(path.join(root, ".ulmcode", "operations", "school", "deliverables", "final"), { recursive: true })
    await fs.writeFile(path.join(root, ".ulmcode", "operations", "school", "deliverables", "final", "report.html"), "<html>report</html>\n")
    await writeJson(path.join(root, ".ulmcode", "operations", "school", "deliverables", "final", "manifest.json"), {
      operationID: "school",
      artifacts: { html: "report.html" },
    })

    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const artifacts = await app().request("/ulm/operation/school/final-artifacts", { headers })
    await expectStatus(artifacts, 200)
    const artifactsPayload = (await artifacts.json()) as {
      operationID: string
      artifacts: Array<{ id: string; file: string; exists: boolean; kind: string }>
    }
    expect(artifactsPayload.operationID).toBe("school")
    expect(artifactsPayload.artifacts.find((artifact) => artifact.id === "report-html")).toMatchObject({
      file: "report.html",
      exists: true,
      kind: "html",
    })
    expect(artifactsPayload.artifacts.find((artifact) => artifact.id === "manifest-json")).toMatchObject({
      file: "manifest.json",
      exists: true,
      kind: "json",
    })

    const metadata = await app().request("/ulm/operation/school/final-artifacts/report-html", { headers })
    await expectStatus(metadata, 200)
    expect((await metadata.json()) as unknown).toMatchObject({
      operationID: "school",
      artifact: { id: "report-html", file: "report.html", exists: true, size: 20 },
    })

    const open = await app().request("/ulm/operation/school/final-artifacts/report-html/open", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    await expectStatus(open, 200)
    expect((await open.json()) as unknown).toMatchObject({
      operationID: "school",
      artifactID: "report-html",
      mode: "planned",
      command: expect.stringContaining("report.html"),
    })
  })

  test("serves credential vault submit flow through Hono bridge", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    await instanceWorktree(tmp.path)
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const created = await app().request("/ulm/operation/school/credentials", {
      method: "POST",
      headers,
      body: JSON.stringify({
        label: "Router admin",
        username: "admin",
        secret: "do-not-leak",
        target: "192.168.1.1",
      }),
    })
    await expectStatus(created, 200)
    expect(JSON.stringify(await created.json())).not.toContain("do-not-leak")

    const submitted = await app().request("/ulm/operation/school/credentials/submit", { method: "POST", headers })
    await expectStatus(submitted, 200)
    const body = (await submitted.json()) as { submittedAt: string; credentials: Array<{ credentialID: string }> }
    expect(body.submittedAt).toContain("T")
    expect(body.credentials[0]?.credentialID).toBe("router-admin")
    expect(JSON.stringify(body)).not.toContain("do-not-leak")
  })
})
