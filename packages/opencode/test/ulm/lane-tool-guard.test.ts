import { afterEach, describe, expect, test } from "bun:test"
import { assertLaneToolAllowed, laneToolAllowed } from "@/ulm/lane-tool-guard"

const previousAllowedTools = process.env.ULMCODE_LANE_ALLOWED_TOOLS
const previousLaneID = process.env.ULMCODE_LANE_ID

afterEach(() => {
  if (previousAllowedTools === undefined) delete process.env.ULMCODE_LANE_ALLOWED_TOOLS
  else process.env.ULMCODE_LANE_ALLOWED_TOOLS = previousAllowedTools
  if (previousLaneID === undefined) delete process.env.ULMCODE_LANE_ID
  else process.env.ULMCODE_LANE_ID = previousLaneID
})

describe("ULM lane tool guard", () => {
  test("allows every tool when no lane allowlist is present", () => {
    delete process.env.ULMCODE_LANE_ALLOWED_TOOLS
    expect(laneToolAllowed("operation_recover")).toBe(true)
  })

  test("blocks tools outside a daemon lane allowlist", () => {
    process.env.ULMCODE_LANE_ID = "operator_summary"
    process.env.ULMCODE_LANE_ALLOWED_TOOLS = "runtime_summary, eval_scorecard, operation_audit, operation_checkpoint, operation_run"

    expect(laneToolAllowed("runtime_summary")).toBe(true)
    expect(laneToolAllowed("bash")).toBe(false)
    expect(() => assertLaneToolAllowed("bash")).toThrow(
      "Tool bash is not allowed for ULM lane operator_summary",
    )
  })
})
