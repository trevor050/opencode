import { afterEach, describe, expect, test } from "bun:test"
import { assertLaneToolAllowed, laneToolAllowed, laneToolVisible } from "@/ulm/lane-tool-guard"

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

  test("treats lane allowlists as advisory instead of hard tool jails", () => {
    process.env.ULMCODE_LANE_ID = "operator_summary"
    process.env.ULMCODE_LANE_ALLOWED_TOOLS = "runtime_summary, eval_scorecard, operation_audit, operation_checkpoint, operation_run"

    expect(laneToolAllowed("runtime_summary")).toBe(true)
    expect(laneToolAllowed("bash")).toBe(true)
    expect(laneToolAllowed("write")).toBe(true)
    expect(laneToolVisible("read")).toBe(true)
    expect(laneToolVisible("grep")).toBe(true)
    expect(laneToolVisible("glob")).toBe(true)
    expect(laneToolVisible("playwright_browser_wait_for")).toBe(true)
    expect(laneToolVisible("browser_evidence")).toBe(true)
    expect(() => assertLaneToolAllowed("bash")).not.toThrow()
  })
})
