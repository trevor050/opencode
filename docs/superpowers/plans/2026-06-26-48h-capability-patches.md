# 48-Hour Capability Patches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ULMCode capable of completing the weakest legs of a 48-hour district pentest by turning capability gaps into explicit runtime state, then adding the first high-impact tools/evals around authenticated browser work, SaaS/identity review, evidence quality, and scheduler prioritization.

**Architecture:** Add a capability-gap registry that maps each operation leg to required abilities, current support, gap severity, and recommended next tools. Feed that registry into gap audit, backlog generation, and final readiness so a 48-hour run can say "I cannot complete this leg effectively" instead of silently hand-waving. Then implement the first concrete abilities as small, testable modules: authenticated browser workflow manifests, SaaS export parsers, evidence scoring, graph ingestion, and scheduler prioritization.

**Tech Stack:** Bun tests, TypeScript under `packages/opencode/src/ulm`, existing ULM operation tools, profile docs under `tools/ulmcode-profile/docs`, optional future MCP/custom plugins wired through `tools/ulmcode-profile/opencode.json`.

---

## File Structure

- Create `packages/opencode/src/ulm/capability-registry.ts`
  - Owns the canonical list of 48-hour operation legs, required capabilities, current support, severity, failure mode, and recommended patch type.
- Create `packages/opencode/test/ulm/capability-registry.test.ts`
  - Prevents the matrix from drifting away from the profile doc and required critical legs.
- Modify `packages/opencode/src/ulm/operation-gap-audit.ts`
  - Adds capability gaps to the deterministic gap audit.
- Modify `packages/opencode/src/ulm/operation-backlog.ts`
  - Uses capability gaps to create useful backlog lanes instead of generic expansion work.
- Create `packages/opencode/src/ulm/evidence-quality.ts`
  - Scores evidence path health, finding refs, stale screenshots, redaction hazards, and unsupported claims.
- Create `packages/opencode/test/ulm/evidence-quality.test.ts`
  - Tests evidence-quality scoring against synthetic operation artifacts.
- Create `packages/opencode/src/ulm/auth-browser-workflow.ts`
  - Defines reusable authenticated browser workflow manifests and required evidence outputs.
- Create `packages/opencode/test/ulm/auth-browser-workflow.test.ts`
  - Tests workflow manifest validation and required screenshot/evidence contracts.
- Create `packages/opencode/src/ulm/saas-export-parsers.ts`
  - Parses safe read-only exports for Google Workspace, Microsoft/Entra, Genesis/SIS-style CSVs, and MDM basics.
- Create `packages/opencode/test/ulm/saas-export-parsers.test.ts`
  - Tests parsers with synthetic fixtures only, no secrets.
- Modify `tools/ulmcode-profile/docs/48-hour-district-pentest-activities.md`
  - Link runtime capability registry fields back to the planning doc.
- Modify `tools/ulmcode-profile/tool-manifest.json`
  - Add non-destructive command profiles only after the corresponding parser/workflow tests exist.

## Phase 1: Make Capability Gaps Runtime-Visible

### Task 1: Add Capability Registry

**Files:**
- Create: `packages/opencode/src/ulm/capability-registry.ts`
- Test: `packages/opencode/test/ulm/capability-registry.test.ts`

- [ ] **Step 1: Write the failing registry test**

```ts
import { describe, expect, test } from "bun:test"
import { criticalCapabilityGaps, getCapabilityLeg, operationCapabilityLegs } from "../../src/ulm/capability-registry"

describe("48-hour capability registry", () => {
  test("tracks critical legs that the current toolset cannot complete reliably", () => {
    const critical = criticalCapabilityGaps().map((leg) => leg.id)

    expect(critical).toContain("authenticated-browser-workflows")
    expect(critical).toContain("google-workspace-review")
    expect(critical).toContain("microsoft-ad-review")
    expect(critical).toContain("sis-genesis-review")
  })

  test("records current support and patch type for each leg", () => {
    const leg = getCapabilityLeg("authenticated-browser-workflows")

    expect(leg?.gapSeverity).toBe("critical")
    expect(leg?.currentSupport).toContain("agent_browser")
    expect(leg?.bestNextAbility).toContain("authenticated browser harness")
  })

  test("uses stable ids for all registry rows", () => {
    const ids = operationCapabilityLegs.map((leg) => leg.id)

    expect(ids.length).toBe(new Set(ids).size)
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```sh
cd packages/opencode
bun test test/ulm/capability-registry.test.ts
```

Expected: FAIL because `capability-registry.ts` does not exist.

- [ ] **Step 3: Implement the registry**

```ts
export type CapabilityGapSeverity = "low" | "medium" | "medium-high" | "high" | "critical"

