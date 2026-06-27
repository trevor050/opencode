import { describe, expect, test } from "bun:test"
import { browserWorkflowManifests, getBrowserWorkflow } from "@/ulm/browser-workflows"

describe("ULM authenticated browser workflows", () => {
  test("registers the required identity and SaaS browser workflows", () => {
    const ids = browserWorkflowManifests().map((workflow) => workflow.id)

    expect(ids).toEqual([
      "sis-role-export-review",
      "google-admin-mfa-sharing-review",
      "microsoft-entra-role-mfa-review",
      "mdm-admin-device-review",
    ])
  })

  test("workflow manifests define objectives, proof, and raw-data prohibitions", () => {
    const sis = getBrowserWorkflow("sis-role-export-review")

    expect(sis?.serviceType).toBe("sis")
    expect(sis?.loginAssumption).toContain("operator")
    expect(sis?.steps.length).toBeGreaterThanOrEqual(4)
    expect(sis?.requiredScreenshots).toContain("role-or-permission-summary")
    expect(sis?.prohibitedRawData).toContain("student records")
    expect(sis?.expectedEvidenceArtifacts).toContain("browser/session-log.jsonl")
  })
})
