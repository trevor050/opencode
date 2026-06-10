import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { OperationCheckpointTool } from "@/tool/operation_checkpoint"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { readOperationStatus } from "@/ulm/artifact"
import { createOperationGoal } from "@/ulm/operation-goal"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  LocationServiceMap.layer,
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

describe("tool.operation_checkpoint", () => {
  test("uses operation_goal objective when checkpointing a goal-only operation", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              createOperationGoal(Instance.worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
              }),
            )

            const tool = yield* OperationCheckpointTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
                stage: "mapping",
                status: "running",
                summary: "Evidence mapped.",
              },
              context,
            )

            const status = yield* Effect.promise(() => readOperationStatus(Instance.worktree, "school"))
            expect(result.metadata.operationID).toBe("school")
            expect(status.operation?.objective).toBe("Authorized school assessment")
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })
})
