import { describe, expect, test } from "bun:test"
import { buildSystemPrompts, resolveTools } from "../../src/session/llm"

const makeInput = (overrides: Record<string, boolean> | undefined) =>
  ({
    tools: {
      read: {},
      operation_resume: {},
      shell: {},
    },
    agent: {
      permission: [],
    },
    permission: [],
    user: {
      tools: overrides,
    },
  }) as unknown as Parameters<typeof resolveTools>[0]

describe("session.llm resolveTools", () => {
  test("honors a wildcard user tool deny", () => {
    expect(Object.keys(resolveTools(makeInput({ "*": false })))).toEqual([])
  })

  test("allows explicit tools through a wildcard deny", () => {
    expect(Object.keys(resolveTools(makeInput({ "*": false, read: true })))).toEqual(["read"])
  })
})

describe("session.llm buildSystemPrompts", () => {
  test("uses only the user system override for wildcard-denied plain chat", () => {
    const userSystem = "ULMCode Action chat override:\n- This is plain operator chat."
    const system = buildSystemPrompts({
      agentPrompt: "Pentest agent prompt with operation instructions",
      providerPrompt: ["Provider prompt"],
      system: ["<ulm_operation_context>operation details</ulm_operation_context>", "Runtime instructions"],
      userSystem,
      userTools: { "*": false },
    })

    expect(system).toEqual([userSystem])
  })

  test("uses a plain fallback system for wildcard-denied chat without a user override", () => {
    const system = buildSystemPrompts({
      agentPrompt: "Pentest agent prompt with operation instructions",
      providerPrompt: ["Provider prompt"],
      system: ["<ulm_operation_context>operation details</ulm_operation_context>", "Runtime instructions"],
      userTools: { "*": false },
    })

    expect(system).toHaveLength(1)
    expect(system[0]).toContain("Plain chat mode")
    expect(system[0]).not.toContain("operation details")
  })
})
