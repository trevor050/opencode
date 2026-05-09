import { describe, expect, test } from "bun:test"
import { canUseAgentForRun, isUlmDaemonLaneChild } from "@/cli/cmd/run/agent-policy"

describe("run agent policy", () => {
  test("keeps normal CLI runs from selecting subagents as primary agents", () => {
    expect(canUseAgentForRun({ mode: "subagent" })).toBe(false)
    expect(canUseAgentForRun({ mode: "primary" })).toBe(true)
    expect(canUseAgentForRun({ mode: "all" })).toBe(true)
  })

  test("allows daemon lane children to run the requested lane subagent directly", () => {
    expect(canUseAgentForRun({ mode: "subagent", ulmDaemonLaneChild: true })).toBe(true)
  })

  test("only detects ULM daemon children when a lane id is present", () => {
    expect(isUlmDaemonLaneChild({ ULMCODE_DAEMON_CHILD: "1", ULMCODE_LANE_ID: "network_discovery" })).toBe(true)
    expect(isUlmDaemonLaneChild({ ULMCODE_DAEMON_CHILD: "1" })).toBe(false)
    expect(isUlmDaemonLaneChild({ ULMCODE_LANE_ID: "network_discovery" })).toBe(false)
  })
})
