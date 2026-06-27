import fs from "fs/promises"
import os from "os"
import path from "path"
import { operationPath, slug } from "./artifact"
import { writeRuntimeGovernorRouteAudit } from "./runtime-governor"

type JsonObject = Record<string, unknown>

export type ULMModelRouteAuditInput = {
  worktree: string
  operationID?: string
  profileConfigPath?: string
  installedConfigDir?: string
  includeInstalled?: boolean
  launchEnv?: NodeJS.ProcessEnv
  checkLaunchEnv?: boolean
}

export type ULMModelRouteAuditResult = {
  operationID?: string
  ok: boolean
  checkedAt: string
  files: Array<{
    label: string
    path: string
    exists: boolean
    ok: boolean
    gaps: string[]
    routes: Array<{ label: string; route: string }>
  }>
  configDrift: {
    checked: boolean
    ok: boolean
    gaps: string[]
  }
  launchEnv: {
    checked: boolean
    ok: boolean
    gaps: string[]
  }
  graphRouteAudit?: Awaited<ReturnType<typeof writeRuntimeGovernorRouteAudit>>["record"]
  gaps: string[]
  paths: {
    json?: string
    markdown?: string
  }
}

const SMALL_ROUTE = "openai/gpt-5.4-mini-fast"
const SMALL_ROUTE_LABELS = new Set(["small_model", "agent.recon.model", "agent.person-recon.model", "agent.evidence.model"])
const SMALL_ROUTE_LANE_TERMS = [
  "small",
  "recon",
  "person_recon",
  "person-recon",
  "evidence",
  "district_profile",
  "web_inventory",
]
const BANNED_TERMS = [
  "opencode/",
  "ring",
  "big-pickle",
  "claude",
  "copilot",
  "openrouter",
  "gemini",
  "kimi",
  "glm",
  "qwen",
  "anthropic",
  "google/",
  "github-copilot",
]

