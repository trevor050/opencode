import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { OperationRunTool } from "@/tool/operation_run"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { writeRuntimeSummary } from "@/ulm/artifact"
import { bindOperationSession } from "@/ulm/operation-context"
import { createOperationGoal } from "@/ulm/operation-goal"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Session.defaultLayer,
  SessionStatus.defaultLayer,
  Storage.defaultLayer,
  ToolRegistry.defaultLayer,
  Truncate.defaultLayer,
)

const context = {
  sessionID: "session-1" as any,
  messageID: MessageID.ascending(),
  agent: "pentest",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.operation_run", () => {
  test("uses the session-bound operation when operationID is omitted without advancing lanes", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              createOperationGoal(Instance.worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                targetDurationHours: 2,
              }),
            )
            yield* Effect.promise(() => bindOperationSession(Instance.worktree, { sessionID: context.sessionID, operationID: "school" }))
            yield* Effect.promise(() => writeOperationGraph(Instance.worktree, { operationID: "school", budgetUSD: 0 }))
            yield* Effect.promise(() => writeRuntimeSummary(Instance.worktree, { operationID: "school" }))

            const tool = yield* OperationRunTool
            const def = yield* tool.init()
            const result = yield* def.execute({}, context)

            expect(result.metadata.operationID).toBe("school")
            expect(result.metadata.action).toBe("wait")
            expect(result.output).toContain("# Operation Run Step: school")
            expect(result.output).toContain("operation_run advance is scheduler-owned")
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })

  test("does not fall back to the newest active operation for an unbound session", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              createOperationGoal(Instance.worktree, {
                operationID: "stale",
                objective: "Do not inherit me",
                targetDurationHours: 2,
              }),
            )
            yield* Effect.promise(() => writeOperationGraph(Instance.worktree, { operationID: "stale", budgetUSD: 0 }))
            yield* Effect.promise(() => writeRuntimeSummary(Instance.worktree, { operationID: "stale" }))

            const tool = yield* OperationRunTool
            const def = yield* tool.init()

            const exit = yield* Effect.exit(def.execute({}, context))
            expect(Exit.isFailure(exit)).toBe(true)
            if (exit._tag === "Failure")
              expect(String(exit.cause)).toContain("operationID is required unless this session is bound to an active ULM operation")
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })
})
