import * as InstanceState from "@/effect/instance-state"
import fs from "fs/promises"
import path from "path"
import {
  FINAL_PACKAGE_FILES,
  buildOperationAudit,
  buildOperationResumeBrief,
  closeOperationStatuses,
  listOperationStatuses,
  operationPath,
  readOperationStatus,
} from "@/ulm/artifact"
import { createOperationFromTemplate } from "@/ulm/operation-extras"
import {
  deleteOperationCredential,
  materializeOperationCredentials,
  readOperationCredentials,
  submitOperationCredentialReview,
  writeOperationCredential,
} from "@/ulm/operation-credentials"
import { Storage } from "@/storage/storage"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type {
  UlmAuditWritePayload,
  UlmAuditQuery,
  UlmCloseOperationsPayload,
  UlmCredentialCreatePayload,
  UlmCredentialMaterializePayload,
  UlmDaemonPayload,
  UlmFinalArtifactOpenPayload,
  UlmListQuery,
  UlmOperationQuery,
  UlmRecoverPayload,
  UlmResumeQuery,
  UlmTemplateStartPayload,
} from "../groups/ulm"

type JsonRecord = Record<string, unknown>

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJson(file: string): Promise<JsonRecord | undefined> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function daemonPaths(root: string, operationID: string) {
  const scheduler = path.join(operationPath(root, operationID), "scheduler")
  return {
    lockPath: path.join(scheduler, "daemon.lock.json"),
    heartbeatPath: path.join(scheduler, "daemon-heartbeat.json"),
    logPath: path.join(scheduler, "daemon.jsonl"),
  }
}

async function daemonMetadata(root: string, operationID: string) {
  const paths = daemonPaths(root, operationID)
  const heartbeat = await readJson(paths.heartbeatPath)
  const lock = await readJson(paths.lockPath)
  const pid = typeof heartbeat?.pid === "number" ? heartbeat.pid : typeof lock?.pid === "number" ? lock.pid : undefined
  const stopped = typeof heartbeat?.stopped === "boolean" ? heartbeat.stopped : undefined
  return {
    running: heartbeat !== undefined && stopped !== true,
    pid,
    updatedAt: typeof heartbeat?.updatedAt === "string" ? heartbeat.updatedAt : undefined,
    stopped,
    reason: typeof heartbeat?.reason === "string" ? heartbeat.reason : undefined,
    ...paths,
    heartbeat,
    lock,
  }
}

function daemonStartCommand(operationID: string, payload: typeof UlmDaemonPayload.Type) {
  return [
    "bun run --cwd packages/opencode ulm:runtime-daemon",
    shellQuote(operationID),
    "--detach",
    "--json",
    payload.maxRuntimeSeconds === undefined ? undefined : `--duration-seconds ${payload.maxRuntimeSeconds}`,
    payload.cycleIntervalSeconds === undefined ? undefined : `--interval-seconds ${payload.cycleIntervalSeconds}`,
    payload.maxCycles === undefined ? undefined : `--max-cycles ${payload.maxCycles}`,
    payload.schedulerCyclesPerTick === undefined ? undefined : `--scheduler-cycles ${payload.schedulerCyclesPerTick}`,
  ]
    .filter((item): item is string => item !== undefined)
    .join(" ")
}

function artifactID(file: string) {
  return file.replaceAll("_", "-").replaceAll(".", "-")
}

function artifactKind(file: string) {
  if (file.endsWith(".pdf")) return "pdf" as const
  if (file.endsWith(".html")) return "html" as const
  if (file.endsWith(".json")) return "json" as const
  if (file.endsWith(".md")) return "markdown" as const
  if (file.endsWith(".txt")) return "text" as const
  return "unknown" as const
}

function finalDir(root: string, operationID: string) {
  return path.join(operationPath(root, operationID), "deliverables", "final")
}

async function finalArtifact(root: string, operationID: string, file: string) {
  const target = path.join(finalDir(root, operationID), file)
  const stat = await fs.stat(target).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  })
  const id = artifactID(file)
  return {
    id,
    file,
    kind: artifactKind(file),
    exists: stat?.isFile() === true,
    path: target,
    size: stat?.isFile() ? stat.size : undefined,
    updatedAt: stat?.isFile() ? stat.mtime.toISOString() : undefined,
    fetchPath: `/ulm/operation/${encodeURIComponent(operationID)}/final-artifacts/${encodeURIComponent(id)}`,
    openPath: `/ulm/operation/${encodeURIComponent(operationID)}/final-artifacts/${encodeURIComponent(id)}/open`,
  }
}

