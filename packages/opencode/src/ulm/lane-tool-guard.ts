export function laneToolAllowed(toolID: string) {
  const allowed = process.env.ULMCODE_LANE_ALLOWED_TOOLS
  if (!allowed) return true
  return allowed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(toolID)
}

export function assertLaneToolAllowed(toolID: string) {
  if (laneToolAllowed(toolID)) return
  const laneID = process.env.ULMCODE_LANE_ID || "unknown"
  throw new Error(`Tool ${toolID} is not allowed for ULM lane ${laneID}`)
}
