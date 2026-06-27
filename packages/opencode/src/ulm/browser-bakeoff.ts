import fs from "fs/promises"
import path from "path"
import { operationPath, slug } from "./artifact"

export type BrowserBakeoffCandidate = {
  id: "playwright-persistent" | "browser-mcp-existing-profile" | "chrome-devtools-companion"
  score: number
  strengths: string[]
  gaps: string[]
}

export type BrowserBakeoffResult = {
  operationID?: string
  generatedAt?: string
  criteria: string[]
  candidates: BrowserBakeoffCandidate[]
}

const CRITERIA = [
  "persistent login/session state",
  "visible local browser support",
  "screenshot capture",
  "DOM/accessibility extraction",
  "download handling",
  "file upload handling",
  "console/network capture",
  "recovery after browser crash",
  "operation artifact logging",
  "MCP stability under long tasks",
]

export function scoreBrowserBakeoffCandidates(): BrowserBakeoffResult {
  return {
    criteria: CRITERIA,
    candidates: [
      {
        id: "playwright-persistent",
        score: 87,
        strengths: [
          "persistent browser profile",
          "headed local browser",
          "accessibility snapshots",
          "screenshots and downloads",
          "repeatable stdio MCP setup",
        ],
        gaps: ["existing human Chrome profile requires extension or CDP handoff"],
      },
      {
        id: "browser-mcp-existing-profile",
        score: 82,
        strengths: [
          "existing logged-in Chrome profile",
          "operator-visible browser",
          "low-friction authenticated workflow handoff",
        ],
        gaps: ["extension dependency must be validated under long unattended runs"],
      },
      {
        id: "chrome-devtools-companion",
        score: 66,
        strengths: ["console/network evidence", "debugging live browser state", "performance traces"],
        gaps: ["not enough by itself for broad browser operation"],
      },
    ],
  }
}

function bakeoffMarkdown(result: BrowserBakeoffResult) {
  return [
    `# Browser MCP Bakeoff${result.operationID ? `: ${result.operationID}` : ""}`,
    "",
    result.generatedAt ? `Generated: ${result.generatedAt}` : undefined,
    "",
    "## Criteria",
    ...result.criteria.map((item) => `- ${item}`),
    "",
    "## Candidates",
    ...result.candidates.map(
      (candidate) =>
        `### ${candidate.id}\n\n- score: ${candidate.score}\n- strengths: ${candidate.strengths.join("; ")}\n- gaps: ${candidate.gaps.join("; ")}\n`,
    ),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

export async function writeBrowserBakeoff(worktree: string, input: { operationID: string }) {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const browserDir = path.join(root, "browser")
  const result: BrowserBakeoffResult = {
    ...scoreBrowserBakeoffCandidates(),
    operationID,
    generatedAt: new Date().toISOString(),
  }
  const json = path.join(browserDir, "bakeoff.json")
  const markdown = path.join(browserDir, "bakeoff.md")
  await fs.mkdir(browserDir, { recursive: true })
  await fs.writeFile(json, JSON.stringify(result, null, 2) + "\n")
  await fs.writeFile(markdown, bakeoffMarkdown(result))
  return { operationID, result, files: { json, markdown } }
}
