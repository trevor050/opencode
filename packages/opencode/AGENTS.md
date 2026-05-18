# packages/opencode Agent Notes

Last updated: 2026-05-18

This package is the core ULMCode/OpenCode runtime: session loop, agents, tools, operation artifacts, scheduler/daemon scripts, provider catalog, server routes, and most tests. The repo-root `AGENTS.md` carries the product-level ULM operation contract; this file keeps package-local coding and runtime landmines.

## Run From Here

- Run package tests from `packages/opencode`, or use `bun run --cwd packages/opencode <script>` from repo root. The repo root has a guard against test execution.
- Typecheck with `bun typecheck` from this package. Do not call `tsc` directly.
- Prefer focused tests near the changed subsystem, then add ULM gates only when the change touches runtime behavior, profile wiring, scheduler/reporting, or route surfaces.
- Regenerate the JS SDK after changing HttpApi surfaces exposed to clients: `./packages/sdk/js/script/build.ts` from repo root.

## Code Shape

- Prefer Bun APIs such as `Bun.file()` and `Bun.write()` when they match the job.
- Avoid `any`, unnecessary explicit annotations, unnecessary destructuring, and mutable `let` variables. Use early returns instead of `else`.
- Prefer functional array methods with type guards when filtering narrows downstream types.
- Keep small values inline when they are used once; do not create path/string temporaries just to immediately consume them.
- Drizzle schema and migrations live in `packages/core`; this package uses the core-applied database layer. Keep schema fields snake_case.
- Do not use `export namespace Foo`. Use flat top-level exports plus `export * as Foo from "./foo"` at the bottom, or `export * as Foo from "."` for a single-module `index.ts`.
- For multi-sibling directories such as `src/session` or `src/config`, keep sibling modules independent and avoid barrel `index.ts` files that force every sibling to load.

## Effect Rules

