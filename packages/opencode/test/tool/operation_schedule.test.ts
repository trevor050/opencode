import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Exit, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { MessageID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { OperationScheduleTool } from "@/tool/operation_schedule"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { operationPath } from "@/ulm/artifact"
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

describe("tool.operation_schedule", () => {
  test("rejects force reschedules after operation execution has started", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() => writeOperationGraph(Instance.worktree, { operationID: "school", budgetUSD: 10 }))
            const root = operationPath(Instance.worktree, "school")
            yield* Effect.promise(async () => {
              await fs.mkdir(path.join(root, "lane-complete"), { recursive: true })
              await fs.writeFile(
                path.join(root, "lane-complete", "recon.json"),
                `${JSON.stringify({
                  operationID: "school",
                  laneID: "recon",
                  status: "completed",
                  completedAt: "2026-01-01T00:00:00.000Z",
                  summary: "Initial lane proof.",
                  artifacts: [],
                  evidenceRefs: [],
                })}\n`,
              )
            })

            const tool = yield* OperationScheduleTool
            const def = yield* tool.init()
            const exit = yield* Effect.exit(
              def.execute(
                {
                  operationID: "school",
                  template: "school-laptop-48h",
                  forceReschedule: true,
                },
                context,
              ),
            )

            expect(Exit.isFailure(exit)).toBe(true)
            if (exit._tag === "Failure") {
              expect(String(exit.cause)).toContain("forceReschedule cannot be used after operation execution has started")
            }
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })

  test("allows force reschedules before operation execution has started", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() => writeOperationGraph(Instance.worktree, { operationID: "school", budgetUSD: 10 }))

            const tool = yield* OperationScheduleTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
                template: "school-laptop-48h",
                forceReschedule: true,
              },
              context,
            )

            expect(result.metadata.operationID).toBe("school")
            expect(result.output).toContain("archived_stale_lane_proofs: 0")
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })
})
