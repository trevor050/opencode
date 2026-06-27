#!/usr/bin/env bash
set -euo pipefail

WORKTREE="${ULMCODE_WORKTREE:-"$PWD"}"
OPERATION_ID="${ULMCODE_OPERATION_ID:-shared-browser}"
BROWSER_ROOT="${ULMCODE_BROWSER_ROOT:-"$WORKTREE/.ulmcode/operations/$OPERATION_ID/browser"}"
PROFILE_DIR="${ULMCODE_BROWSER_PROFILE_DIR:-"$BROWSER_ROOT/profile"}"
OUTPUT_DIR="${ULMCODE_BROWSER_OUTPUT_DIR:-"$BROWSER_ROOT/output"}"
DOWNLOADS_DIR="${ULMCODE_BROWSER_DOWNLOADS_DIR:-"$BROWSER_ROOT/downloads"}"
SCREENSHOTS_DIR="${ULMCODE_BROWSER_SCREENSHOTS_DIR:-"$BROWSER_ROOT/screenshots"}"

mkdir -p "$PROFILE_DIR" "$OUTPUT_DIR" "$DOWNLOADS_DIR" "$SCREENSHOTS_DIR"

exec npx -y @playwright/mcp@latest \
  --browser "${ULMCODE_BROWSER_CHANNEL:-chrome}" \
  --user-data-dir "$PROFILE_DIR" \
  --output-dir "$OUTPUT_DIR" \
  --output-mode file \
  --save-session
