export const LANE_GUARDED_TOOLS = [
  "operation_recover",
  "runtime_scheduler",
  "runtime_daemon",
  "task",
  "command_supervise",
  "bash",
  "write",
  "glob",
  "browser_evidence",
  "playwright_browser_click",
  "playwright_browser_close",
  "playwright_browser_console_messages",
  "playwright_browser_drag",
  "playwright_browser_drop",
  "playwright_browser_evaluate",
  "playwright_browser_file_upload",
  "playwright_browser_fill_form",
  "playwright_browser_handle_dialog",
  "playwright_browser_hover",
  "playwright_browser_navigate",
  "playwright_browser_navigate_back",
  "playwright_browser_network_request",
  "playwright_browser_network_requests",
  "playwright_browser_press_key",
  "playwright_browser_resize",
  "playwright_browser_run_code_unsafe",
  "playwright_browser_select_option",
  "playwright_browser_snapshot",
  "playwright_browser_tabs",
  "playwright_browser_take_screenshot",
  "playwright_browser_type",
  "playwright_browser_wait_for",
] as const

const guarded = new Set<string>(LANE_GUARDED_TOOLS)

export function laneToolAllowed(toolID: string) {
  const allowed = process.env.ULMCODE_LANE_ALLOWED_TOOLS
  if (!allowed) return true
  return allowed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(toolID)
}

export function laneToolVisible(toolID: string) {
  if (!process.env.ULMCODE_LANE_ALLOWED_TOOLS) return true
  if (!guarded.has(toolID)) return true
  return laneToolAllowed(toolID)
}

export function assertLaneToolAllowed(toolID: string) {
  if (laneToolAllowed(toolID)) return
  const laneID = process.env.ULMCODE_LANE_ID || "unknown"
  throw new Error(`Tool ${toolID} is not allowed for ULM lane ${laneID}`)
}
