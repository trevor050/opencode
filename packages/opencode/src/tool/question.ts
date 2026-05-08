import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"
import { Instance } from "@/project/instance"
import { approveOperationDiscoveryCharter } from "@/ulm/artifact"
import { activeOperationForContext } from "@/ulm/operation-context"

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
  operationApproval?: {
    operationID: string
    artifact: string
    status: "approved"
  }
}

function shouldRecordDiscoveryCharterApproval(params: Schema.Schema.Type<typeof Parameters>, answers: ReadonlyArray<Question.Answer>) {
  return params.questions.some((question, index) => {
    const prompt = `${question.header ?? ""} ${question.question}`.toLowerCase()
    const response = (answers[index] ?? []).join(" ").toLowerCase()
    return prompt.includes("discovery charter") && prompt.includes("approve") && response.includes("approve")
  })
}

function validateULMQuestionBatch(params: Schema.Schema.Type<typeof Parameters>) {
  for (const item of params.questions) {
    const text = `${item.header} ${item.question}`.toLowerCase()
    const isPentestKickoff =
      text.includes("pentest") ||
      text.includes("home-network") ||
      text.includes("network") ||
      text.includes("scope") ||
      text.includes("safety") ||
      text.includes("credential") ||
      text.includes("install") ||
      text.includes("exclusion") ||
      text.includes("report")
    if (isPentestKickoff) {
      const pauseAbort = item.options.find((option) => /\bpause\b|\babort\b|pause\s*\/\s*abort/i.test(option.label))
      if (pauseAbort) {
        throw new Error(
          `ULM kickoff questions must not include "${pauseAbort.label}" as an answer option. Ask only real decision options; unanswered questions use the configured conservative timeout fallback.`,
        )
      }
    }
    if (!text.includes("credential")) continue
    const labels = item.options.map((option) => option.label.toLowerCase())
    const first = labels[0] ?? ""
    if (first.includes("no credentials") && first.includes("recommended")) {
      throw new Error(
        'Credential kickoff questions must not recommend "No credentials". Put the affirmative vault option first, for example "Open vault (Recommended if available)", and explain that secrets go only into the secure vault.',
      )
    }
    if (text.includes("if unavailable") || text.includes("unauthenticated testing only")) {
      throw new Error(
        'Credential kickoff copy must not say "if unavailable, I will do unauthenticated testing only". Ask whether credentials are available, say yes opens the secure vault, and include a neutral skip option.',
      )
    }
  }
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          validateULMQuestionBatch(params)
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })
          const approval = shouldRecordDiscoveryCharterApproval(params, answers)
            ? yield* Effect.tryPromise(async () => {
                const active = await activeOperationForContext({
                  worktree: Instance.worktree,
                  directory: Instance.directory,
                  sessionID: ctx.sessionID,
                })
                if (!active) return undefined
                return approveOperationDiscoveryCharter(Instance.worktree, {
                  operationID: active.operationID,
                  approver: "operator",
                  notes: ["Approved through Discovery Charter question response."],
                })
              }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            : undefined

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")
          const approvalOutput = approval
            ? `\n\nDiscovery Charter approval recorded for operation ${approval.operationID}: ${approval.markdown}`
            : ""

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.${approvalOutput}`,
            metadata: {
              answers,
              operationApproval: approval
                ? {
                    operationID: approval.operationID,
                    artifact: "discovery_charter",
                    status: "approved" as const,
                  }
                : undefined,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
