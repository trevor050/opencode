# ULMCode Agent Notes

Last updated: 2026-05-18

This file is for future agents working in this repo. Keep notes that prevent real rediscovery or dangerous regressions. Delete trivia, stale status, and one-off postmortems once tests or source code already carry the lesson.

## Branch Names

Use a short branch name of at most three words, separated by hyphens. Do not use slashes or type prefixes such as `feat/` or `fix/`.

Examples: `session-recovery`, `fix-scroll-state`, `regenerate-sdk`.

## Commits and PR Titles

Use conventional commit-style messages and PR titles: `type(scope): summary`.

Valid types are `feat`, `fix`, `docs`, `chore`, `refactor`, and `test`. Scopes are optional; use the affected package or area when helpful, e.g. `core`, `opencode`, `tui`, `app`, `desktop`, `sdk`, or `plugin`.

Examples: `fix(tui): simplify thinking toggle styling`, `docs: update contributing guide`, `chore(sdk): regenerate types`.

## Style Guide

## Repo Orientation

- Real repo/worktree root: `/Users/trevorrosato/codeprojects/ULMcode/opencode`. The outer `/Users/trevorrosato/codeprojects/ULMcode` folder is a wrapper with a `.git` pointer into this checkout, so git can appear to work from both places while tracked paths are relative to `opencode/`.
- ULMCode is a customized OpenCode fork for guided, authorized internal pentest orchestration: plan-first operation flow, durable artifacts, subagents, runtime supervision, and final report packages.
- Main implementation surfaces: `packages/opencode` for runtime/tools/agents, `packages/app` for the web UI, `packages/desktop` for Electron, `packages/llm` for provider/runtime LLM primitives, and `tools/ulmcode-profile` for the isolated pentest profile.
- Default upstream branch is `dev`; local `main` may not exist. Use `dev`, `origin/dev`, or the relevant worktree branch for comparisons.
- OpenCode upstream is mature. For ULM-specific bugs, suspect fork glue, profile wiring, desktop packaging, env defaults, operation tooling, or integration code before blaming upstream.
- Regenerate the JS SDK after changing HttpApi route surfaces such as `/ulm/operation` or `/api/model`: `./packages/sdk/js/script/build.ts`.

## Local Discipline

- Use parallel tool reads when useful, especially for repo searches and file inspection.
- Prefer Bun APIs in TS code, avoid `any`, rely on inference, prefer `const`, early returns, dot notation over unnecessary destructuring, and functional array helpers with type guards.
- Never alias imports or use star imports. If a namespace-style value is needed, import the module's exported namespace by name, for example `import { Project } from "@opencode-ai/core/project"`.
- Drizzle tables/columns use `snake_case`; generate migrations from `packages/opencode` with `bun run db generate --name <slug>`.
- Do not use `export namespace Foo`. Use flat exports plus `export * as Foo from "./foo"` or `export * as Foo from "."` in single-module `index.ts` files. Avoid multi-sibling barrels.
- Tests do not run from repo root. Run package commands from package dirs, for example `bun run --cwd packages/opencode test:ulm-smoke`.
- Always run `bun typecheck` from package directories, never raw `tsc`.

## ULM Operation Contract

