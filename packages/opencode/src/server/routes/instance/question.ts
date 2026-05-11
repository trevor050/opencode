import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { QuestionID } from "@/question/schema"
import { Question } from "@/question"
import z from "zod"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const Reply = z.object({
  answers: Question.Answer.zod
    .array()
    .describe("User answers in order of questions (each answer is an array of selected labels)"),
})
const Touch = z.object({
  holdMillis: z.number().optional(),
  answers: Question.Answer.zod.array().optional(),
})

export const QuestionRoutes = lazy(() => {
  const app = new Hono()
  app.get(
    "/",
    describeRoute({
      summary: "List pending questions",
      description: "Get all pending question requests across all sessions.",
      operationId: "question.list",
      responses: {
        200: {
          description: "List of pending questions",
          content: {
            "application/json": {
              schema: resolver(Question.Request.zod.array()),
            },
          },
        },
      },
    }),
    async (c) =>
      jsonRequest("QuestionRoutes.list", c, function* () {
        const svc = yield* Question.Service
        return yield* svc.list()
      }),
  )
  app.post(
    "/:requestID/reply",
    describeRoute({
      summary: "Reply to question request",
      description: "Provide answers to a question request from the AI assistant.",
      operationId: "question.reply",
      responses: {
        200: {
          description: "Question answered successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        requestID: QuestionID.zod,
      }),
    ),
    validator("json", Reply),
    async (c) =>
      jsonRequest("QuestionRoutes.reply", c, function* () {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const svc = yield* Question.Service
        yield* svc.reply({
          requestID: params.requestID,
          answers: json.answers,
        })
        return true
      }),
  )
  app.post(
    "/:requestID/reject",
    describeRoute({
      summary: "Reject question request",
      description: "Reject a question request from the AI assistant.",
      operationId: "question.reject",
      responses: {
        200: {
          description: "Question rejected successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        requestID: QuestionID.zod,
      }),
    ),
    async (c) =>
      jsonRequest("QuestionRoutes.reject", c, function* () {
        const params = c.req.valid("param")
        const svc = yield* Question.Service
        yield* svc.reject(params.requestID)
        return true
      }),
  )
  app.post(
    "/:requestID/touch",
    describeRoute({
      summary: "Touch question request",
      description: "Extend a pending question timeout while the operator is actively reviewing or typing.",
      operationId: "question.touch",
      responses: {
        200: {
          description: "Question timeout extended successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        requestID: QuestionID.zod,
      }),
    ),
    validator("json", Touch),
    async (c) =>
      jsonRequest("QuestionRoutes.touch", c, function* () {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const svc = yield* Question.Service
        return yield* svc.touch({
          requestID: params.requestID,
          holdMillis: json.holdMillis,
          answers: json.answers,
        })
      }),
  )
  return app
})
