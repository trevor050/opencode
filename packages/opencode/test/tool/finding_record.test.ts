import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
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
import { FindingRecordTool } from "@/tool/finding_record"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { operationPath } from "@/ulm/artifact"
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

describe("tool.finding_record", () => {
  test("accepts percent-style confidence values from model tool calls", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* FindingRecordTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "school",
                findingID: "FIND-001",
                title: "SSH user has Windows Administrator privileges",
                state: "validated",
                severity: "high",
                confidence: 100,
                affectedAssets: ["192.168.1.151"],
                evidence: [{ id: "ev-pc-admin-008", summary: "BUILTIN\\Administrators membership" }],
                description: "The SSH user is a local administrator.",
                impact: "Compromise of the SSH key grants full administrative control.",
                remediation: "Use a non-admin SSH account and rotate keys.",
              },
              context,
            )

            expect(result.metadata.findingID).toBe("find-001")
            const record = yield* Effect.promise(async () =>
              JSON.parse(
                await fs.readFile(
                  path.join(operationPath(Instance.worktree, "school"), "findings", "find-001.json"),
                  "utf8",
                ),
              ),
            )
            expect(record.confidence).toBe(1)
          }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, ctx)) as Effect.Effect<void, never, never>,
        ),
    })
  })
})