- Canonical operation artifacts live under `.ulmcode/operations/<operation-id>/`. Durable operation truth belongs in operation tools/artifacts, not chat prose or `todowrite`.
- ULM operation context is session-scoped. A fresh chat must not inherit the newest active operation from disk. For named resume/continue requests, call `operation_resume` or `operation_status` for the exact operation before broad artifact reads.
- `operation_run` may omit `operationID` only when the current session is already bound to an active operation. Unbound chats must pass an explicit id and must not fall back to "latest".
- Start pentest work in plan mode. For 2h+ runs, write an approved Discovery Charter with `operation_plan` using `planningMode: "discovery-charter"` before the duration-aware final plan.
- An approved Discovery Charter without `plans/operation-plan.json` is a research state, not a scheduling state: `operation_next`/`runtime_scheduler` should launch the `research_charter` / `discovery_research` pass, record evidence/memory/checkpoints, then write the full duration-aware plan.
- Full plans must include ordered phases, success criteria, assumptions, subagent/no-subagent policy, and reporting closeout. The closeout contract is `report_writer` or report-writing lane, `report_render`, `runtime_summary`, strict `report_lint`, then `operation_audit`.
- Use `operation_schedule` for initial graph creation after the plan. During active runs, use `operation_run`, `operation_next`, `operation_resume`, `operation_recover`, `runtime_scheduler`, or `runtime_daemon`; do not reschedule just to escape a bad graph.
- `operation_memory` is operation-local continuity memory for compaction/restart/subagent handoff. Keep it concise and never treat it as a customer deliverable or cross-project memory.
- ULM shell guardrails are intentionally narrow. Bounded foreground shell commands, short active probes, and `.ulmcode/operations` artifact reads are allowed; broad/idle-prone/long commands should use `command_supervise`, background `task`, scheduler, or daemon. Keep hard safety on destructive external mutation and runaway foreground timeouts, not on command names like `nmap` appearing in paths.
- During pentest kickoff, the round-2-to-round-3 "fast network read" may use foreground shell for passive/local facts and tightly scoped active probes with short explicit timeouts. Use supervised/background execution for broad scans, templates, multi-host content discovery, or anything with uncertain runtime.
- Existing ULM chats are often rooted in `packages/opencode`, while operation artifacts live at repo-root `.ulmcode/operations`. `operationsRoot()` intentionally walks upward to find the nearest operation store. For nested synthetic worktrees in tests, pre-create `<synthetic>/.ulmcode/operations` to avoid mutating the parent operation.

## Credentials And Safety

- Authorized credentials belong in `operation_credentials`. Operation artifacts, reports, memory, command text, task metadata, and final deliverables should contain only redacted handles/ids/metadata.
- If kickoff says credentials are available, open the vault with `operation_credentials action: "open_vault"` for the active operation and wait for Submit to agent. Use `vault_url` only when a link-only response is intentional.
- `operation_credentials get` is the agent-facing redacted inspection path. Preserve structured metadata, notes, rules, target/url/tags, and masked raw-note previews.
- For programmatic/synthetic handles, use `operation_credentials submit_review` and verify with `review_status`; do not hand-edit `credentials/review-submission.json` to satisfy audits.
- K-12 person/org recon is professional and engagement-relevant only. Exclude private-life dossier material. Final client deliverables must stay sanitized; sensitive CEH leads belong in `deliverables/internal-review/sensitive-leads.*`.

## Reporting And Final Handoff

- `deliverables/final/` is the human handoff folder. It should be generated from canonical operation artifacts, not hand-patched after lint failures.
- If `report_lint`, `operation_audit`, or lane completion reports stale/missing final artifacts, fix source operation artifacts, rerun `report_render`, rerun `runtime_summary`, then retry the gate.
- Final handoff checks are intentionally strict: exact manifest paths, operation id matches, parseable JSON, styled HTML/PDF, stakeholder PDFs, runtime summary copy, evidence/finding reverse links, safe content, and non-stale audit ordering.
- Final gate knobs are floors, not a way to grade yourself easier. For 20h+ runs expect about 50+ outline/PDF pages; `school-laptop-48h` expects 75.
- Do not pass report gates with page padding or duplicate/overlapping findings. Expand with evidence-backed analysis, remediation worksheets, validation guidance, and useful appendices.
- Report quality includes visual/editorial quality, not just length. `report_writer` should avoid table spam, run a design pass on rendered `deliverables/final/report.html`, and expect cover/TOC/metric cards/finding cards/roadmap/evidence scan paths before handoff.
- Finding-section lint should match the actual finding title first and only match finding IDs on subordinate headings. A top-level report title or operation id can contain the finding id and must not satisfy the per-finding word-count gate.

## Scheduler, Lanes, And Long Runs

