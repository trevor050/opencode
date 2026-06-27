#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 -m json.tool "$PROFILE_DIR/opencode.json" >/dev/null
python3 -m json.tool "$PROFILE_DIR/package.json" >/dev/null
python3 -m json.tool "$PROFILE_DIR/tool-manifest.json" >/dev/null
python3 - "$PROFILE_DIR/opencode.json" <<'PY'
import json
import sys

opencode_path = sys.argv[1]
with open(opencode_path, "r", encoding="utf-8") as handle:
    opencode = json.load(handle)

if "provider" in opencode:
    raise SystemExit("profile must not configure non-OpenAI providers")
if "max_retries" in opencode:
    raise SystemExit("profile must not use unsupported max_retries config")

def assert_openai_route(route, label):
    if isinstance(route, str) and "/" in route and not route.startswith("openai/"):
        raise SystemExit(f"{label} must be an OpenAI route, got {route}")

assert_openai_route(opencode.get("model"), "opencode.model")
assert_openai_route(opencode.get("small_model"), "opencode.small_model")
for agent_id, agent in (opencode.get("agent") or {}).items():
    assert_openai_route((agent or {}).get("model"), f"opencode.agent.{agent_id}.model")
PY
find "$PROFILE_DIR/skills" -name SKILL.md -print | sort | while read -r skill; do
  grep -q '^---$' "$skill"
  grep -q '^name:' "$skill"
  grep -q '^description:' "$skill"
done
find "$PROFILE_DIR/commands" -name '*.md' -print | sort | while read -r command; do
  grep -q '^---$' "$command"
  grep -q '^description:' "$command"
done
grep -q 'ulmcode-runtime-guard.js' "$PROFILE_DIR/opencode.json"
if grep -q 'opencode-claude-code-plugin' "$PROFILE_DIR/package.json" || grep -q 'opencode-claude-code-plugin' "$PROFILE_DIR/opencode.json"; then
  echo "profile must not load the Claude Code bridge plugin" >&2
  exit 1
fi
if grep -q 'oh-my-openagent' "$PROFILE_DIR/package.json" || grep -q 'oh-my-opencode' "$PROFILE_DIR/package.json"; then
  echo "profile package must not install Oh My OpenAgent" >&2
  exit 1
fi
grep -q '"k12-long-report-production": "allow"' "$PROFILE_DIR/opencode.json"
if grep -q 'oh-my-openagent' "$PROFILE_DIR/opencode.json" || grep -q 'oh-my-opencode' "$PROFILE_DIR/opencode.json"; then
  echo "profile must not load Oh My OpenAgent; ULMCode owns its native agent surface" >&2
  exit 1
fi
grep -q 'finalHandoff: true' "$PROFILE_DIR/commands/ulm-final-handoff.md"
grep -q '"defaultSafetyMode": "non_destructive"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"destructiveSafetyMode": "interactive_destructive"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"commandProfiles"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"agent-browser"' "$PROFILE_DIR/tool-manifest.json"
grep -q '"action"' "$PROFILE_DIR/opencode.json"
grep -q '"websearch"' "$PROFILE_DIR/opencode.json"
grep -q 'web_search_exa' "$PROFILE_DIR/opencode.json"
grep -q '"playwright_persistent"' "$PROFILE_DIR/opencode.json"
grep -q '__ULMCODE_PROFILE_DIR__/mcp/playwright-persistent/run-stdio.sh' "$PROFILE_DIR/opencode.json"
grep -q '"pentestMCP"' "$PROFILE_DIR/opencode.json"
grep -q '__ULMCODE_PROFILE_DIR__/mcp/pentestMCP/run-stdio.sh' "$PROFILE_DIR/opencode.json"
grep -q '"companyscope"' "$PROFILE_DIR/opencode.json"
grep -q 'companyscope-mcp' "$PROFILE_DIR/opencode.json"
grep -q '"not_human_search"' "$PROFILE_DIR/opencode.json"
grep -q 'https://nothumansearch.ai/mcp' "$PROFILE_DIR/opencode.json"
grep -q '"openregistry"' "$PROFILE_DIR/opencode.json"
grep -q 'https://openregistry.sophymarine.com/mcp' "$PROFILE_DIR/opencode.json"
if grep -q 'ramgameer/pentest-mcp' "$PROFILE_DIR/opencode.json" || grep -q '"docker"' "$PROFILE_DIR/opencode.json"; then
  echo "profile pentestMCP must use the bundled local server, not Docker" >&2
  exit 1
