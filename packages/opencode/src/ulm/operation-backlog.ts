import fs from "fs/promises"
import path from "path"
import { operationPath, readOperationStatus, slug } from "./artifact"
import { containsRawCredentialSecret } from "./credential-safety"
import { auditOperationGaps } from "./operation-gap-audit"
import type { OperationGraphRecord, OperationLane } from "./operation-graph"
import { buildWorkQueue } from "./work-queue"

export type OperationBacklogResult = {
  operationID: string
  graphPath: string
  gapAuditPath: string
  generatedLanes: string[]
  generatedWorkUnits: number
  skipped: string[]
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function incompleteRunnableLanes(graph: OperationGraphRecord) {
  return graph.lanes.filter(
    (lane) =>
      lane.id !== "supervisor" &&
      lane.status !== "complete" &&
      !(
        (lane.status === "skipped" || lane.status === "blocked") &&
        lane.releaseRequired === false &&
        lane.coverageImpact !== "blocks_release"
      ),
  )
}

function expansionLaneID(graph: OperationGraphRecord) {
  const count = graph.lanes.filter((lane) => lane.id.startsWith("planned_work_expansion_")).length
  return `planned_work_expansion_${count + 1}`
}

async function expansionLane(worktree: string, graph: OperationGraphRecord): Promise<OperationLane> {
  const status = await readOperationStatus(worktree, graph.operationID, { eventLimit: 0 }).catch(() => undefined)
  const id = expansionLaneID(graph)
  const candidateFindings =
    (status?.findings.byState.candidate ?? 0) + (status?.findings.byState.needs_validation ?? 0)
  const validationFocused = candidateFindings > 0
  return {
    id,
    title: validationFocused ? "Expansion: candidate validation pass" : "Expansion: second-pass coverage review",
    agent: validationFocused ? "validator" : "pentest",
    status: "ready",
    dependsOn: [],
    modelRoute: validationFocused ? "openai/gpt-5.5" : "openai/gpt-5.4-mini-fast",
    fallbackModelRoutes: validationFocused ? ["openai/gpt-5.4-mini-fast"] : ["openai/gpt-5.5"],
    allowedTools: [
      "operation_gap_audit",
      "operation_status",
      "operation_checkpoint",
      "identity_graph",
      "asset_graph",
      "attack_chain",
      "evidence_record",
      "finding_record",
      "write",
      "operation_run",
    ],
    expectedArtifacts: [`work-blocks/${id}.md`],
    budget: {},
    restartPolicy: { restartable: true, maxAttempts: 2, staleAfterMinutes: 60 },
    plannedDurationMinutes: 30,
    minRuntimeMinutes: 20,
    coverageImpact: "high",
    releaseRequired: false,
    operationID: graph.operationID,
  }
}

export async function generateOperationBacklog(
  worktree: string,
  input: {
    operationID: string
    toolManifestPath?: string
    maxUnits?: number
    runtimeRemainingSeconds?: number
  },
): Promise<OperationBacklogResult> {
  if (containsRawCredentialSecret(input)) throw new Error("operation backlog inputs must not contain raw credential secrets")
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const graphPath = path.join(root, "plans", "operation-graph.json")
  const graph = await readJson<OperationGraphRecord>(graphPath)
  if (!graph) throw new Error("operation graph is missing; run operation_schedule first")
  const audit = await auditOperationGaps(worktree, {
    operationID,
    runtimeRemainingSeconds: input.runtimeRemainingSeconds,
  })

  const skipped: string[] = []
  let generatedWorkUnits = 0
  try {
    const queue = await buildWorkQueue(worktree, {
      operationID,
      manifestPath: input.toolManifestPath,
      maxUnits: input.maxUnits ?? 25,
      includePassiveBaseline: true,
    })
    generatedWorkUnits = queue.generated
    if (queue.skipped.length) skipped.push(...queue.skipped)
  } catch (error) {
    skipped.push(`work queue refill failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (incompleteRunnableLanes(graph).length) {
    return { operationID, graphPath, gapAuditPath: audit.files.json, generatedLanes: [], generatedWorkUnits, skipped }
  }

  const generated = await expansionLane(worktree, graph)
  graph.lanes.push(generated)
  graph.updatedAt = new Date().toISOString()
  await writeJson(graphPath, graph)
  return { operationID, graphPath, gapAuditPath: audit.files.json, generatedLanes: [generated.id], generatedWorkUnits, skipped }
}
