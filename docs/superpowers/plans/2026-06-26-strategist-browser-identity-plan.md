# Strategist, Browser, And Identity Capability Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give 20-48 hour ULMCode runs a permissive planning navigator, a durable logged-in browser workbench, and the first identity/SaaS review workflows without over-constraining the model.

**Architecture:** Keep the deterministic scheduler as the executor, but add a lightweight strategist artifact that proposes the next few useful moves in plain, inspectable JSON. The scheduler treats those moves as hints, not law. In parallel, add a local browser workbench built around a persistent Chromium profile on the dedicated laptop, with artifact capture and operation-safe session management. Identity/SaaS workflows ride on that browser first, then graduate to export parsers or connectors only where browser control is too weak.

**Tech Stack:** Bun tests, TypeScript ULM operation modules, existing scheduler/operation tools, Playwright MCP or Browser MCP style local browser control, persistent Chromium profile, operation artifacts under `.ulmcode/operations/<id>/browser/` and `.ulmcode/operations/<id>/strategy/`.

---

## Product Direction

Trevor's correction:

- Do not make strategy output a brittle schema that blocks work.
- The deterministic validator should be extremely light and permissive.
- The model should have a high-quality local browser on a mostly empty Surface laptop dedicated to ULMCode.
- Authenticated browser capability should carry much of identity/SaaS review.
- Safe validation is important but not the main immediate bottleneck.
- Organization/management remains a major investment area.
- Scorecards are useful, but do not over-focus there yet.

## What "Structured Output" Means Here

It means "a short machine-readable strategy memo," not a rigid gate.

The strategist writes `strategy/next-actions.json` like:

```json
{
  "operationID": "school",
  "generatedAt": "2026-06-26T20:00:00.000Z",
  "horizon": "next 3-5 useful moves",
  "items": [
    {
      "title": "Open logged-in SIS and inspect role/export surfaces",
      "why": "Identity and student-data access are higher-value than more unauthenticated recon right now.",
      "suggestedLane": "sis_browser_review",
      "usefulTools": ["authenticated_browser", "browser_evidence", "evidence_record"],
      "expectedProof": ["browser/session-log.md", "browser/screenshots/sis-dashboard.png"]
    }
  ]
}
```

Only `title` and `why` are required. Everything else is optional hint text. The scheduler may use it, ignore it, or ask a model lane to refine it. It should not reject the whole plan because a field is missing.

## Browser Direction

Default target:

- local Chromium/Chrome with a persistent ULMCode profile
- visible browser on the Surface, because the laptop is dedicated to the operation
- persistent cookies/session state across daemon ticks
- screenshots, downloads, DOM/accessibility snapshots, current URL, and session log captured into operation artifacts
- credential material enters only through operation vault handoff or operator login, not prompt text

Candidate stack:

1. **Microsoft Playwright MCP with persistent profile**
   Best default for durable automation, accessibility snapshots, traces, screenshots, and repeatable workflows. Use `--user-data-dir` or profile mode for session persistence.

2. **Browser MCP / existing Chrome profile bridge**
   Strong candidate when we want the model to operate the actual open logged-in browser profile instead of a fresh automation browser.

3. **Chrome DevTools MCP companion**
   Use for console/network/performance/debug evidence, not as the only user-facing browser operator.

4. **Agent Browser**
   Keep for light day-to-day browsing and quick checks, but not as the primary authenticated district portal workbench.

## Phase 1: Permissive Scheduler Strategist

### Task 1: Strategy Artifact Types

**Files:**
- Create: `packages/opencode/src/ulm/operation-strategy.ts`
- Test: `packages/opencode/test/ulm/operation-strategy.test.ts`

- [x] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from "bun:test"
import { normalizeStrategyMemo } from "../../src/ulm/operation-strategy"

