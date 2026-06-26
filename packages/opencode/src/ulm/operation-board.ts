import fs from "fs/promises"
import path from "path"
import { operationPath, readOperationStatus, slug } from "./artifact"
import { normalizeStrategyMemo } from "./operation-strategy"

export type OperationBoardRecord = {
  operationID: string
  generatedAt: string
  sections: {
    currentObjective: string[]
    nextStrategyItems: string[]
    activeLanesJobs: string[]
    blockedWork: string[]
    browserSessions: string[]
    evidenceInbox: string[]
    identitySaasGaps: string[]
    reportReadiness: string[]
    finalizationStatus: string[]
  }
}

export type OperationBoardResult = {
  operationID: string
  json: string
  markdownPath: string
  markdown: string
  record: OperationBoardRecord
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function exists(file: string) {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

function listOrNone(items: string[]) {
  return items.length ? items : ["none"]
}

function markdown(record: OperationBoardRecord) {
  const section = (title: string, items: string[]) => [`## ${title}`, "", ...items.map((item) => `- ${item}`), ""].join("\n")
  return [
    `# Operation Board: ${record.operationID}`,
    "",
    `Generated: ${record.generatedAt}`,
    "",
    section("Current Objective", record.sections.currentObjective),
    section("Next Strategy Items", record.sections.nextStrategyItems),
    section("Active Lanes Jobs", record.sections.activeLanesJobs),
    section("Blocked Work", record.sections.blockedWork),
    section("Browser Sessions", record.sections.browserSessions),
    section("Evidence Inbox", record.sections.evidenceInbox),
    section("Identity SaaS Gaps", record.sections.identitySaasGaps),
    section("Report Readiness", record.sections.reportReadiness),
    section("Finalization Status", record.sections.finalizationStatus),
  ].join("\n")
}

export async function buildOperationBoard(worktree: string, input: { operationID: string }): Promise<OperationBoardResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const status = await readOperationStatus(worktree, operationID, { eventLimit: 5 })
  const strategy = normalizeStrategyMemo(
    (await readJson(path.join(root, "strategy", "next-actions.json"))) ?? { operationID, items: [] },
  )
  const browserSessionLog = path.join(root, "browser", "session-log.jsonl")
  const browserSession = (await exists(browserSessionLog)) ? ["browser/session-log.jsonl"] : []
  const running = status.graph?.lanes.running ?? []
  const background = status.runtime?.backgroundTasks ?? []
  const blocked = [
    ...(status.operation?.blockers ?? []),
    ...(status.supervisor?.blockers ?? []),
    ...(status.graph?.lanes.failed ?? []).map((lane) => `failed lane: ${lane}`),
  ]
  const identityGaps = (status.graph?.lanes.incomplete ?? []).filter((lane) =>
    /identity|auth|saas|cloud|entra|google|microsoft|mdm|sis/i.test(lane),
  )
  const reportReadiness = [
    `outline=${status.reports.outline}`,
    `markdown=${status.reports.markdown}`,
    `html=${status.reports.html}`,
    `pdf=${status.reports.pdf}`,
    `report_ready_findings=${status.findings.byState.report_ready}`,
  ]
  const record: OperationBoardRecord = {
    operationID,
    generatedAt: new Date().toISOString(),
    sections: {
      currentObjective: listOrNone([
        status.operation?.objective ?? status.goal?.objective ?? "",
        status.operation ? `${status.operation.stage}/${status.operation.status}: ${status.operation.summary}` : "",
      ].filter(Boolean)),
      nextStrategyItems: listOrNone(strategy.items.map((item) => item.title)),
      activeLanesJobs: listOrNone([
        ...running.map((lane) => `lane: ${lane}`),
        ...background.map((job) => `job: ${job.id} ${job.status}`),
      ]),
      blockedWork: listOrNone(blocked),
      browserSessions: listOrNone(browserSession),
      evidenceInbox: [`evidence=${status.evidence.total}`, `findings=${status.findings.total}`],
      identitySaasGaps: listOrNone(identityGaps),
      reportReadiness,
      finalizationStatus: [`runtime_summary=${status.runtimeSummary}`, `final_manifest=${status.reports.manifest}`],
    },
  }
  const boardDir = path.join(root, "board")
  const json = path.join(boardDir, "operation-board.json")
  const markdownPath = path.join(boardDir, "operation-board.md")
  const body = markdown(record)
  await fs.mkdir(boardDir, { recursive: true })
  await fs.writeFile(json, JSON.stringify(record, null, 2) + "\n")
  await fs.writeFile(markdownPath, body)
  return { operationID, json, markdownPath, markdown: body, record }
}
