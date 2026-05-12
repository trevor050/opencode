import { Effect, Schema } from "effect"
import open from "open"
import * as Tool from "./tool"
import DESCRIPTION from "./operation_credentials.txt"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import {
  deleteOperationCredential,
  inspectOperationCredentials,
  materializeOperationCredentials,
  readOperationCredentialReview,
  readOperationCredentials,
  submitOperationCredentialReview,
  waitForOperationCredentialReview,
  writeOperationCredential,
} from "@/ulm/operation-credentials"

let browserListener: { url: URL; stop: (close?: boolean) => Promise<void> } | undefined
const recentVaultOpens = new Map<string, { url: string; openedAt: number }>()
const RECENT_VAULT_OPEN_WINDOW = 15 * 60 * 1000

async function browserServerUrl() {
  if (process.env.OPENCODE_SERVER_URL) return new URL(process.env.OPENCODE_SERVER_URL)
  const server = await import("@/server/server").catch(() => undefined)
  if (!server) return undefined
  if (server.url) return server.url
  browserListener ??= await server.listen({
    hostname: "127.0.0.1",
    port: 0,
  })
  return browserListener.url
}

async function existingBrowserServerUrl() {
  if (process.env.OPENCODE_SERVER_URL) return new URL(process.env.OPENCODE_SERVER_URL)
  const server = await import("@/server/server").catch(() => undefined)
  return server?.url
}

export const Parameters = Schema.Struct({
  operationID: Schema.String,
  action: Schema.Literals([
    "create",
    "list",
    "get",
    "delete",
    "materialize_env",
    "vault_url",
    "open_vault",
    "review_status",
    "submit_review",
  ]),
  credentialID: Schema.optional(Schema.String),
  credentialIDs: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  waitForSubmit: Schema.optional(Schema.Boolean),
  waitTimeoutSeconds: Schema.optional(Schema.Number),
  label: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  password: Schema.optional(Schema.String),
  secret: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  notes: Schema.optional(Schema.String),
  rules: Schema.optional(Schema.String),
})

type Metadata = {
  operationID: string
  credentialID?: string
  credentials?: unknown[]
  expectedServices?: string[]
  index?: string
  envFile?: string
  vaultUrl?: string
  fullVaultUrl?: string
  opened?: boolean
  submittedAt?: string
  deleted?: boolean
}

export function credentialVaultWaitTimeoutMillis(waitTimeoutSeconds?: number) {
  if (waitTimeoutSeconds === undefined || waitTimeoutSeconds <= 0) return 900_000
  return Math.max(5, waitTimeoutSeconds) * 1000
}

function credentialLines(credential: any) {
  const lines = [`- ${credential.credentialID}: ${credential.label}`]
  if (credential.type) lines.push(`  type: ${credential.type}`)
  if (credential.username) lines.push(`  username: ${credential.username}`)
  if (credential.url) lines.push(`  url: ${credential.url}`)
  if (credential.target) lines.push(`  target: ${credential.target}`)
  if (credential.tags?.length) lines.push(`  tags: ${credential.tags.join(", ")}`)
  if (credential.notes) lines.push(`  notes: ${credential.notes}`)
  if (credential.rules) lines.push(`  rules: ${credential.rules}`)
  if (credential.hasPassword || credential.password) lines.push(`  password: ********`)
  if (credential.hasSecret || credential.secret) lines.push(`  secret: ********`)
  if (credential.secretPreview) lines.push(`  redacted_secret_preview:\n${credential.secretPreview.split("\n").map((line: string) => `    ${line}`).join("\n")}`)
  if (credential.createdAt) lines.push(`  created_at: ${credential.createdAt}`)
  if (credential.updatedAt) lines.push(`  updated_at: ${credential.updatedAt}`)
  return lines
}

