import { describe, expect, test } from "bun:test"
import type { UlmFinalArtifact, UlmOperationStatusSummary } from "@opencode-ai/sdk/v2"
import {
  artifactGroups,
  currentOperationFilesPath,
  operationChatPath,
  operationForSession,
  operationFilesPathForSession,
  operationStatusGroups,
  operationCounts,
  operationRootPath,
  reportPackageState,
} from "./ulm-operation-ui"

const summary = (input: Partial<UlmOperationStatusSummary> & { operationID: string }): UlmOperationStatusSummary => ({
  operationID: input.operationID,
  root: input.root ?? `/ops/${input.operationID}`,
  operation: input.operation,
  goal: input.goal,
  policies: input.policies ?? { foregroundCommand: "" },
  plans: input.plans ?? { operation: false },
  findings: input.findings ?? {
    total: 0,
    byState: { candidate: 0, needs_validation: 0, validated: 0, report_ready: 0, rejected: 0 },
    bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 },
  },
  evidence: input.evidence ?? {
    total: 0,
    byKind: { command_output: 0, http_response: 0, screenshot: 0, file: 0, note: 0, log: 0 },
  },
  reports: input.reports ?? { outline: false, markdown: false, html: false, pdf: false, readme: false, manifest: false },
  runtimeSummary: input.runtimeSummary ?? false,
  lastEvents: input.lastEvents ?? [],
  ...("sessions" in input ? { sessions: (input as any).sessions } : {}),
})

const artifact = (file: string, exists = true): UlmFinalArtifact => ({
  id: file.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
  file,
  kind: file.endsWith(".md") ? "markdown" : file.endsWith(".json") ? "json" : "text",
  exists,
  path: `/ops/demo/${file}`,
  fetchPath: `/fetch/${file}`,
  openPath: `/open/${file}`,
})

describe("ULM operation UI helpers", () => {
  test("counts running separately from merely open operations", () => {
    expect(
      operationCounts([
        summary({ operationID: "running", operation: { status: "running" } as any }),
        summary({ operationID: "planned", operation: { status: "planned" } as any }),
        summary({ operationID: "paused", operation: { status: "paused" } as any }),
        summary({ operationID: "complete", operation: { status: "complete" } as any }),
      ]),
    ).toEqual({ running: 1, open: 2, total: 4 })
  })

  test("opens the operation root unless final package files are requested", () => {
    const item = summary({ operationID: "demo", root: "/ops/demo" })

    expect(operationRootPath(item)).toBe("/ops/demo")
    expect(currentOperationFilesPath(item)).toBe("/ops/demo")
  })

  test("selects only the operation bound to the current chat session", () => {
    const running = summary({
      operationID: "global-running",
      operation: { status: "running" } as any,
      sessions: [{ sessionID: "other-chat", boundAt: "2026-05-09T12:00:00.000Z" }],
    } as any)
    const current = summary({
      operationID: "current-chat-op",
      operation: { status: "paused" } as any,
      sessions: [{ sessionID: "chat-1", boundAt: "2026-05-09T12:01:00.000Z" }],
    } as any)

    expect(operationForSession([running, current] as any, "chat-1")?.operationID).toBe("current-chat-op")
    expect(operationForSession([running] as any, "chat-1")).toBeUndefined()
  })

  test("targets current operation files when the chat is bound and falls back to all operation files otherwise", () => {
    const current = summary({
      operationID: "current-chat-op",
      root: "/ops/current-chat-op",
      sessions: [{ sessionID: "chat-1", boundAt: "2026-05-09T12:01:00.000Z" }],
    } as any)
    const other = summary({
      operationID: "other-chat-op",
      root: "/ops/other-chat-op",
      sessions: [{ sessionID: "other-chat", boundAt: "2026-05-09T12:00:00.000Z" }],
    } as any)

    expect(operationFilesPathForSession([other, current] as any, "chat-1", "/ops")).toBe("/ops/current-chat-op")
    expect(operationFilesPathForSession([other, current] as any, undefined, "/ops")).toBe("/ops")
    expect(operationFilesPathForSession([other, current] as any, "unbound-chat", "/ops")).toBe("/ops")
  })

  test("routes operation chat actions to the bound chat instead of the new-chat route", () => {
    const item = summary({
      operationID: "current-chat-op",
      sessions: [{ sessionID: "chat-1", boundAt: "2026-05-09T12:01:00.000Z" }],
    } as any)

    expect(operationChatPath("/abc", item as any)).toBe("/abc/session/chat-1")
    expect(operationChatPath("/abc", summary({ operationID: "unbound" }) as any)).toBe("/abc/session")
  })

  test("groups operations into active, paused, and completed lanes", () => {
    const groups = operationStatusGroups([
      summary({ operationID: "complete", operation: { status: "complete" } as any }),
      summary({ operationID: "paused", operation: { status: "paused" } as any }),
      summary({ operationID: "running", operation: { status: "running" } as any }),
      summary({ operationID: "blocked", operation: { status: "blocked" } as any }),
    ])

    expect(groups.active.map((item) => item.operationID)).toEqual(["running", "blocked"])
    expect(groups.paused.map((item) => item.operationID)).toEqual(["paused"])
    expect(groups.completed.map((item) => item.operationID)).toEqual(["complete"])
  })

  test("classifies report packages without calling partial packages ready", () => {
    expect(reportPackageState(summary({ operationID: "missing" }))).toBe("missing")
    expect(reportPackageState(summary({ operationID: "partial", reports: { outline: true } as any }))).toBe("partial")
    expect(
      reportPackageState(
        summary({
          operationID: "ready",
          reports: { outline: true, markdown: true, html: true, pdf: true, readme: false, manifest: true },
        }),
      ),
    ).toBe("ready")
  })

  test("groups operation artifacts for document browsing", () => {
    expect(
      artifactGroups([
        artifact("status.md"),
        artifact("plans/operation-plan.md"),
        artifact("evidence/raw/curl.txt"),
        artifact("deliverables/final/report.pdf"),
        artifact("events.jsonl", false),
      ]).map((group) => [group.label, group.items.map((item) => item.file)]),
    ).toEqual([
      ["Overview", ["status.md"]],
      ["Plans", ["plans/operation-plan.md"]],
      ["Evidence", ["evidence/raw/curl.txt"]],
      ["Reports", ["deliverables/final/report.pdf"]],
    ])
  })
})
