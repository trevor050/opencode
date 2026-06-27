import path from "path"
import { operationPath, slug } from "./artifact"

export type BrowserWorkbenchPreferredMcp = "playwright-persistent" | "browser-mcp" | "chrome-devtools"

export type BrowserWorkbenchConfig = {
  operationID: string
  profileDir: string
  screenshotsDir: string
  downloadsDir: string
  sessionLogPath: string
  preferredMcp: BrowserWorkbenchPreferredMcp
}

export type BrowserWorkbenchInput = {
  operationID: string
  profileDir?: string
  screenshotsDir?: string
  downloadsDir?: string
  sessionLogPath?: string
  preferredMcp?: BrowserWorkbenchPreferredMcp
}

function assertInside(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("browser workbench path must stay inside operation browser root")
  }
  return resolvedCandidate
}

export function browserWorkbenchConfig(worktree: string, input: BrowserWorkbenchInput): BrowserWorkbenchConfig {
  const operationID = slug(input.operationID, "operation")
  const browserRoot = path.join(operationPath(worktree, operationID), "browser")

  return {
    operationID,
    profileDir: assertInside(browserRoot, input.profileDir ?? path.join(browserRoot, "profile")),
    screenshotsDir: assertInside(browserRoot, input.screenshotsDir ?? path.join(browserRoot, "screenshots")),
    downloadsDir: assertInside(browserRoot, input.downloadsDir ?? path.join(browserRoot, "downloads")),
    sessionLogPath: assertInside(browserRoot, input.sessionLogPath ?? path.join(browserRoot, "session-log.jsonl")),
    preferredMcp: input.preferredMcp ?? "playwright-persistent",
  }
}
