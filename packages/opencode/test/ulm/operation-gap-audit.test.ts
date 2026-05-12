import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { operationPath, writeCoverageContract, writeEvidence, writeFinding, writeRuntimeSummary } from "@/ulm/artifact"
import { auditOperationGaps } from "@/ulm/operation-gap-audit"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { generateOperationBacklog } from "@/ulm/operation-backlog"
import { tmpdir } from "../fixture/fixture"

describe("ULM operation gap audit", () => {
  test("produces machine-readable gaps and progress pressure from operation artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes = parsed.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
    await writeCoverageContract(dir.path, {
      operationID: "School",
      status: "unmet",
      goals: ["Validate role boundaries."],
      minimumEvidence: ["Evidence for each authorization boundary."],
      requiredLanes: ["recon", "web_inventory", "finding_validation", "report_review"],
      allowedSkippedLanes: [],
      fallbackRules: ["Run second-pass validation."],
      retryRules: ["Retry transient failures once."],
      subagentOpportunities: ["validator"],
      reportGates: ["operation_audit finalHandoff=true"],
    })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await writeEvidence(dir.path, {
      operationID: "School",
      title: "SIS role boundary observation",
      kind: "note",
      summary: "Teacher role could reach a roster export candidate.",
    })
    await writeFinding(dir.path, {
      operationID: "School",
      title: "Roster export authorization boundary needs validation",
      state: "candidate",
      severity: "high",
      confidence: 0.55,
      affectedAssets: ["sis.example.test"],
      evidence: [{ id: "sis-role-boundary-observation" }],
      description: "The candidate needs safe validation or rejection.",
    })
    await writeFinding(dir.path, {
      operationID: "School",
      title: "Validated stale third-party roster portal",
      state: "validated",
      severity: "medium",
      confidence: 0.8,
      affectedAssets: ["portal.example.test"],
      evidence: [{ id: "sis-role-boundary-observation" }],
      description: "A validated reportable issue needs attack-path modeling.",
      impact: "A stale roster portal increases exposure if combined with weak access review.",
      remediation: "Disable the stale portal and review SSO group assignments.",
    })

    const result = await auditOperationGaps(dir.path, {
      operationID: "School",
      runtimeRemainingSeconds: 7 * 60 * 60,
      now: "2026-05-05T00:30:00.000Z",
    })

    expect(result.releaseReady).toBe(false)
    expect(result.coverage.status).toBe("unmet")
    expect(result.gaps.map((gap) => gap.id)).toContain("coverage-contract-not-release-ready")
    expect(result.gaps.map((gap) => gap.id)).toContain("candidate-findings-need-validation")
    expect(result.gaps.map((gap) => gap.id)).toContain("identity-auth-graph-missing")
    expect(result.gaps.map((gap) => gap.id)).toContain("attack-chain-missing-for-reportable-findings")
    expect(result.nextWorkUnitSeeds.map((seed) => seed.kind)).toContain("credentialed-role-check")
    expect(result.progress.queueDepth).toBe(0)
    expect(result.progress.coverageGapCount).toBe(result.gaps.length)
    expect(result.coverageConfidence.map((item) => item.category)).toContain("identity_auth")
    expect(result.coverageConfidence.find((item) => item.category === "identity_auth")?.confidence).toBeLessThan(1)
    expect(result.coverageConfidence.find((item) => item.category === "vulnerability_validation")?.validation).toBeGreaterThan(0)
    expect(result.worldModel.assets.map((asset) => asset.id)).toContain("sis.example.test")
    expect(result.worldModel.findings.map((finding) => finding.id)).toContain("roster-export-authorization-boundary-needs-validation")
    expect(result.worldModel.hypotheses.map((hypothesis) => hypothesis.id)).toContain("roster-export-authorization-boundary-needs-validation")
    expect(result.worldModel.negativeSpace.map((gap) => gap.id)).toContain("coverage-contract-not-release-ready")
    expect(result.files.json).toEndWith("gap-audit.json")
  })

  test("backlog generation persists the latest gap audit before adding expansion work", async () => {
    await using dir = await tmpdir({ git: true })
    const graph = await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    const parsed = JSON.parse(await fs.readFile(graph.json, "utf8"))
    parsed.lanes = parsed.lanes.map((lane: { status: string }) => ({ ...lane, status: "complete", terminalState: "complete" }))
    await fs.writeFile(graph.json, JSON.stringify(parsed, null, 2) + "\n")
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })

    const result = await generateOperationBacklog(dir.path, { operationID: "School" })
    const root = operationPath(dir.path, "School")
    const audit = JSON.parse(await fs.readFile(path.join(root, "plans", "gap-audit.json"), "utf8"))

    expect(result.gapAuditPath).toBe(path.join(root, "plans", "gap-audit.json"))
    expect(audit.gaps.some((gap: { id: string }) => gap.id === "coverage-contract-not-release-ready")).toBe(true)
    expect(result.generatedLanes).toEqual(["planned_work_expansion_1"])
  })
})