export const OperationCredentialsTool = Tool.define<typeof Parameters, Metadata, never>(
  "operation_credentials",
  Effect.succeed({
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const storage = yield* Storage.Service
          if (params.action === "vault_url" || params.action === "open_vault") {
            const startedAt = Date.now()
            const vaultUrl = `/ulm/credentials?operationID=${encodeURIComponent(params.operationID)}&directory=${encodeURIComponent(Instance.worktree)}`
            const serverUrl = yield* Effect.promise(() =>
              params.action === "open_vault" ? browserServerUrl() : existingBrowserServerUrl(),
            )
            const fullVaultUrl = serverUrl ? new URL(vaultUrl, serverUrl).toString() : vaultUrl
            const recent = recentVaultOpens.get(params.operationID)
            const alreadyOpened = Boolean(
              params.action === "open_vault" &&
                recent &&
                recent.url === fullVaultUrl &&
                Date.now() - recent.openedAt < RECENT_VAULT_OPEN_WINDOW,
            )
            if (params.action === "open_vault") {
              yield* ctx.metadata({
                title: alreadyOpened
                  ? `Credential vault already open for ${params.operationID}`
                  : `Opening credential vault for ${params.operationID}`,
                metadata: {
                  operationID: params.operationID,
                  vaultUrl,
                  fullVaultUrl,
                  opened: alreadyOpened,
                },
              })
            }
            const opened =
              alreadyOpened
                ? true
                : params.action === "open_vault" && fullVaultUrl.startsWith("http")
                ? yield* Effect.promise(() =>
                    open(fullVaultUrl)
                      .then(() => true)
                      .catch(() => false),
                  )
                : false
            if (params.action === "open_vault" && opened && !alreadyOpened) {
              recentVaultOpens.set(params.operationID, { url: fullVaultUrl, openedAt: Date.now() })
            }
            if (params.action === "open_vault") {
              yield* ctx.metadata({
                title: alreadyOpened
                  ? `Credential vault already open for ${params.operationID}`
                  : opened
                  ? `Credential vault open for ${params.operationID}`
                  : `Credential vault ready for ${params.operationID}`,
                metadata: {
                  operationID: params.operationID,
                  vaultUrl,
                  fullVaultUrl,
                  opened,
                },
              })
            }
            const shouldWait = params.action === "open_vault"
            const waitTimeoutMillis = credentialVaultWaitTimeoutMillis(params.waitTimeoutSeconds)
            const review = shouldWait
              ? yield* Effect.promise(() =>
                  waitForOperationCredentialReview(Instance.worktree, {
                    operationID: params.operationID,
                    since: startedAt,
                    timeoutMillis: waitTimeoutMillis,
                  }),
                )
              : undefined
            return {
              title: params.action === "open_vault" ? `Opening credential vault for ${params.operationID}` : `Credential vault for ${params.operationID}`,
              output: [
                `operation_id: ${params.operationID}`,
                `vault_url: ${vaultUrl}`,
                `fallback_url: ${fullVaultUrl}`,
                `opened: ${opened}`,
                `open_status: ${alreadyOpened ? "already_open" : opened ? "opened" : "not_confirmed"}`,
                ...(shouldWait
                  ? [
                      `submitted: ${review?.submittedAt ? "true" : "false"}`,
                      `submitted_at: ${review?.submittedAt || "not submitted before timeout"}`,
                      `wait_timeout_seconds: ${Math.round(waitTimeoutMillis / 1000)}`,
                      `expected_services: ${review?.expectedServices?.length ? review.expectedServices.join(", ") : "none"}`,
                      `saved_credentials: ${review?.credentials.length ?? 0}`,
                    ]
                  : []),
                "operator_instruction: Open this secure local vault to enter credentials. Do not paste secrets into chat, operation memory, evidence, findings, reports, command text, or task metadata.",
                "next_step: After the vault Submit to agent button is clicked, call operation_credentials with action=review_status, then use list/get for credential records and materialize_env only inside supervised commands that need the secrets.",
              ].join("\n"),
              metadata: {
                operationID: params.operationID,
                vaultUrl,
                fullVaultUrl,
                opened,
                submittedAt: review?.submittedAt,
                expectedServices: review?.expectedServices,
                credentials: review?.credentials,
              },
            }
          }

          if (params.action === "review_status") {
            const review = yield* Effect.promise(() => readOperationCredentialReview(Instance.worktree, params))
            return {
              title: review.submittedAt ? `Credential review submitted for ${review.operationID}` : `No credential review submission for ${review.operationID}`,
              output: [
                `operation_id: ${review.operationID}`,
                `submitted: ${review.submittedAt ? "true" : "false"}`,
                `submitted_at: ${review.submittedAt || "not submitted"}`,
                `expected_services: ${review.expectedServices.length ? review.expectedServices.join(", ") : "none"}`,
                `review_file: ${review.file}`,
                "",
                "saved_credentials:",
                ...(review.credentials.length
                  ? review.credentials.map(
                      (credential) =>
                        `- ${credential.credentialID}: ${credential.label}${credential.username ? ` (${credential.username})` : ""}`,
                    )
                  : ["- none"]),
              ].join("\n"),
              metadata: {
                operationID: review.operationID,
                expectedServices: review.expectedServices,
                credentials: review.credentials,
                submittedAt: review.submittedAt,
              },
            }
          }

          if (params.action === "submit_review") {
            const review = yield* Effect.promise(() => submitOperationCredentialReview(Instance.worktree, params))
            return {
              title: `Submitted credential review for ${review.operationID}`,
              output: [
                `operation_id: ${review.operationID}`,
                `submitted: true`,
                `submitted_at: ${review.submittedAt}`,
                `expected_services: ${review.expectedServices.length ? review.expectedServices.join(", ") : "none"}`,
                `review_file: ${review.file}`,
                "",
                "submitted_credentials:",
                ...(review.credentials.length
                  ? review.credentials.map(
                      (credential) =>
                        `- ${credential.credentialID}: ${credential.label}${credential.username ? ` (${credential.username})` : ""}`,
                    )
                  : ["- none"]),
                "",
                "next_step: Call operation_credentials action=review_status to verify the submitted redacted records, then continue with list/get or materialize_env only when a supervised command needs credentials.",
              ].join("\n"),
              metadata: {
                operationID: review.operationID,
                expectedServices: review.expectedServices,
                credentials: review.credentials,
                submittedAt: review.submittedAt,
              },
            }
          }

          if (params.action === "create") {
            if (!params.label) throw new Error("operation_credentials create requires label")
            const label = params.label
            const result = yield* Effect.promise(() =>
              writeOperationCredential(storage, Instance.worktree, {
                operationID: params.operationID,
                credentialID: params.credentialID,
                label,
                type: params.type,
                username: params.username,
                password: params.password,
                secret: params.secret,
                url: params.url,
                target: params.target,
                tags: params.tags,
                notes: params.notes,
                rules: params.rules,
              }),
            )
            return {
              title: `Stored credential ${result.credentialID}`,
              output: [
                `operation_id: ${result.operationID}`,
                `credential_id: ${result.credentialID}`,
                `index: ${result.index}`,
                "secret_values: stored outside operation artifacts",
                "next_step: When the redacted credential index is ready for handoff or audit, call operation_credentials action=submit_review. Do not edit credentials/review-submission.json by hand.",
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
            params.action === "get"
              ? inspectOperationCredentials(storage, Instance.worktree, {
                  operationID: params.operationID,
                  credentialID: params.credentialID,
                })
              : readOperationCredentials(Instance.worktree, {
              operationID: params.operationID,
                }),
          )
          return {
            title: `${result.credentials.length} credential${result.credentials.length === 1 ? "" : "s"} for ${result.operationID}`,
            output: [
              `operation_id: ${result.operationID}`,
              `index: ${result.index}`,
              `expected_services: ${result.expectedServices.length ? result.expectedServices.join(", ") : "none"}`,
              "",
              ...result.credentials.flatMap(credentialLines),
            ].join("\n"),
            metadata: {
              operationID: result.operationID,
              index: result.index,
              expectedServices: result.expectedServices,
              credentials: result.credentials,
            },
          }
        }).pipe(Effect.provide(Storage.defaultLayer), Effect.orDie),
    }),
)
