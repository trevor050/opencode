import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_credentials.txt"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import {
  deleteOperationCredential,
  materializeOperationCredentials,
  readOperationCredentials,
  writeOperationCredential,
} from "@/ulm/operation-credentials"

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  action: Schema.Literals(["create", "list", "get", "delete", "materialize_env"]),
  credentialID: Schema.optional(Schema.String),
  credentialIDs: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  label: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  notes: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  credentialID?: string
  credentials?: unknown[]
  index?: string
  envFile?: string
  deleted?: boolean
}

export const OperationCredentialsTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_credentials",
  Effect.succeed({
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const storage = yield* Storage.Service
          if (params.action === "create") {
            if (!params.label) throw new Error("operation_credentials create requires label")
            const label = params.label
            const result = yield* Effect.promise(() =>
              writeOperationCredential(storage, Instance.worktree, {
                operationID: params.operationID,
                credentialID: params.credentialID,
                label,
                username: params.username,
                password: params.password,
                url: params.url,
                tags: params.tags,
                notes: params.notes,
              }),
            )
            return {
              title: `Stored credential ${result.credentialID}`,
              output: [
                `operation_id: ${result.operationID}`,
                `credential_id: ${result.credentialID}`,
                `index: ${result.index}`,
                "secret_values: stored outside operation artifacts",
              ].join("\n"),
              metadata: {
                operationID: result.operationID,
                credentialID: result.credentialID,
                index: result.index,
                credentials: [result.credential],
              },
            }
          }

          if (params.action === "delete") {
            if (!params.credentialID) throw new Error("operation_credentials delete requires credentialID")
            const credentialID = params.credentialID
            const result = yield* Effect.promise(() =>
              deleteOperationCredential(storage, Instance.worktree, {
                operationID: params.operationID,
                credentialID,
              }),
            )
            return {
              title: result.deleted ? `Deleted credential ${result.credentialID}` : `Credential ${result.credentialID} was not present`,
              output: [
                `operation_id: ${result.operationID}`,
                `credential_id: ${result.credentialID}`,
                `deleted: ${result.deleted}`,
                `index: ${result.index}`,
              ].join("\n"),
              metadata: result,
            }
          }

          if (params.action === "materialize_env") {
            const result = yield* Effect.promise(() =>
              materializeOperationCredentials(storage, Instance.worktree, {
                operationID: params.operationID,
                credentialIDs: params.credentialIDs ?? (params.credentialID ? [params.credentialID] : undefined),
              }),
            )
            return {
              title: `Materialized credential env for ${result.operationID}`,
              output: [
                `operation_id: ${result.operationID}`,
                `env_file: ${result.envFile}`,
                "source this chmod 0600 file inside the supervised command that needs credentials.",
                "",
                "variables:",
                ...result.credentials.flatMap((credential) => [
                  `- ${credential.credentialID}`,
                  ...credential.variables.map((variable) => `  - ${variable}`),
                ]),
              ].join("\n"),
              metadata: {
                operationID: result.operationID,
                envFile: result.envFile,
                credentials: result.credentials,
              },
            }
          }

          const result = yield* Effect.promise(() =>
            readOperationCredentials(Instance.worktree, {
              operationID: params.operationID,
              credentialID: params.action === "get" ? params.credentialID : undefined,
            }),
          )
          return {
            title: `${result.credentials.length} credential${result.credentials.length === 1 ? "" : "s"} for ${result.operationID}`,
            output: [
              `operation_id: ${result.operationID}`,
              `index: ${result.index}`,
              "",
              ...result.credentials.map(
                (credential) =>
                  `- ${credential.credentialID}: ${credential.label}${credential.username ? ` (${credential.username})` : ""}`,
              ),
            ].join("\n"),
            metadata: {
              operationID: result.operationID,
              index: result.index,
              credentials: result.credentials,
            },
          }
        }).pipe(Effect.provide(Storage.defaultLayer), Effect.orDie),
    }),
)
