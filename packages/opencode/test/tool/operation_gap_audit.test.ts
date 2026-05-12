import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { MessageID } from "@/session/schema"
import { OperationGapAuditTool } from "@/tool/operation_gap_audit"
import { Truncate } from "@/tool/truncate"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeRuntimeSummary } from "@/ulm/artifact"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_gap_audit", () => {
  test("writes a durable gap audit and returns raw json for scheduler decisions", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() => writeOperationGraph(Instance.worktree, { operationID: "school", budgetUSD: 10 }))
            yield* Effect.promise(() =>
              writeRuntimeSummary(Instance.worktree, {
                operationID: "school",
                usage: { costUSD: 1, budgetUSD: 10 },
                compaction: { pressure: "low" },
              }),
            )

            const tool = yield* OperationGapAuditTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              { operationID: "school", runtimeRemainingSeconds: 3600 },
              {
                sessionID: "session-1" as any,
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            expect(result.output).toContain("# Operation Gap Audit: school")
            expect(result.output).toContain("<operation_gap_audit_json>")
            expect(result.metadata.json).toEndWith("gap-audit.json")
            expect(result.metadata.gaps).toBeGreaterThan(0)
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
