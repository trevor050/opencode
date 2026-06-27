import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { Instance } from "@/project/instance"
import { LaptopPreflightTool } from "@/tool/laptop_preflight"
import { Truncate } from "@/tool/truncate"
import { operationPath } from "@/ulm/artifact"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { writeRuntimeSupervisor } from "@/ulm/runtime-supervisor"
import { MessageID } from "@/session/schema"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const packageRoot = path.join(__dirname, "../..")
const testConfigDir = path.join(packageRoot, ".artifacts", "laptop-preflight-tool-test-config")
const profileConfigPath = path.resolve(packageRoot, "../../tools/ulmcode-profile/opencode.json")
const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

await fs.mkdir(testConfigDir, { recursive: true })
await fs.copyFile(profileConfigPath, path.join(testConfigDir, "opencode.json"))
await fs.copyFile(profileConfigPath, path.join(testConfigDir, "ulmcode.json"))

const testLaunchEnv: NodeJS.ProcessEnv = {
  OPENCODE_APP_NAME: "ulmcode",
  OPENCODE_CONFIG_DIR: testConfigDir,
  OPENCODE_CONFIG: path.join(testConfigDir, "opencode.json"),
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n")
}

async function writeReadyOperation(worktree: string, operationID: string) {
  const root = operationPath(worktree, operationID)
  await writeOperationGraph(worktree, { operationID, budgetUSD: 20 })
  await writeJson(path.join(root, "goals", "operation-goal.json"), {
    operationID,
    objective: "Authorized school assessment",
    targetDurationHours: 48,
  })
  await writeJson(path.join(root, "plans", "operation-plan.json"), {
    operationID,
    timeBudget: { targetHours: 48 },
    phases: [],
  })
  await writeRuntimeSupervisor({
    operationID,
    worktree,
    bunPath: "bun",
    scriptPath: path.join(packageRoot, "script", "ulm-runtime-daemon.ts"),
    durationSeconds: 48 * 60 * 60,
    intervalSeconds: 60,
    schedulerCyclesPerTick: 1,
    supervisor: "all",
  })
  await fs.mkdir(path.join(root, "reports"), { recursive: true })
  await fs.writeFile(path.join(root, "reports", "report-outline.md"), "# Report Outline\n\n- target_pages: 50\n")
  return root
}

describe("tool.laptop_preflight", () => {
  test("audits launch readiness and writes durable preflight artifacts", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: (ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const operationID = "school"
            const root = yield* Effect.promise(() => writeReadyOperation(Instance.worktree, operationID))
            const manifestPath = path.join(dir.path, "tool-manifest.json")
            yield* Effect.promise(() =>
              writeJson(manifestPath, {
                tools: [
                  {
                    id: "fixture-tool",
                    category: "test",
                    purpose: "fixture",
                    validate: "true",
                    install: [],
                    fallbacks: [],
                  },
                ],
                commandProfiles: [],
              }),
            )
            const tool = yield* LaptopPreflightTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID,
                preparePrerequisites: true,
                toolManifestPath: manifestPath,
                operatorConfirmed: ["power", "sleep", "wifi", "scope", "clock"],
              },
              {
                sessionID: "session-1" as any,
                messageID: MessageID.ascending(),
                agent: "pentest",
                abort: new AbortController().signal,
                messages: [],
                extra: { modelRouteLaunchEnv: testLaunchEnv },
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            expect(result.title).toBe("laptop preflight ready")
            expect(result.output).toContain("<laptop_preflight_json>")
            expect(result.metadata.status).toBe("ready")
            expect(result.metadata.gaps).toEqual([])
            expect(result.metadata.files.json).toBe(path.join(root, "scheduler", "laptop-preflight.json"))
            expect(yield* Effect.promise(() => fs.readFile(result.metadata.files.markdown, "utf8"))).toContain("operator-sleep")
          }).pipe(Effect.provide(layer), Effect.provideService(InstanceRef, ctx)),
        ),
    })
  })
})
