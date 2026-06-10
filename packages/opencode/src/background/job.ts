import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BackgroundJob as CoreBackgroundJob } from "@opencode-ai/core/background-job"
import { InstanceState } from "@/effect/instance-state"
import { Context, Effect, Layer } from "effect"
import * as Storage from "@/storage/storage"

export type Status = CoreBackgroundJob.Status | "stale"

export type Info = Omit<CoreBackgroundJob.Info, "status" | "started_at" | "completed_at"> & {
  status: Status
  started_at?: number
  completed_at?: number
  startedAt: number
  completedAt?: number
}

export type StartInput = CoreBackgroundJob.StartInput
export type ExtendInput = CoreBackgroundJob.ExtendInput
export type WaitInput = CoreBackgroundJob.WaitInput
export type WaitResult = Omit<CoreBackgroundJob.WaitResult, "info"> & { info?: Info }

export interface Interface {
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: string) => Effect.Effect<Info | undefined>
  readonly start: (input: StartInput) => Effect.Effect<Info>
  readonly extend: (input: ExtendInput) => Effect.Effect<boolean>
  readonly wait: (input: WaitInput) => Effect.Effect<WaitResult>
  readonly waitForPromotion: (id: string) => Effect.Effect<Info>
  readonly promote: (id: string) => Effect.Effect<Info | undefined>
  readonly cancel: (id: string) => Effect.Effect<Info | undefined>
  readonly updateMetadata: (id: string, metadata: Record<string, unknown>) => Effect.Effect<Info | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/BackgroundJob") {}

function adapt(info: CoreBackgroundJob.Info, extra?: Record<string, unknown>): Info {
  const metadata = { ...(info.metadata ?? {}), ...(extra ?? {}) }
  return {
    ...info,
    metadata,
    startedAt: info.started_at,
    ...(info.completed_at === undefined ? {} : { completedAt: info.completed_at }),
  }
}

function storageKey(id: string) {
  return ["background_job", id]
}

/** Keeps the legacy service instance-scoped while sharing the core registry engine. */
export const layer: Layer.Layer<Service, never, Storage.Service> = Layer.effect(
  Service,
  Effect.scoped(Effect.gen(function* () {
    const storage = yield* Storage.Service
    const state = yield* InstanceState.make(() => CoreBackgroundJob.make)
    const readStored = (id: string) =>
      storage.read<Info>(storageKey(id)).pipe(Effect.catch(() => Effect.succeed(undefined)))
    const writeStored = (info: Info) =>
      storage.write(storageKey(info.id), info).pipe(Effect.as(info), Effect.catch(() => Effect.succeed(info)))
    const withStored = (info: CoreBackgroundJob.Info) =>
      Effect.gen(function* () {
        const stored = yield* readStored(info.id)
        return adapt(info, stored?.metadata)
      })
    const saveLive = (info: CoreBackgroundJob.Info) => withStored(info).pipe(Effect.flatMap(writeStored))

    return Service.of({
      list: () =>
        Effect.gen(function* () {
          const live = yield* InstanceState.useEffect(state, (jobs) => jobs.list()).pipe(
            Effect.flatMap((items) => Effect.all(items.map(saveLive))),
          )
          const liveIDs = new Set(live.map((job) => job.id))
          const keys = yield* storage.list(["background_job"]).pipe(Effect.catch(() => Effect.succeed<string[][]>([])))
          const stored = yield* Effect.all(
            keys
              .map((key) => key.at(-1))
              .filter((id): id is string => !!id && !liveIDs.has(id))
              .map(readStored),
          )
          return [...live, ...stored.filter((job): job is Info => !!job)].toSorted((a, b) => a.startedAt - b.startedAt)
        }),
      get: (id) =>
        InstanceState.useEffect(state, (jobs) => jobs.get(id)).pipe(
          Effect.flatMap((info) => (info ? saveLive(info) : readStored(id))),
        ),
      start: (input) =>
        InstanceState.useEffect(state, (jobs) => jobs.start(input)).pipe(Effect.flatMap(saveLive)),
      extend: (input) => InstanceState.useEffect(state, (jobs) => jobs.extend(input)),
      wait: (input) =>
        InstanceState.useEffect(state, (jobs) => jobs.wait(input)).pipe(
          Effect.flatMap((result) =>
            Effect.gen(function* () {
              const info = result.info ? yield* saveLive(result.info) : yield* readStored(input.id)
              return { timedOut: result.timedOut, info } satisfies WaitResult
            }),
          ),
        ),
      waitForPromotion: (id) =>
        InstanceState.useEffect(state, (jobs) => jobs.waitForPromotion(id)).pipe(Effect.flatMap(saveLive)),
      promote: (id) =>
        InstanceState.useEffect(state, (jobs) => jobs.promote(id)).pipe(
          Effect.flatMap((info) => (info ? saveLive(info) : readStored(id))),
        ),
      cancel: (id) =>
        InstanceState.useEffect(state, (jobs) => jobs.cancel(id)).pipe(
          Effect.flatMap((info) => (info ? saveLive(info) : readStored(id))),
        ),
      updateMetadata: (id, next) =>
        Effect.gen(function* () {
          const current = yield* InstanceState.useEffect(state, (jobs) => jobs.get(id)).pipe(
            Effect.flatMap((info) => (info ? withStored(info) : readStored(id))),
          )
          if (!current) return undefined
          const updated = { ...current, metadata: { ...(current.metadata ?? {}), ...next } }
          return yield* writeStored(updated)
        }),
    })
  })),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(Layer.provide(Storage.defaultLayer))

export const node = LayerNode.make(defaultLayer, [])

export * as BackgroundJob from "./job"
