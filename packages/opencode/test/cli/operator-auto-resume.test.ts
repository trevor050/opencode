import { describe, expect, test } from "bun:test"
import { resolveOperatorAutoResumeDeadline } from "@opencode-ai/tui/routes/session/operator-auto-resume"

describe("operator auto-resume countdown", () => {
  test("uses the optimistic keypress reset when it is later than the server timeout", () => {
    const now = Date.now()
    const timeoutAt = new Date(now + 120_000).toISOString()
    const resetTimeoutAt = new Date(now + 300_000).toISOString()

    expect(resolveOperatorAutoResumeDeadline({ timeoutAt, resetTimeoutAt })).toBe(resetTimeoutAt)
  })

  test("keeps the server timeout when it is later than the optimistic reset", () => {
    const now = Date.now()
    const timeoutAt = new Date(now + 300_000).toISOString()
    const resetTimeoutAt = new Date(now + 120_000).toISOString()

    expect(resolveOperatorAutoResumeDeadline({ timeoutAt, resetTimeoutAt })).toBe(timeoutAt)
  })
})
