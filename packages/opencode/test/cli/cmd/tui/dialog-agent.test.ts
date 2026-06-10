import { describe, expect, test } from "bun:test"
import { agentDialogDescription } from "@opencode-ai/tui/component/dialog-agent"

describe("agentDialogDescription", () => {
  test("labels native and custom agents without leaking long descriptions", () => {
    expect(agentDialogDescription({ native: true })).toBe("native")
    expect(agentDialogDescription({ native: false })).toBe("custom")
    expect(agentDialogDescription({})).toBe("custom")
  })
})
