import { describe, expect, test } from "bun:test"
import {
  commandArgValues,
  commandKeyValueValues,
  commandTextTokens,
  hasExactCommandArg,
  hasExactCommandArgValues,
  hasExactCommandFlag,
  hasExactCommandKeyValue,
  hasExactCommandPrefix,
  hasExactCommandToken,
  hasExactCommandTokenAfterPrefix,
  hasExactCommandTokens,
  hasOnlyExactCommandArgValues,
  hasOnlyExactCommandKeyValue,
  hasShellControlOperator,
} from "@/ulm/command-text"

describe("ULM command text helpers", () => {
  test("matches exact operation tokens without accepting suffix collisions", () => {
    const command =
      "bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id first-real-school-laptop-run-copy --json"

    expect(hasExactCommandToken(command, "first-real-school-laptop-run")).toBe(false)
    expect(hasExactCommandArg(command, "--operation-id", "first-real-school-laptop-run")).toBe(false)
    expect(hasExactCommandArg(command, "--operation-id", "first-real-school-laptop-run-copy")).toBe(true)
  })

  test("ignores command flags and args that only appear in shell comments", () => {
    const command =
      "bun run --cwd packages/opencode ulm:laptop-preflight first-real-school-laptop-run --prepare # --strict --confirm power"

    expect(commandTextTokens(command)).not.toContain("--strict")
    expect(hasExactCommandFlag(command, "--strict")).toBe(false)
    expect(hasExactCommandArg(command, "--confirm", "power")).toBe(false)
  })

  test("collects repeated arg values and requires every expected value", () => {
    const command =
      "bun run --cwd packages/opencode ulm:laptop-preflight first-real-school-laptop-run --confirm power --confirm sleep --confirm wifi"

    expect(commandArgValues(command, "--confirm")).toEqual(["power", "sleep", "wifi"])
    expect(hasExactCommandArgValues(command, "--confirm", ["power", "sleep"])).toBe(true)
    expect(hasExactCommandArgValues(command, "--confirm", ["power", "scope"])).toBe(false)
  })

  test("requires exact arg sets when launch commands must be unambiguous", () => {
    const command =
      "bun run --cwd packages/opencode ulm:laptop-preflight first-real-school-laptop-run --confirm power --confirm sleep --confirm wifi"
    const duplicated =
      "bun run --cwd packages/opencode ulm:first-run-objective-audit --operation-id first-real-school-laptop-run --operation-id other-run --json"

    expect(hasOnlyExactCommandArgValues(command, "--confirm", ["power", "sleep", "wifi"])).toBe(true)
    expect(hasOnlyExactCommandArgValues(command, "--confirm", ["power", "sleep"])).toBe(false)
    expect(hasOnlyExactCommandArgValues(duplicated, "--operation-id", ["first-real-school-laptop-run"])).toBe(false)
  })

  test("matches key-value tokens exactly", () => {
    const command = "operation_credentials action=open_vault operationID=first-real-school-laptop-run-copy"

    expect(commandKeyValueValues(command, "operationID")).toEqual(["first-real-school-laptop-run-copy"])
    expect(hasExactCommandKeyValue(command, "operationID", "first-real-school-laptop-run")).toBe(false)
    expect(hasExactCommandKeyValue(command, "operationID", "first-real-school-laptop-run-copy")).toBe(true)
  })

  test("requires a single exact key-value token when launch commands must be unambiguous", () => {
    const direct = "operation_credentials action=open_vault operationID=first-real-school-laptop-run"
    const ambiguous = "operation_credentials action=open_vault operationID=first-real-school-laptop-run operationID=other-run"

    expect(hasOnlyExactCommandKeyValue(direct, "operationID", "first-real-school-laptop-run")).toBe(true)
    expect(hasOnlyExactCommandKeyValue(ambiguous, "operationID", "first-real-school-laptop-run")).toBe(false)
  })

  test("matches exact command prefixes without accepting wrapper commands", () => {
    const direct = "operation_credentials action=open_vault operationID=first-real-school-laptop-run"
    const wrapped = "echo operation_credentials action=open_vault operationID=first-real-school-laptop-run"

    expect(hasExactCommandPrefix(direct, ["operation_credentials", "action=open_vault"])).toBe(true)
    expect(hasExactCommandPrefix(wrapped, ["operation_credentials", "action=open_vault"])).toBe(false)
  })

  test("matches exact full command tokens without accepting trailing extras", () => {
    const direct = "bun run --cwd packages/opencode ulm:literal-run-readiness first-real-school-laptop-run --strict --json"
    const extra =
      "bun run --cwd packages/opencode ulm:literal-run-readiness first-real-school-laptop-run --strict --json --future true"
    const expected = [
      "bun",
      "run",
      "--cwd",
      "packages/opencode",
      "ulm:literal-run-readiness",
      "first-real-school-laptop-run",
      "--strict",
      "--json",
    ]

    expect(hasExactCommandTokens(direct, expected)).toBe(true)
    expect(hasExactCommandTokens(extra, expected)).toBe(false)
  })

  test("matches the exact positional token after a command prefix", () => {
    const direct =
      "bun run --cwd packages/opencode ulm:runtime-daemon first-real-school-laptop-run --duration-hours 48 --json"
    const smuggled =
      "bun run --cwd packages/opencode ulm:runtime-daemon other-run --note first-real-school-laptop-run --duration-hours 48 --json"
    const prefix = ["bun", "run", "--cwd", "packages/opencode", "ulm:runtime-daemon"]

    expect(hasExactCommandTokenAfterPrefix(direct, prefix, "first-real-school-laptop-run")).toBe(true)
    expect(hasExactCommandTokenAfterPrefix(smuggled, prefix, "first-real-school-laptop-run")).toBe(false)
  })

  test("detects shell control operators outside comments", () => {
    const chained = "bun run --cwd packages/opencode ulm:runtime-daemon first-real-school-laptop-run --json && echo leaked"
    const commented =
      "bun run --cwd packages/opencode ulm:runtime-daemon first-real-school-laptop-run --json # && echo ignored"

    expect(hasShellControlOperator(chained)).toBe(true)
    expect(hasShellControlOperator(commented)).toBe(false)
  })
})
