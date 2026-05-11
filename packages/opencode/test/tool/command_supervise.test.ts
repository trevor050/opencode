import { describe, expect, test } from "bun:test"
import { BackgroundJob } from "@/background/job"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID, SessionID } from "@/session/schema"
import { CommandSuperviseTool } from "@/tool/command_supervise"
import { Truncate } from "@/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Effect, Layer } from "effect"
import path from "path"

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  BackgroundJob.defaultLayer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Truncate.defaultLayer,
)

const ctx = {
  sessionID: SessionID.make("ses_command-supervise"),
  messageID: MessageID.make("msg_command-supervise"),
  callID: "call_command-supervise",
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("tool.command_supervise", () => {
  test("reports missing command profile variables without leaking Effect.tryPromise", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* CommandSuperviseTool
            const def = yield* tool.init()
            const exit = yield* def
              .execute(
                {
                  operationID: "school",
                  profileID: "icmp-sweep",
                  outputPrefix: "evidence/raw/sweep",
                  manifestPath: path.resolve(process.cwd(), "../../tools/ulmcode-profile/tool-manifest.json"),
                  dryRun: true,
                },
                ctx,
              )
              .pipe(Effect.exit)

            expect(exit._tag).toBe("Failure")
            if (exit._tag !== "Failure") return
            const message = String(Cause.squash(exit.cause))
            expect(message).toContain("command profile requires variable target")
            expect(message).not.toContain("Effect.tryPromise")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("rejects raw credential secrets before writing supervised command plans", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* CommandSuperviseTool
            const def = yield* tool.init()
            const exit = yield* def
              .execute(
                {
                  operationID: "school",
                  profileID: "icmp-sweep",
                  variables: {
                    target: "10.0.0.0/24",
                    password: "Summer2026!",
                  },
                  outputPrefix: "evidence/raw/sweep",
                  manifestPath: path.resolve(process.cwd(), "../../tools/ulmcode-profile/tool-manifest.json"),
                  dryRun: true,
                },
                ctx,
              )
              .pipe(Effect.exit)

            expect(exit._tag).toBe("Failure")
            if (exit._tag !== "Failure") return
            const message = String(Cause.squash(exit.cause))
            expect(message).toContain("supervised command inputs must not contain raw credential secrets")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