- Use `Effect.gen(function* () { ... })` for composition and `Effect.fn("Domain.method")` / `Effect.fnUntraced` for named helpers.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)` over `yield* Effect.fail(new MyError(...))`.
- Use `Effect.void`, `DateTime.nowAsDate`, `Schema.Class`, branded schemas, `Schema.TaggedErrorClass`, and `Schema.Defect` where they fit.
- Prefer Effect services inside effectified code: `FileSystem.FileSystem`, `ChildProcessSpawner.ChildProcessSpawner`, `HttpClient.HttpClient`, `Path.Path`, `Config`, `Clock`, and `DateTime`.
- Use `makeRuntime` from `src/effect/run-service.ts` for services. Use `InstanceState` when state is per-directory/project and needs scoped cleanup.
- Do the initialization work directly inside `InstanceState.make`; avoid extra `started` flags, `ensure()` wrappers, or hidden fibers. Use `Effect.addFinalizer`, `Effect.acquireRelease`, and `Effect.forkScoped` inside the closure for cleanup and background stream consumers.
- To make service `init()` non-blocking, fork `InstanceState.get(state)` at the caller, not inside the `InstanceState.make` closure.
- Effect v4 beta does not have `Effect.fork` / `Effect.forkDaemon`; use `Effect.forkIn(scope)`.
- Use `Effect.cached` for concurrent in-flight dedupe instead of storing `Fiber | undefined` or `Promise | undefined` by hand.
- Use `Instance.bind(fn)` for native callbacks that need `Instance.directory` context, such as `@parcel/watcher`, `node-pty`, or native `fs.watch`.

## Runtime Surfaces

- ULM tools and artifact writers should write under repo-root `.ulmcode/operations/<id>`, not `packages/opencode/.ulmcode`. Package scripts must resolve the real repo worktree instead of trusting `process.cwd()`.
- Operation session binding is explicit. New chats cannot silently bind to the newest operation on disk, and `operation_run` may omit `operationID` only when the session is already bound.
- `operationsRoot()` intentionally walks upward because chats often start inside `packages/opencode` while operation artifacts live at repo root. Tests with nested synthetic worktrees must create their own `.ulmcode/operations` root before writing artifacts.
- Raw credential guardrails belong at durable writer boundaries: goals, plans, checkpoints, evidence, findings, profile artifacts, graph/run/queue/runtime artifacts, report outputs, eval scorecards, operation memory, command supervision, and task prompts must persist only redacted handles/ids.
- `operation.updated` publication is awaited after durable writes. Keep that ordering so TUI dashboards and tests see fresh disk-backed state.
- Package CLI daemon child lanes may pass subagent names through `opencode run --agent` only when `ULMCODE_DAEMON_CHILD=1` and `ULMCODE_LANE_ID` are set. Normal CLI runs should still reject subagents as primary agents.
- Background `task` metadata is persisted under `background_job/<task_id>` and must keep prompt/subagent/operation/worktree metadata, restart args, and runtime usage snapshots for stale-job recovery.
- `operation_recover` depends on `command_supervise` metadata: `profileID`, variables, output prefix, manifest path, lane ID, and `workUnitID`.
- Explicit `task_id` resumes for background tasks should return the existing running/stale task status, not throw and force the model into duplicate recovery tasks.
- Blocked lanes are recoverable state. Supervisor decisions should route blocked/stale/failed lane work to `operation_resume`/`operation_recover`; generic active-run continuation should point models at `runtime_scheduler`/`runtime_daemon`, not only `operation_run`.
- Native ULM tools must be imported and registered in `src/tool/registry.ts`, not merely present as files under `src/tool`. Initialize tool handles outside the `InstanceState.make` closure so extra service requirements do not leak into the scoped state effect.
- `tool-manifest` command templates allow safe multi-token target/Args fragments such as `-iL evidence/raw/hosts.txt`. Keep shell metacharacters quoted, but do not collapse safe nmap option fragments into one quoted argv token.
- `evidence_normalize` should prefer explicit artifact paths and tolerate concurrently written or malformed command-plan JSON. A bad command plan must not block normalization of a valid explicit artifact.

## Provider And Process Gotchas

- Anthropic/Vertex-Anthropic normalization treats client `tool-call` and `tool-result` as one group. Do not split them when moving trailing text.
- Provider-executed/server-side tool pairs must remain assistant content.
- Moonshot/Kimi schema normalization strips `$ref` siblings, cleans tuple items, and flattens deeply nested schemas near provider depth limits.
- MCP dynamic tools retry once after transport/session errors by reconnecting; auth/business errors should surface directly.
- Codex/OpenAI `server_is_overloaded` is retryable provider overload. Codex OAuth refresh may omit a new refresh token; preserve the existing one on refresh while keeping first-login strict.
- OpenAI `promptCacheKey` is intentionally stable by app/model, not session ID, so new ULMCode chats can reuse cached static prefixes. For OpenAI `gpt-5.5*`, also preserve `promptCacheRetention: "24h"`; OpenAI does not use normal in-memory cache retention for that family. Do not switch either back unless measuring a real cache-routing regression.
- Core process handling resolves exit state on `exit` as well as `close`, and SIGKILL escalation must not wait forever for a close event.
- Broad Node process-kill commands stay blocked because OpenCode itself runs on Node; PID-scoped kills and project-scoped stop commands can remain allowed.

## Server Routes

- Legacy Hono instance routes and Effect HttpApi routes under `src/server/routes/instance/httpapi` must stay behaviorally aligned: request shape, response shape, status codes, workspace/instance routing, and SDK-visible schemas.
- For normal HttpApi endpoints, use `HttpApiBuilder.group(...)`, yield stable services once while building the handler layer, and close over them in endpoint implementations.
- For SSE in HttpApi, return `HttpServerResponse.stream(...)` and mark success with `HttpApiSchema.asText({ contentType: "text/event-stream" })`.
- Use raw `HttpRouter.use(...)` only for WebSocket upgrades or catch-all routes that do not fit the request/response model.
- Avoid rebuilding layers inside request handlers. Provide stable layers at the application/layer boundary; use request-derived context only for `WorkspaceRouteContext`, `InstanceRef`, or `WorkspaceRef`.
- Public JSON errors should be explicit `Schema.ErrorClass` contracts declared on each endpoint.
- `/global/event` uses a shared 1024-event SSE replay ring; both legacy and HttpApi routes must honor `Last-Event-ID`.

## Tests

- For Effect tests, use `testEffect(...)`; keep test bodies inside `Effect.gen(function* () { ... })`.
- Use `it.effect(...)` for TestClock/TestConsole, `it.live(...)` for real time/filesystem/git/processes/locks, and `it.instance(...)` when a scoped temp instance is needed.
- Prefer helpers from `test/fixture/fixture.ts`: `tmpdir`, `tmpdirScoped`, `provideInstance`, `provideTmpdirInstance`, and `provideTmpdirServer`.
- Use `Layer.mock` for small service overrides instead of hand-rolling full service objects with placeholder methods.
- Server tests should prefer focused middleware/probe routes over full API trees. Use `NodeHttpServer.layerTest`, relative `HttpClient` requests, scoped layers for mutable state, and `tmpdirScoped({ git: true })` plus `Project.use.fromDirectory(dir)` for project-backed requests.

## ULM Verification Anchors

- `bun run --cwd packages/opencode test:ulm-tui-launch` or `tools/ulmcode-profile/test-profile.sh` for profile/TUI launch checks.
- `bun run --cwd packages/opencode test:ulm-skills` for bundled skills and command drift.
- `bun run --cwd packages/opencode test:ulm-tool-manifest` for supervised command/tool catalog rules.
- `bun run --cwd packages/opencode test:ulm-smoke` for the synthetic ULM lifecycle.
- `bun run --cwd packages/opencode test:ulm-lab` and `test:ulm-lab-target` for lab replay and bundled target probes.
- `bun run --cwd packages/opencode test:ulm-rebuild-audit` for the rebuild evidence checklist.
- `bun run --cwd packages/opencode test:ulm-harness:fast` for harness scorecards; use `:chaos`, `:full`, and `:overnight` when refreshing first-run readiness evidence.
