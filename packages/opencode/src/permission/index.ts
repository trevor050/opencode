import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Layer, Context } from "effect"
import os from "os"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { activeOperationForContext, operationAllowsUnattendedFallback } from "@/ulm/operation-context"
import { isSensitiveOperatorPrompt, operatorFallbackWaitMillis, recordOperatorTimeout } from "@/ulm/operator-timeout"
import { readULMConfig } from "@/ulm/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"

const OPERATOR_ACTIVITY_HOLD_MILLIS = 30_000
const OPERATOR_ACTIVITY_RESET_MILLIS = 300_000

export const Event = {
  Asked: EventV2.define({ type: "permission.asked", schema: PermissionV1.Request.fields }),
  Replied: EventV2.define({
    type: "permission.replied",
    schema: {
      sessionID: PermissionV1.Request.fields.sessionID,
      requestID: PermissionV1.ID,
      reply: PermissionV1.Reply,
    },
  }),
}

export interface Interface {
  readonly ask: (input: PermissionV1.AskInput) => Effect.Effect<void, PermissionV1.Error>
  readonly touch: (input: { requestID: PermissionV1.ID; holdMillis?: number }) => Effect.Effect<boolean>
  readonly reply: (input: PermissionV1.ReplyInput) => Effect.Effect<void, PermissionV1.NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<PermissionV1.Request>>
}

interface PendingEntry {
  info: PermissionV1.Request
  deferred: Deferred.Deferred<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>
  timeoutExpiresAt?: number
  timeoutWindowMillis?: number
}

interface State {
  pending: Map<PermissionV1.ID, PendingEntry>
  approved: PermissionV1.Rule[]
}

export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return (
    rulesets
      .flat()
      .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern)) ?? {
      action: "ask",
      permission,
      pattern: "*",
    }
  )
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        void ctx
        const state = {
          pending: new Map<PermissionV1.ID, PendingEntry>(),
          approved: [],
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: PermissionV1.AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, ...request } = input
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        yield* Effect.logInfo("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new PermissionV1.DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return

      const id = request.id ?? PermissionV1.ID.ascending()
      const ctx = yield* InstanceState.context
      const operation = yield* Effect.promise(() => activeOperationForContext({ ...ctx, sessionID: request.sessionID }))
      const ulmConfig = yield* Effect.promise(() => readULMConfig(ctx))
      const activeOperation = operation && operationAllowsUnattendedFallback(operation.goal, ulmConfig) ? operation : undefined
      const timeoutMillis =
        activeOperation === undefined
          ? undefined
          : yield* Effect.promise(() =>
              operatorFallbackWaitMillis(activeOperation.worktree, {
                operationID: activeOperation.operationID,
                kind: "permission",
                goal: activeOperation.goal,
                config: ulmConfig,
              }),
            )
      const now = Date.now()
      const timeoutExpiresAt = timeoutMillis === undefined ? undefined : now + timeoutMillis
      const info: PermissionV1.Request = {
        id,
        createdAt: new Date(now).toISOString(),
        timeoutAt: timeoutExpiresAt === undefined ? undefined : new Date(timeoutExpiresAt).toISOString(),
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool,
      }
      yield* Effect.logInfo("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, PermissionV1.RejectedError | PermissionV1.CorrectedError>()
      pending.set(id, { info, deferred, timeoutExpiresAt, timeoutWindowMillis: timeoutMillis })
      yield* events.publish(Event.Asked, info)
      const timeout =
        activeOperation === undefined || timeoutMillis === undefined
          ? undefined
          : Effect.gen(function* () {
              while (true) {
                const entry = pending.get(id)
                if (!entry?.timeoutExpiresAt) return
                const remaining = entry.timeoutExpiresAt - Date.now()
                if (remaining <= 0) break
                yield* Effect.sleep(`${remaining} millis`)
              }
              if (!pending.has(id)) return
              pending.delete(id)
              const sensitive = isSensitiveOperatorPrompt(
                [info.permission, ...info.patterns, JSON.stringify(info.metadata)].join(" "),
              )
              yield* Effect.promise(() =>
                recordOperatorTimeout(activeOperation.worktree, {
                  operationID: activeOperation.operationID,
                  kind: "permission",
                  requestID: String(id),
                  sessionID: info.sessionID,
                  fallback: "reject",
                  prompt: `${info.permission}: ${info.patterns.join(", ")}`,
                  sensitive,
                }),
              )
              yield* events.publish(Event.Replied, {
                sessionID: info.sessionID,
                requestID: info.id,
                reply: "reject",
              })
              return yield* new PermissionV1.CorrectedError({
                feedback:
                  "The operator is absent. Permission timed out and was rejected by unattended ULM policy; continue within existing authorized scope without retrying this same request.",
              })
            })
      return yield* Effect.ensuring(
        timeout ? Effect.raceFirst(Deferred.await(deferred), timeout) : Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const touch = Effect.fn("Permission.touch")(function* (input: { requestID: PermissionV1.ID; holdMillis?: number }) {
      const entry = (yield* InstanceState.get(state)).pending.get(input.requestID)
      if (!entry?.timeoutExpiresAt) return false
      const holdUntil =
        Date.now() +
        Math.max(
          entry.timeoutWindowMillis ?? 0,
          input.holdMillis ?? OPERATOR_ACTIVITY_HOLD_MILLIS,
          OPERATOR_ACTIVITY_RESET_MILLIS,
        )
      entry.timeoutExpiresAt = Math.max(entry.timeoutExpiresAt, holdUntil)
      entry.info = {
        ...entry.info,
        timeoutAt: new Date(entry.timeoutExpiresAt).toISOString(),
        holdUntil: new Date(holdUntil).toISOString(),
      }
      yield* events.publish(Event.Asked, entry.info)
      return true
    })

    const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new PermissionV1.NotFoundError({ requestID: input.requestID })

      pending.delete(input.requestID)
      yield* events.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
      })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* events.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
          })
          yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
        }
        return
      }

      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: "allow",
        })
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
        )
        if (!ok) continue
        pending.delete(id)
        yield* events.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
        })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, touch, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermissionV1.Info) {
  const ruleset: PermissionV1.Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule[] {
  return rulesets.flat()
}

export function disabled(tools: string[], ruleset: PermissionV1.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  return new Set(
    tools.filter((tool) => {
      const permission = edits.includes(tool) ? "edit" : tool
      const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
      return rule?.pattern === "*" && rule.action === "deny"
    }),
  )
}

export const defaultLayer = layer.pipe(Layer.provide(EventV2Bridge.defaultLayer))

export const node = LayerNode.make(layer, [EventV2Bridge.node])

export * as Permission from "."
