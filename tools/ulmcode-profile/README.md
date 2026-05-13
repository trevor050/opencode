# ULMCode Profile

This profile is the distributable ULMCode runtime layer for authorized K-12 security operations. It is intentionally smaller than a general OpenCode setup: ULMCode owns the operation ledger, findings, report quality tools, and core agents; external plugins are optional acceleration lanes.

## Install Locally

```sh
tools/ulmcode-profile/scripts/install-profile.sh
```

The installer writes `~/.config/ulmcode/opencode.json`, copies compact skills, ULM commands, vendored profile plugins, installs the profile npm manifest, removes stale Oh My OpenAgent config files, and creates `~/.config/ulmcode/ulmcode-launch.sh`.

`test-profile.sh` also runs the package-level ULM lifecycle smoke command, which creates a synthetic operation, records evidence/finding artifacts, enforces the validation stage gate, renders final HTML/PDF/manifest outputs, writes a runtime summary and operation audit, and requires final handoff lint to pass.

The verifier also runs `bun run --cwd packages/opencode test:ulm-skills` so compact skills and commands stay discoverable, placeholder-free, wired to durable ULM tools, and guarded against model-routing drift.

It also runs the bundled lab replay catalog, proving the manifest-driven replay harness can turn each lab scenario into final ULM artifacts with validation stage gates, final handoff, report-budget lint, outline-section lint, and operation audit gates. The same verifier starts and probes the bundled lab target services, then runs `test:ulm-rebuild-audit` to check that the rebuild evidence checklist is still wired.

## Runtime Defaults

- `pentest` is the default primary agent for operations.
- `action` is the focused primary mode for one-off fixes, quick research, and narrow security checks. The old `build` mode remains hidden as a compatibility alias.
- `gpt-5.4-mini-fast` handles quick recon and evidence normalization.
- `gpt-5.5` handles operation control, attack-path mapping, validation, reporting, report review, and hard reasoning lanes.
- Session retries are capped with `max_retries: 8` so a long unattended operation can ride out transient provider failures without spinning forever.
- Skills are allowlisted to the bundled K-12 pentest profile, including a dedicated long-report production skill for dense report drafting and sparse-report prevention.
- Websearch, Agent Browser, Playwright, and pentest MCP are configured. `websearch` uses the Exa remote MCP for current research. `agent_browser` is the preferred browser automation MCP; Playwright is the fallback.
- The model stack is intentionally OpenAI-only. The profile must not configure non-OpenAI model routes or local model providers.
- The profile includes a local `ulmcode-runtime-guard` server plugin that injects ULM operation-resume, background-task, report-lint, runtime-summary, and final-handoff guardrails into the runtime without depending on npm availability. It also bundles the local shell non-interactive strategy as a profile instruction so long unattended runs avoid prompt-prone shell commands.
- No third-party model-routing plugins are vendored or installed by the ULMCode profile.
- Bundled commands include `ulm-resume`, `ulm-final-handoff`, and `ulm-test-plan`. General personal OpenCode agents, prompts, Feature Forge, and Sisyphus/OpenCode-Builder surfaces must stay out of the installed ULM profile.

## Overnight Operation Flow

Start long work by creating an operation goal, running `tool_inventory`, writing the duration-aware `operation_plan`, and scheduling lanes with `operation_schedule`. For a real overnight run, hand off to the daemon instead of keeping a foreground chat command alive:

```sh
bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --duration-hours 20 --detach --json
```

Inspect and recover with:

```sh
opencode ulm status <operationID>
opencode ulm resume <operationID> --stale-after-minutes 30
opencode ulm audit <operationID> --format json
```

Use `runtime_scheduler` for short local cycles, `runtime_daemon` for wall-clock ownership, and `operation_supervise` whenever progress stalls, before compaction, and before final handoff.

Readiness commands:

```sh
bun run --cwd packages/opencode ulm:burnin <operationID> --target-hours 20 --json
bun run --cwd packages/opencode ulm:literal-run-readiness <operationID> --strict --json
```

Burn-in is accelerated readiness evidence. Literal readiness only passes with actual daemon heartbeat/log proof.

## First School Laptop Run

Use the `school-laptop-48h` operation template for the first Surface/private-Wi-Fi school assessment. It creates a 48-hour unattended plan, supervisor lane, aggressive bounded scan profile, protected finalization window, and a 75-page report outline.

Before leaving the laptop unattended:

