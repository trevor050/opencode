import * as InstanceState from "@/effect/instance-state"
import {
  buildOperationAudit,
  buildOperationResumeBrief,
  listOperationStatuses,
  readOperationStatus,
} from "@/ulm/artifact"
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
  UlmAuditQuery,
  UlmCredentialCreatePayload,
  UlmCredentialMaterializePayload,
  UlmListQuery,
  UlmOperationQuery,
  UlmResumeQuery,
} from "../groups/ulm"

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
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
      .handle("status", status)
      .handle("resume", resume)
      .handle("audit", audit)
      .handle("credentials", credentials)
      .handle("credentialCreate", credentialCreate)
      .handle("credentialReviewSubmit", credentialReviewSubmit)
      .handle("credentialDelete", credentialDelete)
      .handle("credentialMaterializeEnv", credentialMaterializeEnv)
  }),
)
