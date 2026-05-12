import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/question"
const ReplyPayload = Schema.Struct({
  answers: Schema.Array(Question.Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
})
const TouchPayload = Schema.Struct({
  holdMillis: Schema.optional(Schema.Number),
  answers: Schema.optional(Schema.Array(Question.Answer)),
})

export const QuestionApi = HttpApi.make("question")
  .add(
    HttpApiGroup.make("question")
      .add(
        HttpApiEndpoint.get("list", root, {
          success: described(Schema.Array(Question.Request), "List of pending questions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "question.list",
            summary: "List pending questions",
            description: "Get all pending question requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
          params: { requestID: QuestionID },
          payload: ReplyPayload,
          success: described(Schema.Boolean, "Question answered successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "question.reply",
            summary: "Reply to question request",
            description: "Provide answers to a question request from the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("reject", `${root}/:requestID/reject`, {
          params: { requestID: QuestionID },
          success: described(Schema.Boolean, "Question rejected successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "question.reject",
            summary: "Reject question request",
            description: "Reject a question request from the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("touch", `${root}/:requestID/touch`, {
          params: { requestID: QuestionID },
          payload: TouchPayload,
          success: described(Schema.Boolean, "Question timeout extended successfully"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "question.touch",
            summary: "Touch question request",
            description: "Extend a pending question timeout while the operator is actively reviewing or typing.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "question",
          description: "Question routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode HttpApi",
      version: "0.0.1",
      description: "Effect HttpApi surface for instance routes.",
    }),
  )
