import { describe, expect, test } from "bun:test"
import type { UlmFinalArtifact, UlmOperationStatusSummary } from "@opencode-ai/sdk/v2"
import {
  artifactGroups,
  currentOperationFilesPath,
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
        summary({ operationID: "complete", operation: { status: "complete" } as any }),
      ]),
    ).toEqual({ running: 1, open: 2, total: 3 })
  })

  test("opens the operation root unless final package files are requested", () => {
    const item = summary({ operationID: "demo", root: "/ops/demo" })

    expect(operationRootPath(item)).toBe("/ops/demo")
    expect(currentOperationFilesPath(item)).toBe("/ops/demo")
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
