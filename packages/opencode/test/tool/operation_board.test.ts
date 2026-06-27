import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { writeOperationCheckpoint } from "@/ulm/artifact"
import { buildOperationBoard } from "@/ulm/operation-board"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  locationServiceMapLayer,
  Session.defaultLayer,
  SessionStatus.defaultLayer,
  Storage.defaultLayer,
  ToolRegistry.defaultLayer,
  Truncate.defaultLayer,
)

describe("tool.operation_board", () => {
  test("writes and returns the read-only operation board", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationCheckpoint(dir.path, {
      operationID: "School",
      objective: "Authorized district assessment",
      stage: "validation",
      status: "running",
      summary: "Reviewing identity posture.",
    })
    const result = await buildOperationBoard(dir.path, { operationID: "School" })

    expect(result.operationID).toBe("school")
    expect(result.markdown).toContain("## Current Objective")
    expect(result.markdown).toContain("Authorized district assessment")
  })

  test("registers operation_board as a built-in tool", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()
            expect(ids).toContain("operation_board")
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })
})
