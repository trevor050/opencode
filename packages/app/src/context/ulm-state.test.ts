import { describe, expect, test } from "bun:test"
import {
  applyOperationUpdated,
  confidenceForOperation,
  operationListFromResponse,
  pendingApprovalCounts,
  sortOperations,
  type UlmApprovalSource,
} from "./ulm-state"
import type { UlmOperationStatusSummary } from "@opencode-ai/sdk/v2"

const summary = (input: Partial<UlmOperationStatusSummary> & { operationID: string }): UlmOperationStatusSummary => ({
  operationID: input.operationID,
  root: input.root ?? `/tmp/${input.operationID}`,
  operation: input.operation,
  goal: input.goal,
  supervisor: input.supervisor,
  toolInventory: input.toolInventory,
  policies: input.policies ?? { foregroundCommand: "Use command_supervise" },
  plans: input.plans ?? { operation: true },
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
  runtime: input.runtime,
  lastEvents: input.lastEvents ?? [],
})

describe("applyOperationUpdated", () => {
  test("patches an existing operation card from compact event payloads", () => {
    const next = applyOperationUpdated(
      [
        summary({
          operationID: "school",
          operation: {
            operationID: "school",
            objective: "District assessment",
            stage: "recon",
            status: "running",
            summary: "Recon running",
            nextActions: [],
            blockers: [],
            riskLevel: "medium",
            activeTasks: [],
            evidence: [],
            time: { created: "2026-05-01T00:00:00.000Z", updated: "2026-05-01T00:00:00.000Z" },
          },
        }),
      ],
      {
        id: "evt_1",
        type: "operation.updated",
        properties: {
          operationID: "school",
          artifact: "finding",
          operation: {
            stage: "validation",
            status: "blocked",
            riskLevel: "high",
            blockers: ["approval required"],
          },
          findings: { total: 3 },
          evidence: { total: 7 },
          runtimeSummary: true,
        },
      },
    )

    expect(next[0].operation?.stage).toBe("validation")
    expect(next[0].operation?.status).toBe("blocked")
    expect(next[0].operation?.riskLevel).toBe("high")
    expect(next[0].operation?.blockers).toEqual(["approval required"])
    expect(next[0].findings.total).toBe(3)
    expect(next[0].evidence.total).toBe(7)
    expect(next[0].runtimeSummary).toBe(true)
  })

  test("creates a lightweight card when an update arrives before list bootstrap", () => {
    const next = applyOperationUpdated([], {
      id: "evt_2",
      type: "operation.updated",
      properties: {
        operationID: "night-run",
        artifact: "checkpoint",
        operation: {
          objective: "Overnight run",
          stage: "recon",
          status: "running",
          riskLevel: "medium",
          summary: "Started",
        },
      },
    })

    expect(next).toHaveLength(1)
    expect(next[0].operationID).toBe("night-run")
    expect(next[0].operation?.objective).toBe("Overnight run")
  })
})

describe("operationListFromResponse", () => {
  test("accepts generated SDK array responses", () => {
    const list = [summary({ operationID: "alpha" })]
    expect(operationListFromResponse(list)).toBe(list)
  })

  test("turns unsupported text/html responses into a useful error", () => {
    expect(() => operationListFromResponse("<!doctype html><title>OpenCode</title>")).toThrow("<!doctype html>")
  })
})

describe("confidenceForOperation", () => {
  test("blocks walkaway when an operation has blockers or pending approvals", () => {
    expect(
      confidenceForOperation(
        summary({
          operationID: "school",
          operation: {
            operationID: "school",
            objective: "District assessment",
            stage: "validation",
            status: "blocked",
            summary: "Needs operator",
            nextActions: [],
            blockers: ["scope question"],
            riskLevel: "high",
            activeTasks: [],
            evidence: [],
            time: { created: "2026-05-01T00:00:00.000Z", updated: "2026-05-01T00:00:00.000Z" },
          },
        }),
        { questions: 1, permissions: 0 },
      ).level,
    ).toBe("blocked")
  })

  test("warns when runtime summary or plan is missing", () => {
    const result = confidenceForOperation(summary({ operationID: "school", plans: { operation: false } }), {
      questions: 0,
      permissions: 0,
    })

    expect(result.level).toBe("attention")
    expect(result.reasons).toEqual(expect.arrayContaining(["Operation plan is missing", "Runtime summary is missing"]))
  })

  test("allows walkaway for planned operations with runtime summary and no blockers", () => {
    expect(confidenceForOperation(summary({ operationID: "school", runtimeSummary: true }), { questions: 0, permissions: 0 }).level).toBe(
      "ready",
    )
  })
})

describe("pendingApprovalCounts", () => {
  test("counts questions and permissions by operation metadata when present", () => {
    const source: UlmApprovalSource = {
      sessions: [{ id: "ses_1", title: "Recon lane" }],
      questions: {
        ses_1: [{ id: "que_1", sessionID: "ses_1", questions: [], metadata: { operationID: "school" } }],
      },
      permissions: {
        ses_1: [{ id: "per_1", sessionID: "ses_1", permission: "bash", patterns: [], metadata: { operationID: "school" }, always: [] }],
      },
    }

    expect(pendingApprovalCounts(source, "school")).toEqual({ questions: 1, permissions: 1 })
  })
})

describe("sortOperations", () => {
  test("prioritizes blocked and running work before completed operations", () => {
    expect(
      sortOperations([
        summary({ operationID: "done", operation: { operationID: "done", objective: "", stage: "handoff", status: "complete", summary: "", nextActions: [], blockers: [], riskLevel: "low", activeTasks: [], evidence: [], time: { created: "2026-05-01T00:00:00.000Z", updated: "2026-05-01T00:00:00.000Z" } } }),
        summary({ operationID: "active", operation: { operationID: "active", objective: "", stage: "recon", status: "running", summary: "", nextActions: [], blockers: [], riskLevel: "medium", activeTasks: [], evidence: [], time: { created: "2026-05-01T00:00:00.000Z", updated: "2026-05-03T00:00:00.000Z" } } }),
        summary({ operationID: "blocked", operation: { operationID: "blocked", objective: "", stage: "validation", status: "blocked", summary: "", nextActions: [], blockers: ["needs approval"], riskLevel: "high", activeTasks: [], evidence: [], time: { created: "2026-05-01T00:00:00.000Z", updated: "2026-05-02T00:00:00.000Z" } } }),
      ]).map((item) => item.operationID),
    ).toEqual(["blocked", "active", "done"])
  })
})