async function readJson(file: string): Promise<JsonObject | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as JsonObject
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function readText(file: string) {
  try {
    return await fs.readFile(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function collectConfigRoutes(config: JsonObject) {
  const routes: Array<{ label: string; route: string }> = []
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) routes.push({ label, route: value.trim() })
  }
  add("model", config.model)
  add("small_model", config.small_model)
  if (isObject(config.agent)) {
    for (const [agentID, agent] of Object.entries(config.agent)) {
      if (isObject(agent)) add(`agent.${agentID}.model`, agent.model)
    }
  }
  return routes
}

function validateConfig(label: string, file: string, config: JsonObject | undefined, raw: string | undefined) {
  const gaps: string[] = []
  const routes = config ? collectConfigRoutes(config) : []
  if (!config) gaps.push(`${label}: missing config file ${file}`)
  if (config && "provider" in config) gaps.push(`${label}: provider key is not allowed in active ULM config`)
  if (config && typeof config.model !== "string") gaps.push(`${label}: model is missing`)
  if (config && typeof config.small_model !== "string") gaps.push(`${label}: small_model is missing`)
  for (const route of routes) {
    if (!route.route.startsWith("openai/")) gaps.push(`${label}: ${route.label} must use openai/*, got ${route.route}`)
    if (route.route === SMALL_ROUTE && !SMALL_ROUTE_LABELS.has(route.label)) {
      gaps.push(`${label}: ${SMALL_ROUTE} is only allowed for small/recon/person-recon/evidence lanes, got ${route.label}`)
    }
  }
  const lower = raw?.toLowerCase() ?? ""
  for (const term of BANNED_TERMS) {
    if (lower.includes(term)) gaps.push(`${label}: banned provider/model token appears in active config: ${term}`)
  }
  return {
    label,
    path: file,
    exists: Boolean(config),
    ok: gaps.length === 0,
    gaps,
    routes,
  }
}

function expectedEnvPath(value: string | undefined) {
  return value ? path.resolve(value.replace(/^~(?=$|\/)/, os.homedir())) : undefined
}

function validateLaunchEnv(env: NodeJS.ProcessEnv, configDir: string) {
  const gaps: string[] = []
  const expectedConfig = path.join(configDir, "opencode.json")
  if (env.OPENCODE_APP_NAME !== "ulmcode") {
    gaps.push(`OPENCODE_APP_NAME must be ulmcode, got ${env.OPENCODE_APP_NAME ?? "unset"}`)
  }
  if (expectedEnvPath(env.OPENCODE_CONFIG_DIR) !== path.resolve(configDir)) {
    gaps.push(`OPENCODE_CONFIG_DIR must point at ${configDir}, got ${env.OPENCODE_CONFIG_DIR ?? "unset"}`)
  }
  if (expectedEnvPath(env.OPENCODE_CONFIG) !== path.resolve(expectedConfig)) {
    gaps.push(`OPENCODE_CONFIG must point at ${expectedConfig}, got ${env.OPENCODE_CONFIG ?? "unset"}`)
  }
  if (env.OPENCODE_DISABLE_PROJECT_CONFIG !== "1") {
    gaps.push(`OPENCODE_DISABLE_PROJECT_CONFIG must be 1, got ${env.OPENCODE_DISABLE_PROJECT_CONFIG ?? "unset"}`)
  }
  if (env.OPENCODE_MCP_ALLOWLIST) {
    const allowed = new Set([
      "websearch",
      "agent_browser",
      "playwright",
      "playwright_persistent",
      "pentestMCP",
      "companyscope",
      "not_human_search",
      "openregistry",
    ])
    for (const item of env.OPENCODE_MCP_ALLOWLIST.split(",").map((value) => value.trim()).filter(Boolean)) {
      if (!allowed.has(item)) gaps.push(`OPENCODE_MCP_ALLOWLIST includes non-ULM MCP: ${item}`)
    }
  }
  return {
    checked: true,
    ok: gaps.length === 0,
    gaps,
  }
}

function smallRouteAllowedForLane(laneID: string | undefined) {
  if (!laneID) return false
  return SMALL_ROUTE_LANE_TERMS.some((term) => laneID.includes(term))
}

function routeAuditMarkdown(result: ULMModelRouteAuditResult) {
  return [
    `# ULM Model Route Audit${result.operationID ? `: ${result.operationID}` : ""}`,
    "",
    `- ok: ${result.ok}`,
    `- checked_at: ${result.checkedAt}`,
    "",
    "## Config Files",
    "",
    "| File | Exists | OK | Routes |",
    "| --- | --- | --- | --- |",
    ...result.files.map(
      (file) =>
        `| ${file.label} | ${file.exists ? "yes" : "no"} | ${file.ok ? "yes" : "no"} | ${file.routes.map((route) => `${route.label}=${route.route}`).join("<br>") || "none"} |`,
    ),
    "",
    "## Gaps",
    "",
    ...(result.gaps.length ? result.gaps.map((gap) => `- ${gap}`) : ["- none"]),
    "",
  ].join("\n")
}

export async function auditULMModelRoutes(input: ULMModelRouteAuditInput): Promise<ULMModelRouteAuditResult> {
  const operationID = input.operationID ? slug(input.operationID, "operation") : undefined
  const checkedAt = new Date().toISOString()
  const launchEnvSource = input.launchEnv ?? process.env
  const installedConfigDir = path.resolve(
    input.installedConfigDir ?? expectedEnvPath(launchEnvSource.OPENCODE_CONFIG_DIR) ?? path.join(os.homedir(), ".config", "ulmcode"),
  )
  const worktreeProfileConfigPath = path.join(input.worktree, "tools", "ulmcode-profile", "opencode.json")
  const repoProfileConfigPath = path.resolve(import.meta.dir, "../../../..", "tools", "ulmcode-profile", "opencode.json")
  const profileConfigPath = path.resolve(
    input.profileConfigPath ?? ((await readText(worktreeProfileConfigPath)) ? worktreeProfileConfigPath : repoProfileConfigPath),
  )
  const includeInstalled = input.includeInstalled ?? false
  const configFiles = [
    { label: "profile opencode.json", path: profileConfigPath },
    ...(includeInstalled
      ? [
          { label: "installed opencode.json", path: path.join(installedConfigDir, "opencode.json") },
          { label: "installed ulmcode.json", path: path.join(installedConfigDir, "ulmcode.json") },
        ]
      : []),
  ]
  const files = await Promise.all(
    configFiles.map(async (item) => validateConfig(item.label, item.path, await readJson(item.path), await readText(item.path))),
  )
  const driftGaps: string[] = []
  if (includeInstalled) {
    const [opencodeText, ulmcodeText] = await Promise.all([
      readText(path.join(installedConfigDir, "opencode.json")),
      readText(path.join(installedConfigDir, "ulmcode.json")),
    ])
    if (!opencodeText || !ulmcodeText) driftGaps.push("installed opencode.json and ulmcode.json must both exist")
    else if (opencodeText !== ulmcodeText) driftGaps.push("installed opencode.json and ulmcode.json disagree on model routing")
  }
  const launchEnv = input.checkLaunchEnv === false ? { checked: false, ok: true, gaps: [] } : validateLaunchEnv(launchEnvSource, installedConfigDir)
  let graphRouteAudit: ULMModelRouteAuditResult["graphRouteAudit"]
  const graphGaps: string[] = []
  if (operationID) {
    try {
      graphRouteAudit = (await writeRuntimeGovernorRouteAudit(input.worktree, { operationID })).record
      graphGaps.push(
        ...graphRouteAudit.gaps
          .filter((gap) => !gap.includes("quota policy is not recorded"))
          .map((gap) => `operation graph: ${gap}`),
      )
      for (const route of graphRouteAudit.routes) {
        if (route.providerID !== "openai") graphGaps.push(`operation graph: ${route.route} must use openai/*`)
        if (route.route === SMALL_ROUTE && !smallRouteAllowedForLane(route.laneID)) {
          graphGaps.push(`operation graph: ${SMALL_ROUTE} is only allowed for small/recon/person-recon/evidence lanes, got ${route.laneID ?? "unknown lane"}`)
        }
      }
    } catch (error) {
      graphGaps.push(`operation graph route audit failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const gaps = [
    ...files.flatMap((file) => file.gaps),
    ...driftGaps,
    ...launchEnv.gaps,
    ...graphGaps,
  ]
  const paths: ULMModelRouteAuditResult["paths"] = {}
  const result: ULMModelRouteAuditResult = {
    operationID,
    ok: gaps.length === 0,
    checkedAt,
    files,
    configDrift: { checked: includeInstalled, ok: driftGaps.length === 0, gaps: driftGaps },
    launchEnv,
    graphRouteAudit,
    gaps,
    paths,
  }
  if (operationID) {
    const dir = path.join(operationPath(input.worktree, operationID), "deliverables")
    paths.json = path.join(dir, "model-route-audit.json")
    paths.markdown = path.join(dir, "model-route-audit.md")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(paths.json, JSON.stringify(result, null, 2) + "\n")
    await fs.writeFile(paths.markdown, routeAuditMarkdown(result))
  }
  return result
}