async function finalArtifacts(root: string, operationID: string) {
  return Promise.all(FINAL_PACKAGE_FILES.map((file) => finalArtifact(root, operationID, file)))
}

async function oneFinalArtifact(root: string, operationID: string, id: string) {
  const file = FINAL_PACKAGE_FILES.find((item) => artifactID(item) === id)
  if (!file) throw new Error(`Unknown final artifact: ${id}`)
  return finalArtifact(root, operationID, file)
}

export const ulmHandlers = HttpApiBuilder.group(InstanceHttpApi, "ulm", (handlers) =>
  Effect.gen(function* () {
    const worktree = Effect.map(InstanceState.context, (ctx) => ctx.worktree)
    const storage = yield* Storage.Service

    const list = Effect.fn("UlmHttpApi.list")(function* (ctx: { query: typeof UlmListQuery.Type }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          listOperationStatuses(root, {
            eventLimit: ctx.query.eventLimit,
          }),
        catch: (error) => new Error(`Unable to list ULM operations: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const status = Effect.fn("UlmHttpApi.status")(function* (ctx: {
      params: { operationID: string }
      query: typeof UlmOperationQuery.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          readOperationStatus(root, ctx.params.operationID, {
            eventLimit: ctx.query.eventLimit,
          }),
        catch: (error) => new Error(`Unable to read ULM operation status: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const resume = Effect.fn("UlmHttpApi.resume")(function* (ctx: {
      params: { operationID: string }
      query: typeof UlmResumeQuery.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          buildOperationResumeBrief(root, ctx.params.operationID, {
            eventLimit: ctx.query.eventLimit,
            staleAfterMinutes: ctx.query.staleAfterMinutes,
          }),
        catch: (error) => new Error(`Unable to build ULM resume brief: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const audit = Effect.fn("UlmHttpApi.audit")(function* (ctx: {
      params: { operationID: string }
      query: typeof UlmAuditQuery.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          buildOperationAudit(root, ctx.params.operationID, {
            eventLimit: ctx.query.eventLimit,
            staleAfterMinutes: ctx.query.staleAfterMinutes,
            minWords: ctx.query.minWords,
            requireOutlineBudget: ctx.query.requireOutlineBudget,
            minOutlineTargetPages: ctx.query.minOutlineTargetPages,
            minOutlineWordsPerPage: ctx.query.minOutlineWordsPerPage,
            minPdfPages: ctx.query.minPdfPages,
            requireFindingSections: ctx.query.requireFindingSections,
            minFindingWords: ctx.query.minFindingWords,
            finalHandoff: ctx.query.finalHandoff,
          }),
        catch: (error) => new Error(`Unable to audit ULM operation: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const templateStart = Effect.fn("UlmHttpApi.templateStart")(function* (ctx: {
      payload: typeof UlmTemplateStartPayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => {
          const result = await createOperationFromTemplate(root, ctx.payload)
          return {
            operationID: result.operationID,
            template: ctx.payload.template,
            files: {
              goal: result.goal.files.json,
              plan: result.plan.json,
              graph: result.graph.json,
              outline: result.outline.file,
              memory: result.memory,
            },
          }
        },
        catch: (error) => new Error(`Unable to start ULM operation from template: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const close = Effect.fn("UlmHttpApi.close")(function* (ctx: { payload: typeof UlmCloseOperationsPayload.Type }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          closeOperationStatuses(root, {
            operationIDs: ctx.payload.operationIDs,
          }),
        catch: (error) => new Error(`Unable to close ULM operations: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const auditWrite = Effect.fn("UlmHttpApi.auditWrite")(function* (ctx: {
      params: { operationID: string }
      payload: typeof UlmAuditWritePayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          buildOperationAudit(root, ctx.params.operationID, {
            eventLimit: ctx.payload.eventLimit,
            staleAfterMinutes: ctx.payload.staleAfterMinutes,
            minWords: ctx.payload.minWords,
            requireOutlineBudget: ctx.payload.requireOutlineBudget,
            minOutlineWordsPerPage: ctx.payload.minOutlineWordsPerPage,
            requireFindingSections: ctx.payload.requireFindingSections,
            minFindingWords: ctx.payload.minFindingWords,
            finalHandoff: ctx.payload.finalHandoff,
          }),
        catch: (error) => new Error(`Unable to write ULM operation audit: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const recover = Effect.fn("UlmHttpApi.recover")(function* (ctx: {
      params: { operationID: string }
      payload: typeof UlmRecoverPayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => {
          await readOperationStatus(root, ctx.params.operationID)
          return {
            operationID: ctx.params.operationID,
            action: "recover" as const,
            mode: "planned" as const,
            supported: false,
            dryRun: ctx.payload.dryRun === true,
            command: [
              `operation_recover operationID=${ctx.params.operationID}`,
              `dryRun=${ctx.payload.dryRun === true ? "true" : "false"}`,
              ctx.payload.maxTasks === undefined ? undefined : `maxTasks=${ctx.payload.maxTasks}`,
            ]
              .filter((item): item is string => item !== undefined)
              .join(" "),
            reason:
              "HTTP recovery is intentionally metadata-only in v1; restartable task relaunch needs tool runtime services and operator visibility.",
            restartableJobs: 0,
            skipped: 0,
          }
        },
        catch: (error) => new Error(`Unable to plan ULM operation recovery: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const daemonStart = Effect.fn("UlmHttpApi.daemonStart")(function* (ctx: {
      params: { operationID: string }
      payload: typeof UlmDaemonPayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => ({
          operationID: ctx.params.operationID,
          action: "start" as const,
          mode: "planned" as const,
          supported: false,
          command: daemonStartCommand(ctx.params.operationID, ctx.payload),
          reason: "HTTP daemon start is metadata-only in v1; run the returned command from the operator shell.",
          daemon: await daemonMetadata(root, ctx.params.operationID),
        }),
        catch: (error) => new Error(`Unable to plan ULM runtime daemon start: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const daemonStop = Effect.fn("UlmHttpApi.daemonStop")(function* (ctx: {
      params: { operationID: string }
      payload: typeof UlmDaemonPayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => {
          const daemon = await daemonMetadata(root, ctx.params.operationID)
          return {
            operationID: ctx.params.operationID,
            action: "stop" as const,
            mode: "planned" as const,
            supported: false,
            command: daemon.pid ? `kill -TERM ${daemon.pid}` : `rm -f ${shellQuote(daemon.lockPath)}`,
            reason: "HTTP daemon stop is metadata-only in v1; process control stays with the operator shell.",
            daemon,
          }
        },
        catch: (error) => new Error(`Unable to plan ULM runtime daemon stop: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const daemonStatus = Effect.fn("UlmHttpApi.daemonStatus")(function* (ctx: {
      params: { operationID: string }
      payload: typeof UlmDaemonPayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => ({
          operationID: ctx.params.operationID,
          action: "status" as const,
          mode: "metadata" as const,
          supported: true,
          command: `cat ${shellQuote(daemonPaths(root, ctx.params.operationID).heartbeatPath)}`,
          reason: "Read daemon heartbeat and lock metadata from the operation scheduler directory.",
          daemon: await daemonMetadata(root, ctx.params.operationID),
        }),
        catch: (error) => new Error(`Unable to read ULM runtime daemon status: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const finalArtifactList = Effect.fn("UlmHttpApi.finalArtifacts")(function* (ctx: {
      params: { operationID: string }
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => ({
          operationID: ctx.params.operationID,
          finalDir: finalDir(root, ctx.params.operationID),
          artifacts: await finalArtifacts(root, ctx.params.operationID),
        }),
        catch: (error) => new Error(`Unable to list ULM final artifacts: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const finalArtifactMetadata = Effect.fn("UlmHttpApi.finalArtifact")(function* (ctx: {
      params: { operationID: string; artifactID: string }
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => ({
          operationID: ctx.params.operationID,
          finalDir: finalDir(root, ctx.params.operationID),
          artifact: await oneFinalArtifact(root, ctx.params.operationID, ctx.params.artifactID),
        }),
        catch: (error) => new Error(`Unable to read ULM final artifact metadata: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const finalArtifactOpen = Effect.fn("UlmHttpApi.finalArtifactOpen")(function* (ctx: {
      params: { operationID: string; artifactID: string }
      payload: typeof UlmFinalArtifactOpenPayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: async () => {
          const artifact = await oneFinalArtifact(root, ctx.params.operationID, ctx.params.artifactID)
          return {
            operationID: ctx.params.operationID,
            artifactID: ctx.params.artifactID,
            mode: "planned" as const,
            supported: artifact.exists,
            command: `open ${shellQuote(artifact.path)}`,
            reason: artifact.exists
              ? "HTTP artifact open is metadata-only in v1; execute the returned command locally."
              : "Artifact is missing; render or copy final deliverables before opening it.",
            artifact,
          }
        },
        catch: (error) => new Error(`Unable to plan ULM final artifact open: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const credentials = Effect.fn("UlmHttpApi.credentials")(function* (ctx: { params: { operationID: string } }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () => readOperationCredentials(root, { operationID: ctx.params.operationID }),
        catch: (error) => new Error(`Unable to read ULM credentials: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const credentialCreate = Effect.fn("UlmHttpApi.credentialCreate")(function* (ctx: {
      params: { operationID: string }
      payload: typeof UlmCredentialCreatePayload.Type
    }) {
      const root = yield* worktree
      yield* Effect.tryPromise({
        try: () =>
          writeOperationCredential(storage, root, {
            ...ctx.payload,
            operationID: ctx.params.operationID,
            tags: ctx.payload.tags ? [...ctx.payload.tags] : undefined,
          }),
        catch: (error) => new Error(`Unable to write ULM credential: ${errorText(error)}`),
      }).pipe(Effect.orDie)
      return yield* Effect.tryPromise({
        try: () => readOperationCredentials(root, { operationID: ctx.params.operationID }),
        catch: (error) => new Error(`Unable to read ULM credentials: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const credentialReviewSubmit = Effect.fn("UlmHttpApi.credentialReviewSubmit")(function* (ctx: {
      params: { operationID: string }
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () => submitOperationCredentialReview(root, { operationID: ctx.params.operationID }),
        catch: (error) => new Error(`Unable to submit ULM credential review: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const credentialDelete = Effect.fn("UlmHttpApi.credentialDelete")(function* (ctx: {
      params: { operationID: string; credentialID: string }
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          deleteOperationCredential(storage, root, {
            operationID: ctx.params.operationID,
            credentialID: ctx.params.credentialID,
          }),
        catch: (error) => new Error(`Unable to delete ULM credential: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    const credentialMaterializeEnv = Effect.fn("UlmHttpApi.credentialMaterializeEnv")(function* (ctx: {
      params: { operationID: string }
      payload: typeof UlmCredentialMaterializePayload.Type
    }) {
      const root = yield* worktree
      return yield* Effect.tryPromise({
        try: () =>
          materializeOperationCredentials(storage, root, {
            operationID: ctx.params.operationID,
            credentialIDs: ctx.payload.credentialIDs ? [...ctx.payload.credentialIDs] : undefined,
          }),
        catch: (error) => new Error(`Unable to materialize ULM credentials: ${errorText(error)}`),
      }).pipe(Effect.orDie)
    })

    return handlers
      .handle("list", list)
      .handle("templateStart", templateStart)
      .handle("close", close)
      .handle("status", status)
      .handle("resume", resume)
      .handle("audit", audit)
      .handle("auditWrite", auditWrite)
      .handle("recover", recover)
      .handle("daemonStart", daemonStart)
      .handle("daemonStop", daemonStop)
      .handle("daemonStatus", daemonStatus)
      .handle("finalArtifacts", finalArtifactList)
      .handle("finalArtifact", finalArtifactMetadata)
      .handle("finalArtifactOpen", finalArtifactOpen)
      .handle("credentials", credentials)
      .handle("credentialCreate", credentialCreate)
      .handle("credentialReviewSubmit", credentialReviewSubmit)
      .handle("credentialDelete", credentialDelete)
      .handle("credentialMaterializeEnv", credentialMaterializeEnv)
  }),
)