fi
if grep -q '"vercel"' "$PROFILE_DIR/opencode.json" || grep -q '"context7"' "$PROFILE_DIR/opencode.json"; then
  echo "profile must not include unrelated Vercel/context7 MCP servers" >&2
  exit 1
fi
test -x "$PROFILE_DIR/mcp/pentestMCP/run-stdio.sh"
test -x "$PROFILE_DIR/mcp/playwright-persistent/run-stdio.sh"
test -f "$PROFILE_DIR/mcp/pentestMCP/pentestMCP.py"
grep -q 'bd1bf3ee442696da6eb6d8cd8b35a3e2ec59a76d' "$PROFILE_DIR/mcp/pentestMCP/pentestMCP.py"
test -f "$PROFILE_DIR/plugins/ulmcode-runtime-guard.js"
if [ -e "$PROFILE_DIR/plugins/vendor/opencode-claude-code-plugin-0.2.2" ]; then
  echo "profile must not vendor the Claude Code bridge plugin" >&2
  exit 1
fi
if [ -e "$PROFILE_DIR/plugins/vendor/oh-my-openagent-3.17.12" ]; then
  echo "profile must not vendor Oh My OpenAgent" >&2
  exit 1
fi
bun "$PROFILE_DIR/scripts/check-runtime-guard.mjs" "$PROFILE_DIR/plugins/ulmcode-runtime-guard.js" >/dev/null
sh -n "$PROFILE_DIR/scripts/install-profile.sh"
install_dir="$(mktemp -d)"
trap 'rm -rf "$install_dir"' EXIT
ULMCODE_CONFIG_DIR="$install_dir" "$PROFILE_DIR/scripts/install-profile.sh" >/dev/null
test -f "$install_dir/opencode.json"
test -f "$install_dir/ulmcode.json"
cmp -s "$install_dir/opencode.json" "$install_dir/ulmcode.json"
test -f "$install_dir/plugins/ulmcode-runtime-guard.js"
test -x "$install_dir/mcp/pentestMCP/run-stdio.sh"
test -f "$install_dir/mcp/pentestMCP/pentestMCP.py"
grep -q "$install_dir/mcp/pentestMCP/run-stdio.sh" "$install_dir/opencode.json"
if [ -e "$install_dir/plugins/vendor/opencode-claude-code-plugin-0.2.2" ]; then
  echo "profile installer must not copy the Claude Code bridge plugin" >&2
  exit 1
fi
if [ -e "$install_dir/plugins/vendor/oh-my-openagent-3.17.12" ]; then
  echo "profile installer must not copy Oh My OpenAgent" >&2
  exit 1
fi
test -f "$install_dir/tool-manifest.json"
grep -q '"commandProfiles"' "$install_dir/tool-manifest.json"
grep -q '"action"' "$install_dir/opencode.json"
grep -q '"websearch"' "$install_dir/opencode.json"
grep -q '"playwright_persistent"' "$install_dir/opencode.json"
grep -q "$install_dir/mcp/playwright-persistent/run-stdio.sh" "$install_dir/opencode.json"
grep -q '"companyscope"' "$install_dir/opencode.json"
grep -q '"not_human_search"' "$install_dir/opencode.json"
grep -q '"openregistry"' "$install_dir/opencode.json"
test -f "$install_dir/commands/ulm-resume.md"
if [ -e "$install_dir/.opencode/agents" ] || [ -e "$install_dir/.opencode/prompts" ] || [ -e "$install_dir/.opencode/commands" ]; then
  echo "profile installer must not copy personal/general OpenCode agents, prompts, or commands" >&2
  exit 1
fi
if [ -e "$install_dir/oh-my-openagent.jsonc" ] || [ -e "$install_dir/.opencode/oh-my-openagent.jsonc" ]; then
  echo "profile installer must not install Oh My OpenAgent config files" >&2
  exit 1
fi
sh -n "$install_dir/ulmcode-launch.sh"
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lifecycle-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-smoke >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-tui-launch-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-tui-launch -- --timeout-ms=30000 >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-profile-skills.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-skills >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-model-route-audit.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run ulm:model-route-audit -- --profile-only --installed-config-dir "$install_dir" --skip-launch-env --strict --json >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-tool-manifest.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-tool-manifest >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-replay.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-lab-target-smoke.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-lab-target >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-rebuild-audit.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-rebuild-audit >/dev/null)
test -f "$PROFILE_DIR/../../packages/opencode/script/ulm-harness-run.ts"
(cd "$PROFILE_DIR/../../packages/opencode" && bun run test:ulm-harness:fast >/dev/null)