export type CapabilityLeg = {
  id: string
  name: string
  neededCapability: string
  currentSupport: string[]
  gapSeverity: CapabilityGapSeverity
  failureMode: string
  bestNextAbility: string
}

export const operationCapabilityLegs: CapabilityLeg[] = [
  {
    id: "authenticated-browser-workflows",
    name: "Authenticated browser workflows",
    neededCapability:
      "Log in, maintain state, navigate portals, capture screenshots, inspect forms, follow role-specific workflows, and compare pre/post-login exposure.",
    currentSupport: ["agent_browser", "playwright", "browser_evidence"],
    gapSeverity: "critical",
    failureMode: "The model sees the login page, then hand-waves the actual application risk.",
    bestNextAbility: "authenticated browser harness with session vault handoff, workflow recipes, form model, and state recovery",
  },
  {
    id: "google-workspace-review",
    name: "Google Workspace review",
    neededCapability:
      "Inspect admin roles, groups, MFA, shared drives/docs, OAuth apps, external sharing, student-data exposure, and audit/log settings.",
    currentSupport: ["general browser", "operation_credentials", "k12-identity-and-privilege-escalation"],
    gapSeverity: "critical",
    failureMode: "The model can describe Google risk but cannot reliably inspect the tenant or produce structured evidence.",
    bestNextAbility: "Google Workspace connector or safe read-only export parser",
  },
  {
    id: "microsoft-ad-review",
    name: "Microsoft/AD review",
    neededCapability:
      "Inspect Entra/M365 roles, MFA/conditional access, groups, apps, mailbox posture, AD trusts, delegated paths, and LDAP/Kerberos facts.",
    currentSupport: ["nmap ad-lightweight-enum", "general browser", "k12-identity-and-privilege-escalation"],
    gapSeverity: "critical",
    failureMode: "The model misses privilege paths or relies on shallow port/service evidence.",
    bestNextAbility: "Entra/M365 connector, LDAP/BloodHound ingestion, and AD safe-enum command profiles",
  },
  {
    id: "sis-genesis-review",
    name: "SIS/Genesis review",
    neededCapability:
      "Inspect roles, exports, report permissions, student/staff data boundaries, admin access, and workflow risks using approved credentials.",
    currentSupport: ["general browser", "operation_credentials", "k12-risk-mapping-and-reporting"],
    gapSeverity: "critical",
    failureMode: "The model cannot assess the highest-value district system except through screenshots and prose.",
    bestNextAbility: "Genesis/SIS workflow plugin or browser recipe pack plus export parsers and data-boundary checklist",
  },
]

export function getCapabilityLeg(id: string) {
  return operationCapabilityLegs.find((leg) => leg.id === id)
}