describe("operation strategy memo", () => {
  test("accepts minimal next-action items", () => {
    const memo = normalizeStrategyMemo({
      operationID: "school",
      items: [{ title: "Inspect logged-in SIS role surfaces", why: "Student-data access is high value." }],
    })

    expect(memo.items).toHaveLength(1)
    expect(memo.items[0]?.title).toBe("Inspect logged-in SIS role surfaces")
    expect(memo.gaps).toEqual([])
  })

  test("keeps imperfect model output as hints instead of rejecting everything", () => {
    const memo = normalizeStrategyMemo({
      operationID: "school",
      items: [
        { title: "Review Google Admin MFA gaps" },
        { why: "This item is too vague." },
      ],
    })

    expect(memo.items).toHaveLength(1)
    expect(memo.gaps).toContain("item 1 missing title")
  })
})
```

- [x] **Step 2: Implement permissive normalization**

Rules:

- `operationID` required.
- `items` defaults to empty.
- Keep any item with a non-empty `title`.
- `why`, `suggestedLane`, `usefulTools`, `expectedProof`, and `estimatedMinutes` are optional.
- Record gaps as warnings, not fatal errors.

### Task 2: Strategy Prompt And Writer

**Files:**
- Create: `packages/opencode/src/ulm/operation-strategy-prompt.ts`
- Modify: `packages/opencode/src/tool/registry.ts`
- Create: `packages/opencode/src/tool/operation_strategy.ts`
- Create: `packages/opencode/src/tool/operation_strategy.txt`
- Test: `packages/opencode/test/tool/operation_strategy.test.ts`

- [x] **Step 1: Add tool test**

The tool should write:

- `strategy/next-actions.json`
- `strategy/next-actions.md`

The output should contain the strategist prompt context and the normalized memo.

- [x] **Step 2: Implement `operation_strategy`**

Inputs:

- `operationID`
- optional `horizonItems`, default `5`
- optional freeform `operatorFocus`

It should gather operation status, latest gap audit if present, findings counts, queue state, runtime summary, and time remaining. It should either:

- call the model strategist if available in runtime context, or
- write a prompt artifact for a model lane to execute.

Do not block scheduler work if strategy fails.

## Phase 2: Strategy-Aware Scheduler

### Task 3: Strategy Hint Ingestion

**Files:**
- Modify: `packages/opencode/src/ulm/scheduler-priority.ts`
- Modify: `packages/opencode/src/ulm/operation-next.ts`
- Test: `packages/opencode/test/ulm/scheduler-strategy-hints.test.ts`

- [x] **Step 1: Test that strategy hints bias but do not dictate selection**

Scenario:

- `strategy/next-actions.json` says SIS browser review is next.
- SIS lane is ready and allowed.
- generic recon lane is also ready.
- scheduler picks SIS lane.

Second scenario:

- strategy item suggests a lane that does not exist.
- scheduler logs the hint gap but still picks the best available lane.

- [x] **Step 2: Add hint boost**

Small boost only:

- exact lane title/id match: +75
- related keyword match: +40
- never override finalization, credential safety, or explicit blockers

## Phase 3: Authenticated Browser Workbench

### Task 4: Browser Workbench Config

**Files:**
- Create: `packages/opencode/src/ulm/browser-workbench.ts`
- Test: `packages/opencode/test/ulm/browser-workbench.test.ts`
- Modify: `tools/ulmcode-profile/opencode.json`
- Modify: `tools/ulmcode-profile/tool-manifest.json`

- [x] **Step 1: Test browser profile path generation**

For operation `school`, browser artifacts should resolve to:

- `browser/profile/`
- `browser/screenshots/`
- `browser/downloads/`
- `browser/session-log.jsonl`

No browser path may escape the operation root.

- [x] **Step 2: Add workbench config**

```ts
export type BrowserWorkbenchConfig = {
  operationID: string
  profileDir: string
  screenshotsDir: string
  downloadsDir: string
  sessionLogPath: string
  preferredMcp: "playwright-persistent" | "browser-mcp" | "chrome-devtools"
}
```

- [x] **Step 3: Add profile MCP candidate config**

Add disabled-by-default candidate entries or documentation for:

- Playwright MCP with persistent `--user-data-dir`
- Browser MCP bridge for existing Chrome profile
- Chrome DevTools MCP for evidence/debugging

Do not remove Agent Browser yet.

### Task 5: Browser MCP Bakeoff Harness

**Files:**
- Create: `packages/opencode/src/ulm/browser-bakeoff.ts`
- Test: `packages/opencode/test/ulm/browser-bakeoff.test.ts`
- Create: `tools/ulmcode-profile/docs/authenticated-browser-bakeoff.md`

- [x] **Step 1: Define bakeoff criteria**

Criteria:

- persistent login/session state
- visible local browser support
- screenshot capture
- DOM/accessibility extraction
- download handling
- file upload handling
- console/network capture
- recovery after browser crash
- operation artifact logging
- MCP stability under long tasks

- [x] **Step 2: Score candidates**

Start candidates:

- `playwright-persistent`
- `browser-mcp-existing-profile`
- `chrome-devtools-companion`
- `agent-browser-lightweight`

Bakeoff output:

- `browser/bakeoff.json`
- `browser/bakeoff.md`

## Phase 4: Identity/SaaS Workflows Through Browser

### Task 6: Workflow Manifests

**Files:**
- Create: `packages/opencode/src/ulm/browser-workflows.ts`
- Test: `packages/opencode/test/ulm/browser-workflows.test.ts`

- [x] **Step 1: Add workflow manifest tests**

Required workflows:

- `sis-role-export-review`
- `google-admin-mfa-sharing-review`
- `microsoft-entra-role-mfa-review`
- `mdm-admin-device-review`

Each workflow defines:

- service type
- login assumption
- steps as natural-language browser objectives
- required screenshots
- required notes
- prohibited raw data
- expected evidence artifacts

- [x] **Step 2: Implement workflow registry**

Make these workflow manifests readable by scheduler strategy and browser workbench lanes.

## Phase 5: Operation Management Board

### Task 7: Operation Board Artifact

**Files:**
- Create: `packages/opencode/src/ulm/operation-board.ts`
- Test: `packages/opencode/test/ulm/operation-board.test.ts`
- Tool later: `operation_board`

- [x] **Step 1: Define board sections**

Board sections:

- current objective
- next strategy items
- active lanes/jobs
- blocked work
- browser sessions
- evidence inbox
- identity/SaaS gaps
- report readiness
- finalization status

- [x] **Step 2: Generate board markdown/json from existing artifacts**

This is read-only. It should not become another source of truth.

## Priority Order

1. Permissive `operation_strategy` artifact.
2. Strategy hints in scheduler priority.
3. Browser workbench config and artifact paths.
4. Browser MCP bakeoff.
5. First authenticated browser workflow: SIS/Genesis role/export review.
6. Google/Microsoft/MDM workflow manifests.
7. Operation board.

## Success Criteria

- Scheduler has a next-3-to-5 strategy memo without being blocked by schema brittleness.
- Strategy hints can bias scheduler choices but cannot force unsafe/out-of-scope work.
- ULMCode has a dedicated local browser profile path per operation.
- Browser candidates are scored against real authenticated-run needs, not vibes.
- Identity/SaaS workflows have explicit browser objectives and evidence requirements.
- The operation board lets a model quickly answer "what should I do next and what is blocked?"

## Self-Review

- Spec coverage: Reflects Trevor's direction: permissive strategist, serious local authenticated browser, identity/SaaS through browser first, operation management, scorecard de-emphasized.
- Placeholder scan: No required step says "TBD"; live browser MCP selection is intentionally a bakeoff because the best choice depends on local behavior.
- Type consistency: Strategy memo, browser workbench, workflow registry, and board artifacts have stable file/module names before later tasks reference them.
