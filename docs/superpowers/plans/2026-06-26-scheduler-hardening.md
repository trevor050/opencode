# Scheduler Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade ULMCode's 48-hour runtime scheduler from graph-order/FIFO execution into a priority-driven, self-auditing scheduler that spends unattended time on the highest-value remaining work and proves why each action was chosen.

**Architecture:** Keep the existing deterministic daemon/scheduler loop, but insert a deterministic priority engine between graph state, capability gaps, work queue units, findings, evidence quality, and finalization pressure. The scheduler should emit decision records explaining every launch, reject shallow lane completions, measure starvation and queue health, and escalate when critical capability legs cannot be completed with available tools.

**Tech Stack:** Bun tests, TypeScript modules under `packages/opencode/src/ulm`, existing operation graph/backlog/work-queue/runtime scheduler, JSON artifacts under `.ulmcode/operations/<id>/scheduler/`.

---

## Current Scheduler Problem

Today the scheduler mostly does:

1. `runtime_daemon` ticks on a wall-clock loop.
2. `runtime_scheduler` syncs jobs, maybe asks `operation_supervisor`, then calls `operation_run`.
3. `operation_run` asks `operation_next`.
4. `operation_next` selects the first ready graph lane in graph order.
5. `runtime_scheduler` also claims the first queued command work units from `work-queue.json`.
6. backlog expansion adds a generic `planned_work_expansion_N` lane and refills queue from `leads.json`.

That is reliable plumbing, but not enough for 48 hours. It can spend time on easy recon while authenticated identity, evidence quality, validation debt, and report-critical gaps remain unresolved.

## File Structure

- Create `packages/opencode/src/ulm/scheduler-priority.ts`
  - Computes deterministic priority scores and reasons for graph lanes and command work units.
- Create `packages/opencode/test/ulm/scheduler-priority.test.ts`
  - Verifies that finalization blockers, credential blockers, critical capability gaps, validation debt, evidence-quality gaps, and high-impact findings outrank low-value recon.
- Modify `packages/opencode/src/ulm/operation-next.ts`
  - Uses the priority engine instead of first-ready lane selection.
- Modify `packages/opencode/src/ulm/work-queue.ts`
  - Sorts queued command units by priority and records priority reasons.
- Modify `packages/opencode/src/ulm/runtime-scheduler.ts`
  - Emits `scheduler/decision-log.jsonl` and includes priority reasons in heartbeat records.
- Modify `packages/opencode/src/ulm/operation-backlog.ts`
  - Generates backlog lanes based on critical capability gaps and validation/evidence debt, not only generic expansion.
- Create `packages/opencode/src/ulm/scheduler-scorecard.ts`
  - Summarizes whether the scheduler used time well: starvation, repeated low-value launches, unresolved critical gaps, evidence debt, finalization timing, and recovery behavior.
- Create `packages/opencode/test/ulm/scheduler-scorecard.test.ts`
  - Tests scorecard warnings against synthetic scheduler logs.
- Modify `packages/opencode/src/ulm/literal-run-readiness.ts`
  - Requires scheduler scorecard proof for 20h+ or `school-laptop-48h` readiness.

## Task 1: Add Scheduler Priority Engine

**Files:**
- Create: `packages/opencode/src/ulm/scheduler-priority.ts`
- Test: `packages/opencode/test/ulm/scheduler-priority.test.ts`

- [x] **Step 1: Write failing priority tests**

```ts
import { describe, expect, test } from "bun:test"
import { prioritizeSchedulerItems } from "../../src/ulm/scheduler-priority"

describe("scheduler priority", () => {
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
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```sh
cd packages/opencode
bun test test/ulm/scheduler-priority.test.ts
```

Expected: FAIL because `scheduler-priority.ts` does not exist.

- [x] **Step 3: Implement the minimal priority engine**

```ts
export type SchedulerItemCategory =
  | "finalization"
  | "credential_safety"
  | "critical_capability"
  | "validation_debt"
  | "evidence_quality"
  | "high_impact_finding"
  | "coverage_expansion"
  | "extra_recon"

export type SchedulerCoverageImpact = "none" | "low" | "medium" | "high" | "blocks_release"

export type SchedulerPriorityInput = {
  now: string
  finalizationDue: boolean
  items: Array<{
    id: string
    kind: "lane" | "command"
    category: SchedulerItemCategory
    coverageImpact: SchedulerCoverageImpact
    ageMinutes?: number
  }>
}

