import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { jsonRequest } from "./trace"

const Touch = z.object({
  holdMillis: z.number().optional(),
})

export const PermissionRoutes = lazy(() => {
  const app = new Hono()
  app.post(
    "/:requestID/reply",
    describeRoute({
      summary: "Respond to permission request",
      description: "Approve or deny a permission request from the AI assistant.",
      operationId: "permission.reply",
      responses: {
        200: {
          description: "Permission processed successfully",
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
        requestID: PermissionID.zod,
      }),
    ),
    validator("json", z.object({ reply: Permission.Reply.zod, message: z.string().optional() })),
    async (c) =>
      jsonRequest("PermissionRoutes.reply", c, function* () {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const svc = yield* Permission.Service
        yield* svc.reply({
          requestID: params.requestID,
          reply: json.reply,
          message: json.message,
        })
        return true
      }),
  )
  app.get(
    "/",
    describeRoute({
      summary: "List pending permissions",
      description: "Get all pending permission requests across all sessions.",
      operationId: "permission.list",
      responses: {
        200: {
          description: "List of pending permissions",
          content: {
            "application/json": {
              schema: resolver(Permission.Request.zod.array()),
            },
          },
        },
      },
    }),
    async (c) =>
      jsonRequest("PermissionRoutes.list", c, function* () {
        const svc = yield* Permission.Service
        return yield* svc.list()
      }),
  )
  app.post(
    "/:requestID/touch",
    describeRoute({
      summary: "Touch permission request",
      description: "Extend a pending permission timeout while the operator is actively reviewing.",
      operationId: "permission.touch",
      responses: {
        200: {
          description: "Permission timeout extended successfully",
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
        requestID: PermissionID.zod,
      }),
    ),
    validator("json", Touch),
    async (c) =>
      jsonRequest("PermissionRoutes.touch", c, function* () {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        const svc = yield* Permission.Service
        return yield* svc.touch({
          requestID: params.requestID,
          holdMillis: json.holdMillis,
        })
      }),
  )
  return app
})