- `runtime_scheduler` owns unattended progress: it syncs background jobs, claims queued command units, advances graph state, and launches model lanes. Lane workers must not launch downstream lanes through scheduler/daemon/task/command tools.
- Package CLI daemon lanes pass `ULMCODE_LANE_ALLOWED_TOOLS`; in-app scheduler tasks pass `allowedTools`. Treat these as lane recommendations and positive child-tool hints, not a hard jail. Supervisors and lanes must retain `operation_next`/`operation_run`/`task`/`command_supervise`/recovery visibility so they can automatically kick work back off when an agent stops early.
- After supervised command artifacts exist, run `evidence_normalize` before validation/reporting. In internal-network graphs, evidence normalization precedes finding validation.
- 2h+ full plans must include `timeBudget.executionBlocks`. `operation_schedule` expands them into `planned_work_*` lanes before reporting, and those lanes carry a harness-owned wall-clock floor (`minRuntimeMinutes`) so a worker cannot instantly check off a 30-60 minute block just because it wrote a note.
- If all non-supervisor lanes complete while the active goal target window remains open, `operation_next` should return `expand_work`, not `stop` or passive `wait`. The scheduler/daemon must call `generateOperationBacklog` so long runs become a renewable campaign loop instead of a finite checklist.
- `operation_gap_audit` is the deterministic gap detector for that loop. It writes `plans/gap-audit.json`/`.md` with coverage gaps, queue pressure, validation debt, identity/attack-chain gaps, report-finalization risk, progress metrics, tiered coverage confidence, and a lightweight world model. Backlog expansion should run it before adding `planned_work_expansion_*` lanes.
- Use `operation_queue` and `operation_queue_next` to turn normalized leads into command work units. Preserve `workUnitID` when launching `command_supervise`.
- Blank content-discovery wordlists should normalize to `wordlists/common.txt`. Empty `wordlist` variables wedge scheduler-launched `command_supervise` before a background job binds, leaving claimed queue units with no job.
- Failed `command_supervise` jobs are lane evidence/limitations, not automatic lane failure. Empty `stderr.log` can be valid proof.
- Real long runs use `bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --detach --json` or OS supervisor files. `ulm:burnin` is accelerated readiness evidence, not wall-clock proof.
- Literal readiness is final handoff proof, not uptime. It needs daemon heartbeat/log continuity, work proof, tool/model preflight, final manifest, fresh passing `operation_audit`, and matching operation ids.

## School Laptop / First-Run Flow

- Use `operation_template template: "school-laptop-48h"` for the real Surface/private-Wi-Fi school run. It implies 48h unattended trust, bounded aggressive scanning, laptop preflight, identity/person lanes, Genesis/Google credential targets, and a 75-page report target.
- Before launch: run credential review, strict laptop preflight with `--prepare`, 120s wall-clock canary on the actual machine, launch packet, and objective audit with `--require-launch-ready`.
- Regenerate launch packets, preflight, and objective-audit artifacts when plan scope, credentials, target hours, runbooks, or packet commands change. Do not hand-edit stale artifacts around exact-token checks.
- Useful commands:
  - `bun run --cwd packages/opencode ulm:credential-review <operationID> --strict --json`
  - `bun run --cwd packages/opencode ulm:laptop-preflight <operationID> --prepare --strict --confirm power --confirm sleep --confirm wifi --confirm scope --confirm clock --json`
  - `bun run --cwd packages/opencode ulm:wall-clock-canary <canaryID> --target-seconds 120 --strict --json`
  - `bun run --cwd packages/opencode ulm:first-run-rehearsal <id> --canary-target-seconds 120 --strict --json`
  - `bun run --cwd packages/opencode ulm:first-run-launch-packet <operationID> --strict --json`
  - `bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id <operationID> --require-launch-ready --json`

## Isolated Profile And Models