export type PrioritizedSchedulerItem = SchedulerPriorityInput["items"][number] & {
  priority: {
    score: number
    reason: string
  }
}

const categoryScore: Record<SchedulerItemCategory, number> = {
  finalization: 1000,
  credential_safety: 900,
  critical_capability: 800,
  validation_debt: 700,
  evidence_quality: 650,
  high_impact_finding: 600,
  coverage_expansion: 300,
  extra_recon: 100,
}

const impactScore: Record<SchedulerCoverageImpact, number> = {
  none: 0,
  low: 10,
  medium: 25,
  high: 50,
  blocks_release: 100,
}

function priorityReason(input: { category: SchedulerItemCategory; finalizationDue: boolean }) {
  if (input.category === "finalization" && input.finalizationDue) return "protected finalization work blocks handoff"
  if (input.category === "critical_capability") return "critical capability gap blocks meaningful 48-hour coverage"
  if (input.category === "validation_debt") return "validation debt must be resolved before report-ready claims"
  if (input.category === "evidence_quality") return "evidence quality gap can invalidate final report claims"
  if (input.category === "credential_safety") return "credential or safety blocker must be resolved before launch"
  if (input.category === "high_impact_finding") return "high-impact finding work improves report value"
  if (input.category === "coverage_expansion") return "coverage expansion fills known gaps"
  return "extra recon has low priority unless higher-value work is clear"
}

export function prioritizeSchedulerItems(input: SchedulerPriorityInput): PrioritizedSchedulerItem[] {
  return input.items
    .map((item) => {
      const score =
        categoryScore[item.category] +
        impactScore[item.coverageImpact] +
        Math.min(60, Math.max(0, item.ageMinutes ?? 0) / 10)
      return {
        ...item,
        priority: {
          score,
          reason: priorityReason({ category: item.category, finalizationDue: input.finalizationDue }),
        },
      }
    })
    .sort((left, right) => {
      if (right.priority.score !== left.priority.score) return right.priority.score - left.priority.score
      return left.id.localeCompare(right.id)
    })
}
```

- [x] **Step 4: Run the test and verify it passes**

Run:

```sh
cd packages/opencode
bun test test/ulm/scheduler-priority.test.ts
```

Expected: PASS.

## Task 2: Use Priority For Graph Lane Selection

**Files:**
- Modify: `packages/opencode/src/ulm/operation-next.ts`
- Test: `packages/opencode/test/ulm/operation-next-priority.test.ts`

- [x] **Step 1: Write a test where a later critical lane beats an earlier ready recon lane**

```ts
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { decideOperationNext } from "../../src/ulm/operation-next"

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

