type RunAgentMode = "all" | "primary" | "subagent"

export function isUlmDaemonLaneChild(env: NodeJS.ProcessEnv = process.env) {
  return env.ULMCODE_DAEMON_CHILD === "1" && !!env.ULMCODE_LANE_ID
}

export function canUseAgentForRun(input: { mode: RunAgentMode; ulmDaemonLaneChild?: boolean }) {
  if (input.mode === "subagent" && input.ulmDaemonLaneChild) return true
  if (input.mode === "subagent") return false
  return true
}
