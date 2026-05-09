import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { MessageID } from "@/session/schema"
import { OperationStatusTool } from "@/tool/operation_status"
import { Truncate } from "@/tool/truncate"
import { writeOperationCheckpoint } from "@/ulm/artifact"
import { createOperationGoal } from "@/ulm/operation-goal"
import { operationForSession } from "@/ulm/operation-context"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_status", () => {
  test("prints a compact dashboard before raw status json", async () => {
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
              }),
            )
            yield* Effect.promise(() =>
              writeOperationCheckpoint(Instance.worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation running.",
                riskLevel: "high",
              }),
            )

            const tool = yield* OperationStatusTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              { operationID: "school" },
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

            expect(result.output).toStartWith("# school - validation/running")
            expect(result.output).toContain("risk: high")
            expect(result.output).toContain("<operation_status_json>")
            expect(result.output).toContain("\"operationID\": \"school\"")
            expect((yield* Effect.promise(() => operationForSession(dir.path, "session-1" as any)))?.operationID).toBe("school")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
