export function isUlmDirectory(directory: string | undefined) {
  if (!directory) return false
  return (
    directory.includes("/ULMcode/") ||
    directory.endsWith("/ULMcode") ||
    directory.includes("/worktrees/opencode/ulmcode") ||
    directory.includes("/.config/ulmcode") ||
    directory.endsWith("/.local/share/ulmcode")
  )
}

export function isUlmOperationsDirectory(directory: string | undefined) {
  if (!directory) return false
  return directory.includes("/.config/ulmcode") || directory.endsWith("/.local/share/ulmcode")
}

export function ulmWorkspaceLabel(directory: string | undefined) {
  if (!isUlmDirectory(directory)) return undefined
  if (isUlmOperationsDirectory(directory)) return "OPS"
  if (directory?.endsWith("/packages/opencode")) return "APP"
  if (directory?.endsWith("/opencode")) return "SRC"
  return "ULM"
}
