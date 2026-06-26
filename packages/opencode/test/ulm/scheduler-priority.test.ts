import { describe, expect, test } from "bun:test"
import { prioritizeSchedulerItems } from "@/ulm/scheduler-priority"

describe("ULM scheduler priority", () => {
  test("prioritizes finalization blockers over new discovery", () => {
    const result = prioritizeSchedulerItems({
      now: "2026-06-26T20:00:00.000Z",
      finalizationDue: true,
      items: [
        { id: "content-discovery", kind: "command", category: "extra_recon", coverageImpact: "medium" },
        { id: "report-render", kind: "lane", category: "finalization", coverageImpact: "blocks_release" },
      ],
    })

    expect(result[0]?.id).toBe("report-render")
    expect(result[0]?.priority.reason).toContain("protected finalization")
  })

  test("prioritizes critical capability blockers over low-value recon", () => {
    const result = prioritizeSchedulerItems({
      now: "2026-06-26T08:00:00.000Z",
      finalizationDue: false,
      items: [
        { id: "http-discovery", kind: "command", category: "extra_recon", coverageImpact: "low" },
        { id: "google-workspace-review", kind: "lane", category: "critical_capability", coverageImpact: "high" },
      ],
    })

    expect(result[0]?.id).toBe("google-workspace-review")
    expect(result[0]?.priority.reason).toContain("critical capability")
  })

  test("prioritizes validation debt over second-pass coverage", () => {
    const result = prioritizeSchedulerItems({
      now: "2026-06-26T10:00:00.000Z",
      finalizationDue: false,
      items: [
        { id: "planned-work-coverage", kind: "lane", category: "coverage_expansion", coverageImpact: "medium" },
        { id: "finding-validation", kind: "lane", category: "validation_debt", coverageImpact: "high" },
      ],
    })

    expect(result[0]?.id).toBe("finding-validation")
    expect(result[0]?.priority.reason).toContain("validation debt")
  })
})
