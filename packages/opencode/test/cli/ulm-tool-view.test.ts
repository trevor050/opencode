import { describe, expect, test } from "bun:test"
import { buildULMToolView } from "@/cli/cmd/tui/routes/session/ulm-tool-view"

describe("ulm tool view model", () => {
  test("formats discovery charter approval output with a plan preview", () => {
    const view = buildULMToolView({
      tool: "operation_plan",
      input: { planningMode: "discovery-charter" },
      output: [
        "operation_id: local-network-pentest-20260508",
        "plan_kind: discovery_charter",
        "planning_mode: discovery-charter",
        "planning_approval: pending",
        "markdown: /tmp/.ulmcode/operations/local-network-pentest-20260508/plans/discovery-charter.md",
        "next_step: ask_operator_to_approve_discovery_charter",
        "",
        "plan_preview:",
        "```markdown",
        "# Discovery Charter",
        "Purpose: bounded recon before full plan.",
        "```",
      ].join("\n"),
    })

    expect(view.title).toBe("# Discovery Charter")
    expect(view.rows).toContainEqual({ label: "Operation", value: "local-network-pentest-20260508" })
    expect(view.rows).toContainEqual({ label: "Approval", value: "pending" })
    expect(view.rows).toContainEqual({ label: "Next", value: "ask_operator_to_approve_discovery_charter" })
    expect(view.preview).toEqual(["# Discovery Charter", "Purpose: bounded recon before full plan."])
  })

  test("formats supervised command input and output without generic noise", () => {
    const view = buildULMToolView({
      tool: "command_supervise",
      input: {
        profileID: "icmp-sweep",
        variables: { target: "172.16.224.0/20" },
        dryRun: true,
      },
      output: [
        "operation_id: local-network-pentest-20260508",
        "profile_id: icmp-sweep",
        "tool: nmap",
        "dry_run: true",
        "plan: /tmp/plan.json",
      ].join("\n"),
    })

    expect(view.title).toBe("# Supervised Command")
    expect(view.rows).toContainEqual({ label: "Profile", value: "icmp-sweep" })
    expect(view.rows).toContainEqual({ label: "Tool", value: "nmap" })
    expect(view.rows).toContainEqual({ label: "Target", value: "172.16.224.0/20" })
    expect(view.rows).toContainEqual({ label: "Dry run", value: "true" })
  })

  test("formats final handoff tools with deliverable paths", () => {
    const view = buildULMToolView({
      tool: "report_render",
      output: [
        "operation_id: local-network-pentest-20260508",
        "html: /tmp/report.html",
        "pdf: /tmp/report.pdf",
        "manifest: /tmp/manifest.json",
      ].join("\n"),
    })

    expect(view.title).toBe("# Report Render")
    expect(view.rows).toContainEqual({ label: "HTML", value: "/tmp/report.html" })
    expect(view.rows).toContainEqual({ label: "PDF", value: "/tmp/report.pdf" })
    expect(view.rows).toContainEqual({ label: "Manifest", value: "/tmp/manifest.json" })
  })

  test("formats credential tool status without exposing raw output", () => {
    const view = buildULMToolView({
      tool: "operation_credentials",
      input: { action: "review_status" },
      metadata: { credentials: [{ credentialID: "router-admin" }, { credentialID: "wifi-info" }] },
      output: [
        "operation_id: local-network-pentest-20260508",
        "submitted: true",
        "submitted_at: 2026-05-08T14:00:00.000Z",
        "saved_credentials: 2",
        "review_file: /tmp/review.json",
      ].join("\n"),
    })

    expect(view.title).toBe("# Credential Review")
    expect(view.rows).toContainEqual({ label: "Submitted", value: "true" })
    expect(view.rows).toContainEqual({ label: "Saved credentials", value: "2" })
    expect(view.rows).toContainEqual({ label: "Review file", value: "/tmp/review.json" })
  })

  test("does not render an empty card while an operation tool is still running", () => {
    const view = buildULMToolView({
      tool: "operation_status",
      input: { operationID: "local-network-pentest-20260508" },
    })

    expect(view.title).toBe("# Operation Status")
    expect(view.rows).toContainEqual({ label: "Operation", value: "local-network-pentest-20260508" })
    expect(view.rows).toContainEqual({ label: "State", value: "waiting for tool output" })
  })

  test("extracts useful resume state from tagged JSON instead of showing only file paths", () => {
    const view = buildULMToolView({
      tool: "operation_resume",
      output: [
        "# Resume local-network-pentest-20260508",
        "health: attention_required",
        "",
        "<operation_resume_json>",
        JSON.stringify({
          operationID: "local-network-pentest-20260508",
          checkpoint: {
            stage: "recon",
            status: "running",
            summary: "Discovery Charter approved; bounded recon is next.",
            nextActions: ["Launch supervised discovery", "Write full plan"],
            blockers: ["operation plan is missing"],
          },
          health: { status: "attention_required", gaps: ["operation plan is missing", "runtime summary is missing"] },
          artifacts: { findings: 0, evidence: 1, reports: { html: false, pdf: false }, runtimeSummary: false },
          recommendedTools: ["operation_status", "operation_plan"],
        }),
        "</operation_resume_json>",
      ].join("\n"),
    })

    expect(view.rows).toContainEqual({ label: "Stage", value: "recon/running" })
    expect(view.rows).toContainEqual({ label: "Health", value: "attention_required" })
    expect(view.rows).toContainEqual({ label: "Summary", value: "Discovery Charter approved; bounded recon is next." })
    expect(view.sections).toContainEqual({
      title: "Next actions",
      rows: [
        { label: "1", value: "Launch supervised discovery" },
        { label: "2", value: "Write full plan" },
      ],
    })
    expect(view.sections).toContainEqual({
      title: "Blockers",
      rows: [{ label: "1", value: "operation plan is missing" }],
    })
  })

  test("shows supervisor decisions as first-class rows", () => {
    const view = buildULMToolView({
      tool: "operation_supervise",
      output: [
        "operation_id: local-network-pentest-20260508",
        "<operation_supervise_json>",
        JSON.stringify({
          decisions: [
            {
              action: "continue_coverage",
              reason: "coverage contract is not release-ready",
              requiredNextTool: "operation_run",
            },
          ],
        }),
        "</operation_supervise_json>",
      ].join("\n"),
    })

    expect(view.sections).toContainEqual({
      title: "Supervisor decisions",
      rows: [{ label: "continue_coverage", value: "operation_run - coverage contract is not release-ready" }],
    })
  })

  test("summarizes operation status counts from tagged JSON", () => {
    const view = buildULMToolView({
      tool: "operation_status",
      output: [
        "<operation_status_json>",
        JSON.stringify({
          operationID: "district-run",
          operation: {
            stage: "validation",
            status: "running",
            summary: "Safe validation is in progress.",
            nextActions: ["Validate HTTP exposure", "Normalize evidence"],
            blockers: ["report render missing"],
          },
          findings: { total: 3 },
          evidence: { total: 8 },
          reports: { outline: true, html: true, pdf: false },
          runtimeSummary: true,
        }),
        "</operation_status_json>",
      ].join("\n"),
    })

    expect(view.rows).toContainEqual({ label: "Operation", value: "district-run" })
    expect(view.rows).toContainEqual({ label: "Stage", value: "validation/running" })
    expect(view.rows).toContainEqual({ label: "Findings", value: "3" })
    expect(view.rows).toContainEqual({ label: "Evidence", value: "8" })
    expect(view.rows).toContainEqual({ label: "Reports", value: "outline, html" })
    expect(view.rows).toContainEqual({ label: "Runtime", value: "summary recorded" })
    expect(view.sections).toContainEqual({
      title: "Next actions",
      rows: [
        { label: "1", value: "Validate HTTP exposure" },
        { label: "2", value: "Normalize evidence" },
      ],
    })
  })
})