```sh
bun run --cwd packages/opencode ulm:first-run-rehearsal school-surface-rehearsal --canary-target-seconds 120 --strict --json
```

That rehearsal creates the real `school-laptop-48h` operation shape, writes launchd/systemd supervisor files, prepares strict laptop preflight prerequisites with synthetic reviewed credential proof, runs the short wall-clock canary, and writes `scheduler/first-run-rehearsal.{json,md}`. Use it as the final dry run before creating the real operation.

Create the real launch packet after rehearsal, using the actual operation ID you want to leave on the laptop:

```sh
bun run --cwd packages/opencode ulm:first-run-launch-packet school-surface-real --strict --json
```

That writes `scheduler/first-run-launch-packet.{json,md}`, creates the selected `school-laptop-48h` operation, writes launchd/systemd supervisor files, and prints the exact credential-review, canary, preflight, daemon, readiness, and objective-audit commands. It intentionally stays `preflight_required`; it is not readiness proof.

For a lower-level daemon-only canary:

```sh
bun run --cwd packages/opencode ulm:wall-clock-canary school-surface-canary --target-seconds 120 --strict --json
```

That canary is intentionally short but literal wall-clock proof. It creates a harmless synthetic operation, runs the daemon for real seconds, writes daemon heartbeat/log artifacts, and audits them with `ulm:literal-run-readiness`. For a selected first run, use the launch packet's `<operationID>-canary` command so the objective audit can bind the canary proof to the real operation.

The canary command's `--json` output is compact by default. Use `--full --json` only when debugging the full scheduler cycle object.

Before calling the whole system ready, run the prompt-to-artifact audit:

```sh
bun run --cwd packages/opencode ulm:first-run-objective-audit --json
```

It maps the launch prompt requirements to concrete files/gates and should stay `incomplete` until the recovered laptop has a selected 120-second canary proof plus a passing 48-hour `literal-run-readiness.json` for the real operation.

```sh
bun run --cwd packages/opencode ulm:laptop-preflight <operationID> --prepare --strict --confirm power --confirm sleep --confirm wifi --confirm scope --confirm clock --json
```

That preflight writes `scheduler/laptop-preflight.json` and blocks launch until the supervisor handoff, tool/model preflight, long-report outline, credential-vault review, and operator confirmations are present. Do not use `--skip-laptop-preflight` for the real run.

Check the credential gate explicitly after the vault Submit to agent button is clicked:

```sh
bun run --cwd packages/opencode ulm:credential-review <operationID> --strict --json
```

That writes `scheduler/credential-review.{json,md}` and fails strict mode for credentialed plans until the vault review has a non-empty submitted redacted credential index.

Run the launch readiness gate after preflight is ready and immediately before starting the 48-hour daemon:

```sh
bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id <operationID> --require-launch-ready --json
```

It should exit nonzero unless the selected first-run audit says `launchDecision.canStartDaemon` is true. Start the daemon only after that `launchReadiness` gate passes:

```sh
bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --duration-hours 48 --detach --json
```

Runtime daemon `--json` output is compact by default. Use `--full --json` only when debugging scheduler cycle internals.

For an OS-owned run, generate launchd/systemd files instead:

```sh
bun run --cwd packages/opencode ulm:runtime-daemon <operationID> --duration-hours 48 --supervisor all --json
```

During the protected finalization window, roughly the last four hours of the 48-hour template, `operation_supervise` should switch to report closeout and `runtime_scheduler` should launch the report lane instead of broad new discovery. After the laptop is recovered, run:

```sh
bun run --cwd packages/opencode ulm:literal-run-readiness <operationID> --strict --json
```

For manual live behavior checks before the real run, prefer the bounded probe wrapper:

```sh
bun run --cwd packages/opencode ulm:behavior-probe -- --scenario tools/ulmcode-behavior-scenarios/k12-exploit-chain-safety.json --output .artifacts/ulm-behavior-watch/k12-exploit-chain-safety --timeout-ms 120000
```

For real tool-use checks, use the live operation probe instead. It enables ULM tools in an isolated workspace, captures JSONL, and grades both tool calls and `.ulmcode` operation artifacts:

```sh
bun run --cwd packages/opencode ulm:live-operation-probe -- --scenario tools/ulmcode-live-scenarios/privileged-access-report-drill.json --output .artifacts/ulm-live-operation-probes/privileged-access-report-drill --timeout-ms 180000 --json
```