describe("operation_next priority selection", () => {
  test("chooses critical capability lane before lower-value recon lane", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ulm-next-priority-"))
    const root = path.join(dir, ".ulmcode", "operations", "priority-school")
    await writeJson(path.join(root, "goals", "operation-goal.json"), {
      operationID: "priority-school",
      status: "active",
      objective: "test",
      targetDurationHours: 48,
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
    })
    await writeJson(path.join(root, "deliverables", "runtime-summary.json"), {
      operationID: "priority-school",
      generatedAt: "2026-06-26T00:00:00.000Z",
      modelCalls: { total: 0, byModel: {} },
      usage: { costUSD: 0 },
      compaction: { count: 0, pressure: "low" },
      notes: [],
    })
    await writeJson(path.join(root, "plans", "operation-plan.json"), {
      operationID: "priority-school",
      timeBudget: { targetHours: 48, finalizationWindowHours: 4 },
      scopeRules: ["test scope"],
    })
    await writeJson(path.join(root, "plans", "operation-graph.json"), {
      operationID: "priority-school",
      safetyMode: "non_destructive",
      trustLevel: "unattended",
      scanProfile: "aggressive",
      maxConcurrentLanes: 1,
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
      lanes: [
        {
          id: "recon",
          title: "Recon",
          agent: "recon",
          status: "ready",
          dependsOn: [],
          modelRoute: "openai/gpt-5.4-mini-fast",
          allowedTools: ["operation_status"],
          expectedArtifacts: ["work-blocks/recon.md"],
          restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 60 },
          coverageImpact: "medium",
          operationID: "priority-school",
        },
        {
          id: "google_workspace_review",
          title: "Google Workspace Review",
          agent: "validator",
          status: "ready",
          dependsOn: [],
          modelRoute: "openai/gpt-5.5",
          allowedTools: ["operation_status", "evidence_record"],
          expectedArtifacts: ["work-blocks/google-workspace-review.md"],
          restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 60 },
          coverageImpact: "high",
          operationID: "priority-school",
          priorityCategory: "critical_capability",
        },
      ],
    })

    const next = await decideOperationNext(dir, {
      operationID: "priority-school",
      now: new Date("2026-06-26T01:00:00.000Z"),
    })

    expect(next.action.action).toBe("launch_lane")
    if (next.action.action === "launch_lane") {
      expect(next.action.lane.id).toBe("google_workspace_review")
      expect(next.action.reason).toContain("critical capability")
    }
  })
})
```

- [x] **Step 2: Extend lane-to-priority mapping in `operation-next.ts`**

Add a small helper that converts `OperationLane` into a `SchedulerItemCategory`:

- explicit `lane.priorityCategory` if present
- report/finalization lanes -> `finalization`
- `finding_validation` -> `validation_debt`
- `evidence_normalization` -> `evidence_quality`
- lanes containing `google`, `microsoft`, `entra`, `ad`, `sis`, `genesis`, `browser`, `identity` -> `critical_capability`
- `planned_work_` -> `coverage_expansion`
- default -> `extra_recon`

- [x] **Step 3: Replace first-ready selection with priority selection**

Instead of returning the first ready lane, collect all ready lanes, prioritize them, and return the highest-scored one. Include the priority reason in the `launch_lane` reason and `next-action.json`.

- [x] **Step 4: Run tests**

Run:

```sh
cd packages/opencode
bun test test/ulm/scheduler-priority.test.ts test/ulm/operation-next-priority.test.ts test/ulm/operation-run.test.ts
```

Expected: PASS.

## Task 3: Prioritize Command Work Units

**Files:**
- Modify: `packages/opencode/src/ulm/work-queue.ts`
- Test: `packages/opencode/test/ulm/work-queue-priority.test.ts`

- [x] **Step 1: Write a failing test for command-unit priority**

Create a queue with:

- `passive-web-baseline` for a low-severity URL
- `service-inventory` for a domain-controller-like host
- `http-discovery` for many generic hosts

Expected: domain-controller-like `service-inventory` is claimed first.

- [x] **Step 2: Add priority fields to `WorkUnit`**

Add optional fields:

```ts
priority?: {
  score: number
  reason: string
}
```

- [x] **Step 3: Score units during `buildWorkQueue`**

Initial deterministic scoring:

- `ad-lightweight-enum`, `smb-inventory`, `service-inventory` on DC-like names: high
- `http-discovery`: medium
- `content-discovery`: medium-low
- `passive-web-baseline`: medium
- repeated low-value extras: low

- [x] **Step 4: Sort queued units by priority in `nextWorkUnits`**

Sort before `.slice(0, limit)`. Preserve stable tie-break by `createdAt`, then `id`.

## Task 4: Add Scheduler Decision Log

**Files:**
- Modify: `packages/opencode/src/ulm/runtime-scheduler.ts`
- Test: `packages/opencode/test/ulm/runtime-scheduler-decision-log.test.ts`

- [x] **Step 1: Write a test that scheduler emits decision records**

Expected `scheduler/decision-log.jsonl` records:

- operation id
- cycle
- selected lane or command units
- priority score/reason
- supervisor action if any
- skipped high-priority blockers if any

- [x] **Step 2: Implement `appendDecisionLog`**

Write one JSONL record per cycle. Include both model lane and command work decisions.

- [x] **Step 3: Add heartbeat summary**

Add `lastDecisionReason`, `lastPriorityScore`, and `skippedHigherPriorityCount` to scheduler heartbeat.

## Task 5: Capability-Aware Backlog Expansion

**Files:**
- Modify: `packages/opencode/src/ulm/operation-backlog.ts`
- Test: `packages/opencode/test/ulm/operation-backlog-capability.test.ts`
- Depends on: `packages/opencode/src/ulm/capability-registry.ts` from `2026-06-26-48h-capability-patches.md`

- [ ] **Step 1: Write test for capability backlog lane generation**

When gap audit reports missing `authenticated-browser-workflows` and `google-workspace-review`, backlog should generate lanes named:

- `planned_work_capability_authenticated_browser_workflows`
- `planned_work_capability_google_workspace_review`

Expected lanes use high-impact model route and allowed tools that match the capability.

- [ ] **Step 2: Add capability backlog generation**

If all base lanes are complete but critical capability gaps remain, generate capability-specific lanes before generic `planned_work_expansion_N`.

- [ ] **Step 3: Keep generic expansion as fallback only**

Generic expansion should run only when no critical/high capability-specific lane can be generated.

## Task 6: Add Anti-Shallow Lane Completion Checks

**Files:**
- Modify: `packages/opencode/src/ulm/operation-run.ts`
- Test: `packages/opencode/test/ulm/operation-run-proof-quality.test.ts`

- [ ] **Step 1: Write tests for shallow proof rejection**

Reject completion when:

- summary is generic and short for a high-impact lane
- expected artifacts exist but are tiny placeholder files
- evidence refs are present but not linked by any finding/report-ready artifact
- planned work attempts to complete without minimum runtime or meaningful artifact text

- [ ] **Step 2: Implement deterministic proof quality checks**

Add helper:

```ts
function validateProofQuality(lane: OperationLane, proof: LaneCompletionProof, artifactTextByPath: Map<string, string>) {
  const gaps: string[] = []
  if ((lane.coverageImpact === "high" || lane.coverageImpact === "blocks_release") && proof.summary.trim().length < 120) {
    gaps.push(`${lane.id}: high-impact lane requires a substantive proof summary`)
  }
  return gaps
}
```

Then expand it incrementally with artifact size/text checks.

## Task 7: Scheduler Scorecard

**Files:**
- Create: `packages/opencode/src/ulm/scheduler-scorecard.ts`
- Test: `packages/opencode/test/ulm/scheduler-scorecard.test.ts`
- Modify: `packages/opencode/src/ulm/literal-run-readiness.ts`

- [ ] **Step 1: Write scorecard tests**

Synthetic logs should fail when:

- scheduler launches extra recon while critical capability gaps remain
- same low-priority category launches repeatedly
- finalization starts late
- high-priority lane starves for more than N cycles
- command jobs fail repeatedly without downgrade/fallback

- [ ] **Step 2: Implement scorecard writer**

Write:

- `scheduler/scheduler-scorecard.json`
- `scheduler/scheduler-scorecard.md`

Fields:

- total cycles
- model lane launches by category
- command launches by profile
- skipped high-priority work
- starvation warnings
- finalization timing
- unresolved critical gaps
- recommendation list

- [ ] **Step 3: Require scorecard in literal readiness**

For 20h+ runs and `school-laptop-48h`, readiness should require a scorecard and fail if it contains release-blocking scheduler issues.

## Task 8: Add Burn-In Chaos Scenarios For Scheduler Judgment

**Files:**
- Modify: `packages/opencode/script/ulm-harness-run.ts`
- Test: `packages/opencode/test/ulm/harness-scheduler-judgment.test.ts`

- [ ] **Step 1: Add synthetic scheduler judgment fixtures**

Scenarios:

1. easy recon available, critical identity lane pending
2. candidate findings unresolved, extra web scans available
3. finalization window open, broad discovery still queued
4. command failures repeating, fallback available
5. evidence quality gap blocking report

- [ ] **Step 2: Score scheduler decisions**

Harness should score:

- picked best next action
- did not launch lower-priority work first
- wrote decision reason
- wrote scorecard warning when forced to compromise

## Implementation Order

1. `scheduler-priority.ts` and tests.
2. `operation-next.ts` priority lane selection.
3. `work-queue.ts` command-unit priority.
4. `runtime-scheduler.ts` decision log.
5. capability-aware backlog expansion.
6. proof-quality lane completion checks.
7. scheduler scorecard.
8. literal readiness integration.
9. harness chaos scenarios.

## Success Criteria

- Scheduler no longer chooses the first ready lane blindly.
- Command units are not claimed FIFO when higher-impact work is queued.
- Every scheduler cycle writes why it launched, waited, blocked, or expanded.
- Critical capability gaps become scheduled work before generic second-pass expansion.
- Shallow high-impact lane proof is rejected.
- Literal 48-hour readiness includes scheduler judgment proof, not just uptime.
- Harness tests catch wasted 48-hour runs even when artifacts technically exist.

## Self-Review

- Spec coverage: The plan targets the user's concern that 48-hour runs must actually work, focusing on scheduler prioritization, evidence of good decisions, recovery, and anti-shallow proof.
- Placeholder scan: Live connector work is intentionally excluded; this plan hardens scheduler judgment first.
- Type consistency: `SchedulerItemCategory`, `SchedulerPriorityInput`, `PrioritizedSchedulerItem`, and `priority` fields are introduced before use.
