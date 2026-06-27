import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
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
import { OperationStrategyTool } from "@/tool/operation_strategy"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { operationPath, writeRuntimeSummary } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
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

const context = {
  sessionID: "session-1" as any,
  messageID: MessageID.ascending(),
  agent: "pentest",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.operation_strategy", () => {
  test("writes strategist prompt and normalized next-action artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })
    await writeRuntimeSummary(dir.path, {
      operationID: "School",
      usage: { costUSD: 1, budgetUSD: 10 },
      compaction: { pressure: "low" },
    })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationStrategyTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "School",
                horizonItems: 4,
                operatorFocus: "Prioritize logged-in SIS and identity admin workflows.",
              },
              context,
            )
            const root = operationPath(dir.path, "School")
            const memo = JSON.parse(
              yield* Effect.promise(() => fs.readFile(path.join(root, "strategy", "next-actions.json"), "utf8")),
            )
            const markdown = yield* Effect.promise(() => fs.readFile(path.join(root, "strategy", "next-actions.md"), "utf8"))
            const prompt = yield* Effect.promise(() => fs.readFile(path.join(root, "strategy", "strategist-prompt.md"), "utf8"))

            expect(result.metadata.operationID).toBe("school")
            expect(result.metadata.json).toBe(path.join(root, "strategy", "next-actions.json"))
            expect(result.output).toContain("<operation_strategy_json>")
            expect(memo.items.length).toBeGreaterThan(0)
            expect(memo.items[0].title).toContain("identity")
            expect(markdown).toContain("## Next Strategy Items")
            expect(prompt).toContain("Prioritize logged-in SIS and identity admin workflows.")
            expect(prompt).toContain("Findings:")
            expect(prompt).toContain("Runtime:")
            expect(prompt).toContain("sis-role-export-review")
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })

  test("registers operation_strategy as a built-in tool", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            const ids = yield* registry.ids()
            expect(ids).toContain("operation_strategy")
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })
})
