import { dirname, join } from "node:path"

export type DesktopChannel = "dev" | "beta" | "prod"

export const APP_NAMES: Record<DesktopChannel, string> = {
  dev: "ULMCode Dev",
  beta: "ULMCode Beta",
  prod: "ULMCode Desktop",
}

export const APP_IDS: Record<DesktopChannel, string> = {
  dev: "ai.ulmcode.desktop.dev",
  beta: "ai.ulmcode.desktop.beta",
  prod: "ai.ulmcode.desktop",
}

export const PRIMARY_DESKTOP_PROTOCOL = "ulmcode"
export const LEGACY_DESKTOP_PROTOCOL = "opencode"
export const DESKTOP_PROTOCOLS = [PRIMARY_DESKTOP_PROTOCOL, LEGACY_DESKTOP_PROTOCOL]
export const SETTINGS_STORE = "ulmcode.settings"
export const WINDOW_TITLE = "ULMCode Desktop"
export const DEFAULT_MCP_ALLOWLIST = "websearch,agent_browser,playwright,pentestMCP"
export const DEFAULT_ULM_OPERATIONS_DIR_NAME = "ulmcode"

export function resolveDesktopChannel(raw?: string): DesktopChannel {
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

export function getDesktopAppName(raw?: string) {
  return APP_NAMES[resolveDesktopChannel(raw)]
}

export function getDesktopAppId(raw?: string) {
  return APP_IDS[resolveDesktopChannel(raw)]
}

export function isDesktopDeepLink(value: string) {
  return DESKTOP_PROTOCOLS.some((protocol) => value.startsWith(`${protocol}://`))
}

export function getSidecarEnvDefaults(home: string, env: Record<string, string | undefined>) {
  const configDir = env.OPENCODE_CONFIG_DIR ?? join(home, ".config", "ulmcode")
  const xdgConfigHome = env.XDG_CONFIG_HOME ?? join(home, ".config", "ulmcode-xdg")
  const xdgDataHome = env.XDG_DATA_HOME ?? join(home, ".local", "share", "ulmcode")
  const xdgStateHome = env.XDG_STATE_HOME ?? join(home, ".local", "state", "ulmcode")
  const xdgCacheHome = env.XDG_CACHE_HOME ?? join(home, ".cache", "ulmcode")
  return {
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: xdgStateHome,
    XDG_CACHE_HOME: xdgCacheHome,
    OPENCODE_APP_NAME: env.OPENCODE_APP_NAME ?? "ulmcode",
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_CONFIG: env.OPENCODE_CONFIG ?? join(configDir, "opencode.json"),
    OPENCODE_DB: env.OPENCODE_DB ?? "opencode-local.db",
    OPENCODE_DISABLE_PROJECT_CONFIG: env.OPENCODE_DISABLE_PROJECT_CONFIG ?? "1",
    OPENCODE_MCP_ALLOWLIST: env.OPENCODE_MCP_ALLOWLIST ?? DEFAULT_MCP_ALLOWLIST,
    OMO_DISABLE_POSTHOG: env.OMO_DISABLE_POSTHOG ?? "1",
  }
}

export function getUlmOperationsDirectory(
  home: string,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean = () => false,
) {
  const explicit = env.ULMCODE_OPERATIONS_DIR ?? env.ULMCODE_DEFAULT_DIRECTORY
  if (explicit) return explicit

  const candidates = [
    join(home, "codeprojects", "ULMcode", "opencode", "packages", "opencode"),
    join(home, "codeprojects", "ULMcode", "opencode"),
    join(home, "codeprojects", "ULMcode"),
    join(home, ".config", DEFAULT_ULM_OPERATIONS_DIR_NAME),
  ]

  const hasOperationsRoot = (candidate: string) => {
    let current = candidate
    while (true) {
      if (exists(join(current, ".ulmcode", "operations"))) return true
      const parent = dirname(current)
      if (parent === current) return false
      current = parent
    }
  }

  for (const candidate of candidates) {
    if (hasOperationsRoot(candidate)) return candidate
  }

  return join(home, ".config", DEFAULT_ULM_OPERATIONS_DIR_NAME)
}
