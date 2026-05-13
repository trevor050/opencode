# ULM Duration Harness Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop long ULM operations from collapsing into shallow one-hour runs by forcing approved full plans to contain executable time-sliced work and by making the scheduler/report closeout respect that work.

**Architecture:** Keep the existing operation goal -> discovery charter -> full plan -> operation graph -> runtime scheduler pipeline, but add a durable execution-block contract to the full plan. `operation_schedule` will expand approved plan blocks into concrete graph lanes before reporting lanes, so report writing cannot start until planned work blocks are completed, blocked with coverage impact, or explicitly skipped under the coverage contract.

**Tech Stack:** TypeScript, Bun test, ULM operation artifacts under `.ulmcode/operations`, OpenCode tool definitions, scheduler/daemon runtime code.

---

## Current Evidence

- The failed run `home-overnight-20260511` recorded a long-running local network operation but finished core work far earlier than the operator's requested window.
- Existing `validateOperationPlan` requires phases, allocations, coverage contract, and duration-fit evidence for 2h+ plans, but it does not require a plan to contain enough executable 20-60 minute work blocks to fill the requested duration.
- Existing `operation-graph` templates are short fixed lane chains. For internal-network runs this leaves about a dozen broad lanes, which is too easy for agents to compress into shallow summaries.
- `autoCompleteReportLane` can mark report lanes complete from existing final artifacts, so once report artifacts exist the graph can finish even if the target runtime still had useful work remaining.
- `decideOperationNext` checks coverage-ready stop before target-window-open wait, so a coverage contract that looks satisfied can stop the operation while the intended duration is still open.

## File Structure

- Modify `packages/opencode/src/ulm/artifact.ts`
  - Add `OperationExecutionBlock` and `OperationTimeBudget.executionBlocks`.
  - Validate block count, duration coverage, block duration caps, objectives, success criteria, fallback work, and lane ids for 2h+ plans.
  - Render execution blocks in operation-plan markdown.
- Modify `packages/opencode/src/tool/operation_plan.ts`
  - Add schema support for execution blocks.
- Modify `packages/opencode/src/tool/operation_plan.txt`
  - Tell models that approved full plans need concrete 20-30 minute blocks for 2-8h runs and 30-60 minute blocks for overnight/extended runs.
- Modify `packages/opencode/src/ulm/operation-graph.ts`
  - Read full plan execution blocks in `writeOperationGraph`.
  - Inject `planned_work_<n>` lanes after discovery/evidence-producing lanes and before report/evidence-index/reporting lanes.
  - Make report lanes depend on all generated planned-work lanes.
- Modify `packages/opencode/src/ulm/operation-run.ts`
  - Give planned-work lanes lane-specific prompts that require a block artifact and operation checkpoint/evidence references.
  - Prevent report auto-completion while any planned-work lane remains incomplete.
  - Reject planned-work completion before the scheduler-recorded wall-clock floor, even when a worker supplies the expected artifact names.
- Modify `packages/opencode/src/ulm/operation-next.ts`
  - Prefer "target runtime still open/planned work remains" over early stop when no lane is ready.
- Tests:
  - `packages/opencode/test/ulm/artifact.test.ts`
  - `packages/opencode/test/tool/operation_plan.test.ts`
  - `packages/opencode/test/ulm/operation-graph.test.ts`
  - `packages/opencode/test/ulm/operation-run.test.ts`
  - `packages/opencode/test/ulm/runtime-scheduler.test.ts`

## Tasks

### Task 1: Plan Contract

- [x] Add failing tests that reject a 7h `full-duration` plan with only broad phases and allocations.
- [x] Add passing tests for a 7h plan with at least fourteen 30-minute execution blocks covering non-finalization work.
- [x] Implement `OperationExecutionBlock` and validation.
- [x] Render execution blocks in plan markdown so operators can inspect the real work order.

### Task 2: Tool Schema And Prompt Contract

- [x] Add failing tool test showing `operation_plan` rejects approved 2h+ plans without execution blocks.
- [x] Add schema fields for execution blocks.
- [x] Update `operation_plan.txt` so the model cannot confuse the Discovery Charter with the executable full plan.

### Task 3: Graph Expansion

- [x] Add failing graph test showing an internal-network 7h plan creates planned-work lanes before reporting.
- [x] Implement plan-derived lane injection in `writeOperationGraph`.
- [x] Ensure reporting lanes depend on all planned-work lanes.

### Task 4: Early Closeout Guard

- [x] Add failing operation-run test showing report lanes do not auto-complete while planned-work lanes are incomplete.
- [x] Add failing next-action/scheduler test showing target-window-open operations do not stop immediately after superficial coverage readiness.
- [x] Patch auto-completion and next-action ordering.

### Task 5: Verification

- [x] Run focused tests for plan, graph, run, and scheduler behavior.
- [x] Run `bun typecheck` from `packages/opencode`.
- [x] Run at least one ULM harness gate that exercises the scheduler spine, preferably `bun run --cwd packages/opencode test:ulm-smoke` if runtime permits.
- [x] Inspect `home-overnight-20260511` artifacts again and map the new invariants to the observed failure.

## Completion Audit Criteria

- A 2h+ full plan without execution blocks fails validation.
- A 7h full plan needs enough execution blocks to cover the requested non-finalization window.
- The graph contains concrete planned-work lanes before report lanes.
- Planned-work lanes have scheduler-owned `startedAt` and `minRuntimeMinutes`, and early completion attempts are blocked.
- Report lanes cannot auto-complete while planned-work lanes are still pending/running.
- Scheduler/next-action does not treat early coverage/report artifacts as enough to stop while the target window is still materially open.
- Tests and typecheck pass, or any failures are documented with exact blockers.
