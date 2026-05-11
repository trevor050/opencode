import { describe, expect, test } from "bun:test"
import { buildULMToolView, isULMTool } from "./ulm-tool-view"

describe("ULM tool view model", () => {
  test("recognizes operation tools that should not fall back to generic raw calls", () => {
    expect(isULMTool("operation_goal")).toBe(true)
    expect(isULMTool("tool_inventory")).toBe(true)
    expect(isULMTool("laptop_preflight")).toBe(true)
    expect(isULMTool("runtime_daemon")).toBe(true)
    expect(isULMTool("read")).toBe(false)
  })

  test("formats operation goal output as an operator card", () => {
    const view = buildULMToolView({
      tool: "operation_goal",
      input: {
        operationID: "local-network-standard",
        objective: "Standard-duration internal network penetration test",
        targetDurationHours: 8,
      },
      output: [
        "operation_id: local-network-standard",
        "status: running",
        "stage: kickoff",
        "risk: medium",
        "json: /tmp/operation.json",
      ].join("\n"),
    })

    expect(view.title).toBe("Operation goal")
    expect(view.subtitle).toBe("local-network-standard")
    expect(view.rows).toContainEqual({ label: "Objective", value: "Standard-duration internal network penetration test" })
    expect(view.rows).toContainEqual({ label: "Stage", value: "kickoff" })
    expect(view.rows).toContainEqual({ label: "Status", value: "running" })
  })

  test("summarizes tool inventory without dumping every input arg", () => {
    const view = buildULMToolView({
      tool: "tool_inventory",
      input: { operationID: "local-network-standard", includeVersions: true, probeTimeoutMillis: 5000 },
      output: [
        "operation_id: local-network-standard",
        "installed: 6",
        "missing: SecLists",
        "markdown: /tmp/tool-inventory.md",
      ].join("\n"),
    })

    expect(view.title).toBe("Tool inventory")
    expect(view.rows).toContainEqual({ label: "Installed", value: "6" })
    expect(view.rows).toContainEqual({ label: "Missing", value: "SecLists" })
    expect(view.rows.some((row) => row.label === "Probe timeout millis")).toBe(false)
  })

  test("shows credential vault actions without exposing secrets", () => {
    const view = buildULMToolView({
      tool: "operation_credentials",
      input: { operationID: "local-network-standard", action: "open_vault", password: "do-not-render" },
      output: [
        "operation_id: local-network-standard",
        "opened: true",
        "vault_url: http://127.0.0.1:4096/ulm/credentials",
      ].join("\n"),
    })

    expect(view.title).toBe("Credential vault")
    expect(view.rows).toContainEqual({ label: "Opened", value: "true" })
    expect(view.rows).toContainEqual({ label: "Vault URL", value: "http://127.0.0.1:4096/ulm/credentials" })
    expect(JSON.stringify(view)).not.toContain("do-not-render")
  })

  test("summarizes laptop preflight blockers without raw json sludge", () => {
    const view = buildULMToolView({
      tool: "laptop_preflight",
      input: { operationID: "school", preparePrerequisites: true, operatorConfirmed: ["power", "wifi"] },
      output: [
        "# Laptop Preflight: school",
        "",
        "- status: blocked",
        "- target_hours: 48",
        "- gaps: 2",
        "- warnings: 0",
        "- json: /ops/school/scheduler/laptop-preflight.json",
        "<laptop_preflight_json>",
        JSON.stringify({
          operationID: "school",
          status: "blocked",
          targetHours: 48,
          gaps: ["operator-sleep: operator confirmation missing", "report-outline: report-outline.md is missing"],
          warnings: [],
          files: { json: "/ops/school/scheduler/laptop-preflight.json" },
        }),
        "</laptop_preflight_json>",
      ].join("\n"),
    })

    expect(view.title).toBe("Laptop preflight")
    expect(view.subtitle).toBe("school")
    expect(view.rows).toContainEqual({ label: "Status", value: "blocked" })
    expect(view.rows).toContainEqual({ label: "Target hours", value: "48" })
    expect(view.sections.find((section) => section.title === "Launch blockers")?.rows[0]?.value).toContain("operator-sleep")
  })
})
