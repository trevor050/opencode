#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$ROOT_DIR/../.." && pwd)"

OUT_DIR="${1:-$REPO_ROOT/dist}"
OUT_FILE="$OUT_DIR/ulmcode-skills.tar.gz"

PENTEST_SKILLS_SRC="$ROOT_DIR/skills/pentest-compact"
DEFENSIVE_SKILLS_SRC="$ROOT_DIR/skills/defensive-compact"

if [[ ! -d "$PENTEST_SKILLS_SRC" ]]; then
  echo "[error] missing skills source: $PENTEST_SKILLS_SRC" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

tmp="${TMPDIR:-/tmp}/ulmcode_skills_bundle_$$"
rm -rf "$tmp"
mkdir -p "$tmp/skills"

cp -R "$PENTEST_SKILLS_SRC" "$tmp/skills/pentest-compact"
if [[ -d "$DEFENSIVE_SKILLS_SRC" ]]; then
  cp -R "$DEFENSIVE_SKILLS_SRC" "$tmp/skills/defensive-compact"
fi

tar -czf "$OUT_FILE" -C "$tmp" skills
rm -rf "$tmp"

echo "[ok] wrote $OUT_FILE"

