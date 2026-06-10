import { Schema } from "effect"
import { HttpApi } from "effect/unstable/httpapi"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceDisposed } from "@/server/event"
import { Question } from "@/question"
import { OperationEvent } from "@/ulm/event"
import { ConfigApi } from "./groups/config"
import { ControlApi } from "./groups/control"
import { ControlPlaneApi } from "./groups/control-plane"
import { EventApi } from "./groups/event"
import { ExperimentalApi } from "./groups/experimental"
import { FileApi } from "./groups/file"
import { InstanceApi } from "./groups/instance"
import { McpApi } from "./groups/mcp"
import { PermissionApi } from "./groups/permission"
import { ProjectApi } from "./groups/project"
import { ProjectCopyApi } from "./groups/project-copy"
import { ProviderApi } from "./groups/provider"
import { PtyApi, PtyConnectApi } from "./groups/pty"
import { QuestionApi } from "./groups/question"
import { SessionApi } from "./groups/session"
import { SyncApi } from "./groups/sync"
import { TuiApi } from "./groups/tui"
import { UlmApi } from "./groups/ulm"
import { WorkspaceApi } from "./groups/workspace"
import { V2Api } from "@opencode-ai/server/api"
// GlobalEventSchema snapshots the registry after event-producing groups register their variants.
import { GlobalApi } from "./groups/global"
import { Authorization } from "./middleware/authorization"
import { SchemaErrorMiddleware } from "./middleware/schema-error"

function busEventSchema(definition: { type: string; properties: Schema.Top }) {
  return Schema.Struct({
    id: Schema.String,
    type: Schema.Literal(definition.type),
    properties: definition.properties,
  }).annotate({ identifier: `Event.${definition.type}` })
}

const EventSchema = Schema.Union([
  ...EventV2.registry
    .values()
    .map((definition) =>
      Schema.Struct({
        id: EventV2.ID,
        type: Schema.Literal(definition.type),
        properties: definition.data,
      }).annotate({ identifier: `Event.${definition.type}` }),
    )
    .toArray(),
  busEventSchema(Question.Event.Asked),
  busEventSchema(Question.Event.Replied),
  busEventSchema(Question.Event.Rejected),
  busEventSchema(OperationEvent.Updated),
  InstanceDisposed,
]).annotate({ identifier: "Event" })

const AdditionalSchemas: Schema.Top[] = [
  EventSchema,
  Question.Replied,
  Question.Rejected,
  OperationEvent.Updated.properties,
]

export const RootHttpApi = HttpApi.make("opencode-root")
  .addHttpApi(ControlApi)
  .addHttpApi(ControlPlaneApi)
  .addHttpApi(GlobalApi)
  .middleware(SchemaErrorMiddleware)
  .middleware(Authorization)

export const InstanceHttpApi = HttpApi.make("opencode-instance")
  .addHttpApi(ConfigApi)
  .addHttpApi(ExperimentalApi)
  .addHttpApi(FileApi)
  .addHttpApi(InstanceApi)
  .addHttpApi(McpApi)
  .addHttpApi(ProjectApi)
  .addHttpApi(ProjectCopyApi)
  .addHttpApi(PtyApi)
  .addHttpApi(QuestionApi)
  .addHttpApi(PermissionApi)
  .addHttpApi(ProviderApi)
  .addHttpApi(SessionApi)
  .addHttpApi(SyncApi)
  .addHttpApi(TuiApi)
  .addHttpApi(UlmApi)
  .addHttpApi(WorkspaceApi)
  .middleware(SchemaErrorMiddleware)

export const OpenCodeHttpApi = HttpApi.make("opencode")
  .addHttpApi(RootHttpApi)
  .addHttpApi(EventApi)
  .addHttpApi(InstanceHttpApi)
  .addHttpApi(V2Api)
  .addHttpApi(PtyConnectApi)
  .annotate(HttpApi.AdditionalSchemas, AdditionalSchemas)

export type RootHttpApiType = typeof RootHttpApi
export type InstanceHttpApiType = typeof InstanceHttpApi
