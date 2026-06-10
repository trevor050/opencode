import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { Database } from "@opencode-ai/core/database/database"
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
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { OperationResumeTool } from "@/tool/operation_resume"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Storage } from "@/storage/storage"
import { writeOperationCheckpoint, writeOperationPlan, writeRuntimeSummary } from "@/ulm/artifact"
import { createOperationGoal } from "@/ulm/operation-goal"
import { operationForSession } from "@/ulm/operation-context"
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
  Database.defaultLayer,
  EventV2Bridge.defaultLayer,
  RuntimeFlags.layer({ experimentalBackgroundSubagents: true }),
  Storage.defaultLayer,
  ToolRegistry.defaultLayer,
  Truncate.defaultLayer,
)

describe("tool.operation_resume", () => {
  test("normalizes legacy sparse operation checkpoints", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const root = path.join(Instance.worktree, ".ulmcode", "operations", "school")
            yield* Effect.promise(() => fs.mkdir(root, { recursive: true }))
            yield* Effect.promise(() =>
              fs.writeFile(
                path.join(root, "operation.json"),
                JSON.stringify({
                  operationID: "school",
                  objective: "Authorized school assessment",
                  status: "active",
                  createdAt: "2026-05-12T02:20:00Z",
                }),
              ),
            )

            const tool = yield* OperationResumeTool
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

            expect(result.title).toBe("Resume school: attention_required")
            expect(result.output).toContain("operation plan is missing")
            expect(result.output).toContain("\"stage\": \"intake\"")
            expect(result.output).toContain("\"status\": \"running\"")
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })

  test("prints a restart brief before raw resume json", async () => {
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
            yield* Effect.promise(() =>
              writeOperationCheckpoint(Instance.worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "recon",
                status: "running",
                summary: "Recon lane started.",
                nextActions: ["Check task outputs"],
                activeTasks: ["task-recon-1"],
              }),
            )

            const tool = yield* OperationResumeTool
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

            expect(result.title).toBe("Resume school: attention_required")
            expect(result.output).toStartWith("# Resume school")
            expect(result.output).toContain("operation plan is missing")
            expect(result.output).toContain("<operation_resume_json>")
            expect(result.output).toContain("\"operationID\": \"school\"")
            expect(result.metadata.health.ready).toBe(false)
            expect((yield* Effect.promise(() => operationForSession(dir.path, "session-1" as any)))?.operationID).toBe("school")
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })

  test("marks runtime blind-spot notes as resume health gaps", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              writeOperationCheckpoint(Instance.worktree, {
                operationID: "school",
                objective: "Authorized school assessment",
                stage: "validation",
                status: "running",
                summary: "Validation lane started.",
                nextActions: ["Review validation output"],
              }),
            )
            yield* Effect.promise(() =>
              writeOperationPlan(Instance.worktree, {
                operationID: "school",
                phases: [
                  {
                    stage: "validation",
                    objective: "Validate recorded evidence.",
                    actions: ["Review validation output"],
                    successCriteria: ["Validation has report-ready evidence"],
                    subagents: ["validator"],
                    noSubagents: ["Final severity stays with primary operator"],
                  },
                ],
                reportingCloseout: ["Run report_lint", "Run report_render", "Run runtime_summary"],
              }),
            )
            yield* Effect.promise(() =>
              writeRuntimeSummary(Instance.worktree, {
                operationID: "school",
                notes: [
                  "runtime blind spot: background task task-validator-1 (validator) has no readable session ledger or runtime snapshot; token/cost totals may be undercounted.",
                ],
              }),
            )

            const tool = yield* OperationResumeTool
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

            expect(result.title).toBe("Resume school: attention_required")
            expect(result.metadata.health.ready).toBe(false)
            expect(result.metadata.health.gaps).toContain(
              "runtime usage blind spot recorded: runtime blind spot: background task task-validator-1 (validator) has no readable session ledger or runtime snapshot; token/cost totals may be undercounted.",
            )
            expect(result.output).toContain("runtime_summary")
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })
})