export function criticalCapabilityGaps() {
  return operationCapabilityLegs.filter((leg) => leg.gapSeverity === "critical")
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run:

```sh
cd packages/opencode
bun test test/ulm/capability-registry.test.ts
```

Expected: PASS.

### Task 2: Feed Capability Gaps Into Operation Gap Audit

**Files:**
- Modify: `packages/opencode/src/ulm/operation-gap-audit.ts`
- Test: existing or new `packages/opencode/test/ulm/operation-gap-audit-capability.test.ts`

- [ ] **Step 1: Write a failing test for capability gaps in gap audit output**

```ts
import { describe, expect, test } from "bun:test"
import { operationCapabilityLegs } from "../../src/ulm/capability-registry"

describe("operation gap audit capability coverage", () => {
  test("critical capability legs have actionable backlog hints", () => {
    const critical = operationCapabilityLegs.filter((leg) => leg.gapSeverity === "critical")

    expect(critical.length).toBeGreaterThanOrEqual(4)
    for (const leg of critical) {
      expect(leg.failureMode.length).toBeGreaterThan(20)
      expect(leg.bestNextAbility.length).toBeGreaterThan(20)
    }
  })
})
```

- [ ] **Step 2: Add a `capabilityGaps` section to `operation-gap-audit.ts`**

Implementation rule: include critical/high capability gaps in `plans/gap-audit.json` with `id`, `name`, `gapSeverity`, `failureMode`, and `bestNextAbility`. Do not mark the operation failed only because a gap exists; mark it as a blocker when the plan requires that leg and no evidence exists.

- [ ] **Step 3: Run focused tests**

Run:

```sh
cd packages/opencode
bun test test/ulm/capability-registry.test.ts test/ulm/operation-gap-audit-capability.test.ts
```

Expected: PASS.

## Phase 2: Patch The Critical Execution Legs

### Task 3: Authenticated Browser Workflow Harness

**Files:**
- Create: `packages/opencode/src/ulm/auth-browser-workflow.ts`
- Test: `packages/opencode/test/ulm/auth-browser-workflow.test.ts`
- Later modify: `tools/ulmcode-profile/tool-manifest.json`

- [ ] **Step 1: Write tests for workflow manifests**

```ts
import { describe, expect, test } from "bun:test"
import { validateAuthBrowserWorkflow } from "../../src/ulm/auth-browser-workflow"

describe("authenticated browser workflow manifests", () => {
  test("requires login, navigation, screenshots, and evidence outputs", () => {
    const result = validateAuthBrowserWorkflow({
      id: "sis-role-review",
      service: "sis",
      credentialTags: ["genesis"],
      steps: ["open-login", "authenticate", "capture-dashboard", "inspect-role-menu", "capture-export-surface"],
      requiredArtifacts: ["screenshots/dashboard.png", "evidence/browser/session.md"],
    })

    expect(result.ok).toBe(true)
    expect(result.gaps).toEqual([])
  })

  test("rejects workflows that do not capture post-login evidence", () => {
    const result = validateAuthBrowserWorkflow({
      id: "bad-login-only",
      service: "sis",
      credentialTags: ["genesis"],
      steps: ["open-login", "authenticate"],
      requiredArtifacts: [],
    })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("workflow must capture at least one post-login screenshot or browser evidence artifact")
  })
})
```

- [ ] **Step 2: Implement manifest validation**

Create a small synchronous validator first. Do not automate browser execution yet. The first patch is to make expected evidence contract explicit so future browser runners can be tested against it.

- [ ] **Step 3: Add profile doc examples**

Update `tools/ulmcode-profile/docs/48-hour-district-pentest-activities.md` with the first supported workflow manifest names: `sis-role-review`, `google-admin-baseline`, `m365-admin-baseline`, and `portal-data-exposure-review`.

### Task 4: SaaS Export Parsers

**Files:**
- Create: `packages/opencode/src/ulm/saas-export-parsers.ts`
- Test: `packages/opencode/test/ulm/saas-export-parsers.test.ts`

- [ ] **Step 1: Add synthetic parser fixtures in the test**

```ts
import { describe, expect, test } from "bun:test"
import { parseGoogleAdminUsersCsv, parseRoleExportCsv } from "../../src/ulm/saas-export-parsers"

describe("SaaS export parsers", () => {
  test("parses Google admin user export risk signals", () => {
    const rows = parseGoogleAdminUsersCsv(`email,is_admin,2sv_enrolled,last_login\nadmin@example.edu,true,false,2026-06-01\n`)

    expect(rows).toEqual([
      {
        principal: "admin@example.edu",
        source: "google-admin-users",
        riskSignals: ["admin_without_2sv"],
      },
    ])
  })

  test("parses generic SIS role exports without storing raw student data", () => {
    const rows = parseRoleExportCsv(`user,role,can_export_students\nregistrar@example.edu,Registrar,true\n`)

    expect(rows[0]).toMatchObject({
      principal: "registrar@example.edu",
      role: "Registrar",
      riskSignals: ["student_export_permission"],
    })
  })
})
```

- [ ] **Step 2: Implement minimal CSV parsers**

Keep these as export parsers, not live connectors. They should accept text and return redacted, structured risk rows. Do not store full student records.

- [ ] **Step 3: Add command/tool manifest entries only for safe local parsing**

Add non-network parser profiles only after tests pass. Live Google/Microsoft/Genesis connectors should be separate explicit work because they need auth and tenant-specific safety decisions.

## Phase 3: Patch Trust And Proof

### Task 5: Evidence Quality Scorer

**Files:**
- Create: `packages/opencode/src/ulm/evidence-quality.ts`
- Test: `packages/opencode/test/ulm/evidence-quality.test.ts`

- [ ] **Step 1: Write scoring tests**

```ts
import { describe, expect, test } from "bun:test"
import { scoreEvidenceQuality } from "../../src/ulm/evidence-quality"

describe("evidence quality scoring", () => {
  test("flags findings with missing evidence paths", () => {
    const result = scoreEvidenceQuality({
      evidencePaths: ["evidence/raw/httpx.jsonl"],
      findingEvidenceRefs: ["evidence/raw/missing.json"],
      screenshotPaths: [],
      reportText: "Finding cites evidence/raw/missing.json",
    })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("finding references missing evidence path: evidence/raw/missing.json")
  })

  test("flags obvious raw secret leakage patterns", () => {
    const result = scoreEvidenceQuality({
      evidencePaths: [],
      findingEvidenceRefs: [],
      screenshotPaths: [],
      reportText: "password=Summer2026!",
    })

    expect(result.ok).toBe(false)
    expect(result.gaps).toContain("possible raw secret leaked into report text")
  })
})
```

- [ ] **Step 2: Implement the scorer**

Start with deterministic checks: missing refs, stale generated final artifacts, duplicate refs, raw credential patterns, empty screenshots, and unsupported "validated" language with no evidence refs.

- [ ] **Step 3: Wire the scorer into report lint or operation audit**

Make it visible during final handoff. The first integration can warn; later it should fail strict 48-hour handoff.

### Task 6: Scheduler Priority Model

**Files:**
- Modify: `packages/opencode/src/ulm/operation-backlog.ts`
- Modify: `packages/opencode/src/ulm/runtime-scheduler.ts`
- Test: `packages/opencode/test/ulm/scheduler-priority.test.ts`

- [ ] **Step 1: Write a test where high-value identity validation outranks another low-value scan**

Test input should include one unresolved critical capability gap, one unvalidated identity candidate, and one optional extra HTTP scan. Expected: scheduler/backlog picks identity validation first.

- [ ] **Step 2: Add a simple deterministic priority function**

Priority order:

1. Finalization blockers inside protected finalization window.
2. Credential/safety blockers.
3. Critical capability legs required by the plan.
4. Unvalidated high-impact findings.
5. Evidence-quality gaps for report-ready findings.
6. Coverage gaps that unlock new attack paths.
7. Extra recon.

- [ ] **Step 3: Add priority reason to scheduler output**

Every launched lane should say why it was chosen in terms of coverage value, validation debt, report impact, or finalization risk.

## Phase 4: Add Evals So We Stop Lying To Ourselves

### Task 7: Capability Harness Scenarios

**Files:**
- Create: `tools/ulmcode-labs/k12-saas-identity-capability/README.md`
- Create: `tools/ulmcode-labs/k12-saas-identity-capability/fixtures/google-admin-users.csv`
- Create: `tools/ulmcode-labs/k12-saas-identity-capability/fixtures/sis-roles.csv`
- Modify: `packages/opencode/script/ulm-harness-run.ts`

- [ ] **Step 1: Add a synthetic lab fixture**

The fixture should include:

- admin without MFA
- registrar with student export permission
- stale privileged account
- overshared student-data folder metadata
- one harmless false positive to reject

- [ ] **Step 2: Add harness scoring**

Score whether ULMCode:

- parses the exports
- records evidence
- creates the right candidate findings
- rejects the false positive
- includes the evidence in the report draft

### Task 8: Report And Evidence Regression

**Files:**
- Modify: `packages/opencode/script/ulm-harness-run.ts`
- Test: `packages/opencode/test/ulm/harness-evidence-quality.test.ts`

- [ ] **Step 1: Add failing harness assertions for unsupported report claims**

Reports should fail harness scoring when they contain validated claims without evidence refs, raw credential-looking text, or missing final paths.

- [ ] **Step 2: Wire evidence quality results into harness scorecards**

Add the evidence quality score to readiness output so repeated runs track whether the model is becoming more trustworthy.

## Implementation Order

1. Capability registry and gap audit integration.
2. Evidence quality scorer.
3. Authenticated browser workflow manifests.
4. SaaS export parsers.
5. Scheduler priority model.
6. Synthetic SaaS/identity lab.
7. Report/evidence regression harness.
8. Only then add live connectors or MCPs for Google/Microsoft/Genesis/MDM.

## Success Criteria

- A 48-hour operation gap audit names critical missing capabilities instead of only generic coverage gaps.
- Scheduler/backlog can prioritize high-value identity/browser/evidence work above extra recon.
- ULMCode can parse safe SaaS/SIS exports into redacted risk signals.
- Report lint/audit can catch unsupported claims and broken evidence paths.
- Harness scenarios fail when the model cannot complete critical legs, even if it writes a plausible report.
- New live MCPs/connectors are added only when a corresponding leg has parser tests, evidence contracts, and safety gates.

## Self-Review

- Spec coverage: The plan covers the user's request to patch weak spots by mapping each critical journey leg to concrete tools, skills, plugins, parsers, and evals.
- Placeholder scan: No task depends on a future unnamed subsystem; live connectors are intentionally deferred until parser/workflow/evidence contracts exist.
- Type consistency: `CapabilityLeg`, `CapabilityGapSeverity`, `operationCapabilityLegs`, `getCapabilityLeg`, and `criticalCapabilityGaps` are introduced before being used.
