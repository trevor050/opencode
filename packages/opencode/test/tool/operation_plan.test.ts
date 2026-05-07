import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MessageID, SessionID } from "@/session/schema"
import { OperationPlanTool } from "@/tool/operation_plan"
import { Truncate } from "@/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Config.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_plan", () => {
  test("accepts Discovery Charter calls before final plan fields exist", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "home-network-hardrun-20260507",
                planningMode: "discovery-charter",
                templateName: "home-network-discovery-charter",
                trustLevel: "unattended",
                scanProfile: "aggressive",
                browserEvidence: true,
                operationMemory: true,
                reportDesignProfile: "standard",
                discoveryCharter: {
                  purpose: "Research, recon, and operator-question strategy before writing the full operation plan.",
                  researchQuestions: ["What is in scope?", "Which auth surfaces exist?", "What evidence is needed?"],
                  reconInvestments: ["Passive inventory", "Login surface map", "Safe service classification"],
                  operatorQuestions: ["Are credentials available?", "Are disruptive checks excluded?"],
                  candidateDeepWorkLanes: ["Router review", "IoT inventory", "Authenticated portal validation"],
                  decisionCriteriaForFullPlan: ["Safe lanes exist", "Credentials are known", "Report closeout is budgeted"],
                },
              },
              {
                sessionID: SessionID.make("session-1"),
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )

            expect(result.title).toContain("Discovery Charter")
            expect(result.output).toContain("discovery-charter.md")
            expect(result.metadata.phases).toBe(0)
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("persists kickoff-approved Discovery Charter approval state", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationPlanTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "home-network-hardrun-20260507",
                planningMode: "discovery-charter",
                planningApproval: {
                  status: "approved",
                  discoveryCharterPath: "plans/discovery-charter.md",
                  approver: "operator kickoff",
                  notes: ["Operator asked the agent to work autonomously until the stated stop time."],
                },
                discoveryCharter: {
                  purpose: "Research, recon, and operator-question strategy before writing the full operation plan.",
                  researchQuestions: ["What is in scope?", "Which auth surfaces exist?", "What evidence is needed?"],
                  reconInvestments: ["Passive inventory", "Login surface map", "Safe service classification"],
                  operatorQuestions: ["Are credentials available?", "Are disruptive checks excluded?"],
                  candidateDeepWorkLanes: ["Router review", "IoT inventory", "Authenticated portal validation"],
                  decisionCriteriaForFullPlan: ["Safe lanes exist", "Credentials are known", "Report closeout is budgeted"],
                },
              },
              {
                sessionID: SessionID.make("session-1"),
                messageID: MessageID.ascending(),
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata: () => Effect.void,
                ask: () => Effect.void,
              },
            )
            const record = yield* Effect.promise(() => fs.readFile(result.metadata.json, "utf8").then(JSON.parse))

            expect(record.planningApproval.status).toBe("approved")
            expect(record.planningApproval.approver).toBe("operator kickoff")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })
})