- The isolated profile lives in `tools/ulmcode-profile`; validate with `tools/ulmcode-profile/test-profile.sh`.
- `ulm:model-route-audit` is the fail-closed gate for ULM routing. It checks the repo profile, installed `~/.config/ulmcode/opencode.json`, installed `~/.config/ulmcode/ulmcode.json`, launch env, and operation graph route audit. For 20h+ daemon runs, do not bypass it; the installed `opencode.json` and `ulmcode.json` mirror must stay byte-identical.
- ULM dev/profile launch must keep `OPENCODE_APP_NAME=ulmcode`, `OPENCODE_CONFIG_DIR=$HOME/.config/ulmcode`, `OPENCODE_CONFIG=$HOME/.config/ulmcode/opencode.json`, `OPENCODE_DISABLE_PROJECT_CONFIG=1`, and `OPENCODE_MCP_ALLOWLIST=websearch,agent_browser,playwright,pentestMCP`.
- The profile must not load personal/general OpenCode agents, prompts, Feature Forge, Sisyphus, OpenCode-Builder, or unrelated Vercel/context7 MCPs.
- The ULM profile must not install, vendor, or load the Claude Code bridge plugin. ULM model routing is OpenAI-only; do not add non-OpenAI model routes without an explicit product decision and new verification.
- Keep `tools/ulmcode-profile/tool-manifest.json` as the supervised command/tool catalog. Unattended profiles are `non_destructive`; destructive activity belongs in `interactive_destructive`.
- ULM profile defaults should use non-fast `openai/gpt-5.5` for primary/reasoning/reporting. Keep `openai/gpt-5.4-mini-fast` for small/recon/evidence lanes and do not let provider sorting prefer `gpt-5.5-fast` when both are listed.
- Native ULM operation tools must stay registered in `packages/opencode/src/tool/registry.ts`. Prompting the model to use operation tools that are present on disk but absent from the registry recreates the confusing failed-run behavior.
- Local macOS tool preflight expects Docker through Colima for ZAP. If Docker pulls fail with stale `docker-credential-desktop`, remove `credsStore: "desktop"` from `~/.docker/config.json`. `gowitness` may need `~/go/bin` symlinked into `~/.local/bin`.

## Desktop, TUI, And App UX

- ULMCode Desktop is a forked OpenCode Electron app, not a rewrite. Branding/env defaults live in `packages/desktop/src/main/branding.ts`; ULM app state lives in `packages/app/src/context/ulm.tsx`, `packages/app/src/context/ulm-state.ts`, and `packages/app/src/pages/operations.tsx`.
- Desktop UX is chat-first. Recent chats are the primary sidebar surface; operations attach as status/context and remain available through the operations console.
- Desktop session rows deep-link to `/<workspace>/session/<id>`, not the operations board. Rail/folder actions should open the bound operation root or final deliverables, never the ULMCode source tree.
- Slash commands are split by surface: `packages/app` commands do not affect the TUI. The TUI `/open-operation` command is native in `packages/opencode/src/cli/cmd/tui/routes/session/` and opens the current chat's bound operation root, while `/open` stays reserved for normal file/editor flows.
- Desktop and the `~/.local/bin/ulmcode` wrapper must share the same profile: `XDG_CONFIG_HOME=~/.config/ulmcode-xdg`, `XDG_DATA_HOME=~/.local/share/ulmcode`, `XDG_STATE_HOME=~/.local/state/ulmcode`, `XDG_CACHE_HOME=~/.cache/ulmcode`, `OPENCODE_APP_NAME=ulmcode`, `OPENCODE_CONFIG_DIR=~/.config/ulmcode`, `OPENCODE_CONFIG=~/.config/ulmcode/opencode.json`, and `OPENCODE_DB=opencode-local.db`.
- Desktop boot and CLI/server startup must use the configured `Database.Path` for SQLite migration sentinels. Hard-coding `opencode.db` makes ULM show migration/loading state repeatedly when the real DB is `opencode-local.db`.
- Every desktop UI change needs a real Computer Use pass before "done". If Electron dev shows a stale blank/loading compositor while CDP/DOM is hydrated, record that CUA was blocked and include secondary CDP/browser evidence.
- For local web UI verification, follow `packages/app/AGENTS.md`: backend on `4096`, app on `4444`, open `http://localhost:4444`.

## Runtime Gotchas Worth Keeping

