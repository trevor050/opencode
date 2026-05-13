import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { QuestionTool } from "../../src/tool/question"
import { Question } from "../../src/question"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"
import { createOperationGoal } from "@/ulm/operation-goal"
import { bindOperationSession } from "@/ulm/operation-context"
import { writeOperationDiscoveryCharter } from "@/ulm/artifact"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("msg_test-message"),
  callID: "test-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const layer = Layer.mergeAll(Question.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer)
const it = testEffect(layer)

const pending = Effect.fn("QuestionToolTest.pending")(function* (question: Question.Interface) {
  for (;;) {
    const items = yield* question.list()
    const item = items[0]
    if (item) return item
    yield* Effect.sleep("10 millis")
  }
})

describe("tool.question", () => {
  it.instance("should successfully execute with valid question parameters", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "What is your favorite color?",
          header: "Color",
          options: [
            { label: "Red", description: "The color of passion" },
            { label: "Blue", description: "The color of sky" },
          ],
          multiple: false,
        },
      ]

      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({ requestID: item.id, answers: [["Red"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.title).toBe("Asked 1 question")
    }),
  )

  it.instance("should now pass with a header longer than 12 but less than 30 chars", () =>
    Effect.gen(function* () {
      const question = yield* Question.Service
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const questions = [
        {
          question: "What is your favorite animal?",
          header: "This Header is Over 12",
          options: [{ label: "Dog", description: "Man's best friend" }],
        },
      ]

      const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
      const item = yield* pending(question)
      yield* question.reply({ requestID: item.id, answers: [["Dog"]] })

      const result = yield* Fiber.join(fiber)
      expect(result.output).toContain(`"What is your favorite animal?"="Dog"`)
    }),
  )

  test("records Discovery Charter approval on the active session-bound operation", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const sessionID = SessionID.make("ses_question-approval")
            yield* Effect.promise(() =>
              createOperationGoal(dir.path, {
                operationID: "home-network-run",
                objective: "Authorized test operation",
                targetDurationHours: 4,
              }),
            )
            yield* Effect.promise(() =>
              bindOperationSession(dir.path, {
                sessionID,
                operationID: "home-network-run",
                source: "test",
              }),
            )
            yield* Effect.promise(() =>
              writeOperationDiscoveryCharter(dir.path, {
                operationID: "home-network-run",
                discoveryCharter: {
                  purpose: "Bounded discovery before full plan.",
                  researchQuestions: ["What is live?"],
                  reconInvestments: ["Safe inventory"],
                  operatorQuestions: ["Approve charter?"],
                  candidateDeepWorkLanes: ["Router review"],
                  decisionCriteriaForFullPlan: ["Enough targets exist"],
                },
              }),
            )

            const question = yield* Question.Service
            const toolInfo = yield* QuestionTool
            const tool = yield* toolInfo.init()
            const fiber = yield* tool
              .execute(
                {
                  questions: [
                    {
                      question: "Discovery Charter is written. Approve this charter?",
                      header: "Approve charter",
                      options: [
                        { label: "Approve charter", description: "Proceed with bounded discovery." },
                        { label: "Revise charter", description: "Pause for changes." },
                      ],
                    },
                  ],
                },
                { ...ctx, sessionID },
              )
              .pipe(Effect.forkScoped)
            const item = yield* pending(question)
            yield* question.reply({ requestID: item.id, answers: [["Approve charter"]] })

            const result = yield* Fiber.join(fiber)
            expect(result.output).toContain("Discovery Charter approval recorded")
            expect(result.metadata.operationApproval?.status).toBe("approved")
            const record = yield* Effect.promise(
              async () =>
                (await Bun.file(`${dir.path}/.ulmcode/operations/home-network-run/plans/discovery-charter.json`).json()) as {
                  planningApproval: { status: string }
                },
            )
            expect(record.planningApproval.status).toBe("approved")
          }).pipe(Effect.scoped, Effect.provide(layer)),
        ),
    })
  })

  it.instance("rejects credential kickoff questions that recommend no credentials", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()

      const exit = yield* tool
        .execute(
          {
            questions: [
              {
                question:
                  "Credentials: do you have router/admin/app/device credentials you want used for authenticated checks? If unavailable, I'll do unauthenticated testing only.",
                header: "Credentials",
                options: [
                  { label: "No credentials (Recommended)", description: "Proceed unauthenticated." },
                  { label: "Credentials available", description: "Open secure vault." },
                ],
              },
            ],
          },
          ctx,
        )
        .pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") throw new Error("expected question tool to reject the credential anti-pattern")
      expect(String(exit.cause)).toContain('must not recommend "No credentials"')
    }),
  )

  it.instance("rejects pause or abort options in ULM kickoff questions", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()

      const exit = yield* tool
        .execute(
          {
            questions: [
              {
                question: "Round 2 scope authorization: what may I test from this host during the autonomous run?",
                header: "Scope",
                options: [
                  { label: "LAN + gateway", description: "Test local LAN and gateway." },
                  { label: "Pause/abort", description: "Do not continue." },
                ],
              },
            ],
          },
          ctx,
        )
        .pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      if (exit._tag !== "Failure") throw new Error("expected question tool to reject pause/abort option")
      expect(String(exit.cause)).toContain("must not include")
    }),
  )

  // intentionally removed the zod validation due to tool call errors, hoping prompting is gonna be good enough
  //   test("should throw an Error for header exceeding 30 characters", async () => {
  //     const tool = await QuestionTool.init()
  //     const questions = [
  //       {
  //         question: "What is your favorite animal?",
  //         header: "This Header is Definitely More Than Thirty Characters Long",
  //         options: [{ label: "Dog", description: "Man's best friend" }],
  //       },
  //     ]
  //     try {
  //       await tool.execute({ questions }, ctx)
  //       // If it reaches here, the test should fail
  //       expect(true).toBe(false)
  //     } catch (e: any) {
  //       expect(e).toBeInstanceOf(Error)
  //       expect(e.cause).toBeInstanceOf(z.ZodError)
  //     }
  //   })

  //   test("should throw an Error for label exceeding 30 characters", async () => {
  //     const tool = await QuestionTool.init()
  //     const questions = [
  //       {
  //         question: "A question with a very long label",
  //         header: "Long Label",
  //         options: [
  //           { label: "This is a very, very, very long label that will exceed the limit", description: "A description" },
  //         ],
  //       },
  //     ]
  //     try {
  //       await tool.execute({ questions }, ctx)
  //       // If it reaches here, the test should fail
  //       expect(true).toBe(false)
  //     } catch (e: any) {
  //       expect(e).toBeInstanceOf(Error)
  //       expect(e.cause).toBeInstanceOf(z.ZodError)
  //     }
  //   })
})