- `operation.updated` publication is awaited after durable artifact writes so TUI dashboards and tests see fresh state.
- Operator auto-resume prompts must treat each keystroke/touch as a fresh 300s hold, independent of the original remaining timeout. Question touches also carry partial answers so unattended fallback can preserve answered questions and leave only unanswered prompts blank.
- `/global/event` has a shared 1024-event SSE replay ring; legacy Hono and Effect HttpApi global event routes must honor `Last-Event-ID`.
- Config caching tracks fingerprints for global and instance config. Keep `Config.invalidate()` usable without an instance context.
- `task` background jobs persist prompt/subagent/operation/worktree metadata and runtime usage snapshots. Preserve restart args for stale jobs.
- `operation_recover` depends on `command_supervise` metadata: `profileID`, variables, output prefix, manifest path, lane ID, and `workUnitID`.
- Upstream provider edge cases are deliberate in the OpenCode fork, but ULM profile routing still stays OpenAI-only. Preserve MCP transport reconnect retry, Codex OAuth refresh-token handling, and retryable OpenAI `server_is_overloaded`.
- Shell cleanup must not hang after orphaned pipe holders; process exit handling resolves on `exit` as well as `close`, and broad Node process-kill commands stay blocked.
- Package scripts that read/write `.ulmcode` must resolve the real repo worktree instead of raw `process.cwd()`, otherwise `bun run --cwd packages/opencode ...` writes under `packages/opencode/.ulmcode`.
- `opencode run --agent recon` style daemon child launches are allowed only with `ULMCODE_DAEMON_CHILD=1` and `ULMCODE_LANE_ID`; normal CLI runs should still reject subagents as primary agents.
- Invoking the package as `ulmcode` sets `OPENCODE_APP_NAME=ulmcode`; global paths must use the `ulmcode` app name.
- Credential materialization can cross the `opencode`/`ulmcode` profile boundary during supervised runs. Keep the fallback from the current storage service to the ULM profile secret store, and never debug credentials by echoing, catting, grepping, snapshotting, or otherwise printing raw env values. Treat usernames/credential handles from vault submissions as sensitive too; use redacted labels like `[REDACTED_ROUTER_USERNAME]`. Length-only checks are fine.
- Do not test common/default credential guesses during unattended security runs. "admin/password", vendor defaults, and tiny manual lists still count as credential guessing/password spraying unless the exact value came from the operator-approved vault for the current operation.

## Verification Shortlist

- Core typecheck: `bun typecheck` from the package you changed.
- ULM profile install/launch: `tools/ulmcode-profile/test-profile.sh` or `bun run --cwd packages/opencode test:ulm-tui-launch`.
- Profile skills and tool catalog: `bun run --cwd packages/opencode test:ulm-skills` and `bun run --cwd packages/opencode test:ulm-tool-manifest`.
- Synthetic lifecycle: `bun run --cwd packages/opencode test:ulm-smoke`.
- Lab replay and lab targets: `bun run --cwd packages/opencode test:ulm-lab` and `bun run --cwd packages/opencode test:ulm-lab-target`.
- Rebuild evidence checklist: `bun run --cwd packages/opencode test:ulm-rebuild-audit` or `bun run --cwd packages/opencode script/ulm-rebuild-audit.ts --json`.
- Harness scorecards: `bun run --cwd packages/opencode test:ulm-harness:fast`; first-run readiness may also need `test:ulm-harness:chaos`, `test:ulm-harness:full`, and `test:ulm-harness:overnight`.
- Live behavior probes are manual/live-eval tools, not default CI token furnaces:
  - `bun run --cwd packages/opencode ulm:behavior-probe -- --scenario <scenario.json> --output <prefix> --timeout-ms <ms>`
  - `bun run --cwd packages/opencode ulm:live-operation-probe -- --scenario <scenario.json> --output <prefix> --timeout-ms <ms> --json`

## What Not To Add Here

- Do not paste full changelogs, old branch archaeology, exact historical run counts, or "current selected run" state. Put those in operation artifacts, memory summaries, or PR notes.
- Do not duplicate package-specific guides unless the fact applies repo-wide. Keep detailed package guidance in the nearest `AGENTS.md`.
- Keep helpers close to the code they support, below the main export when that improves readability.
- Do not over-abstract simple expressions into many single-use helpers; extract only when it names a real concept like `requireConfig` or `readMetadata`.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

## V2 Session Core

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash activity recovery requires a separate explicit design before it may retry provider work.
- Keep delivery vocabulary explicit. Prompts steer by default and coalesce into the active activity at the next safe provider-turn boundary. Explicit `queue` inputs open FIFO future activities one at a time after the active activity settles.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.
