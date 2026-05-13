import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { MessageID, SessionID } from "@/session/schema"
import { credentialVaultWaitTimeoutMillis, OperationCredentialsTool } from "@/tool/operation_credentials"
import { Truncate } from "@/tool/truncate"
import { submitOperationCredentialReview } from "@/ulm/operation-credentials"
import { operationPath, slug } from "@/ulm/artifact"
import { credentialVaultHtml } from "@/server/shared/ulm-credential-vault"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const layer = Layer.mergeAll(Agent.defaultLayer, Truncate.defaultLayer)

describe("tool.operation_credentials", () => {
  test("vault UI uses credential overview copy and safe dynamic fields", () => {
    const html = credentialVaultHtml()

    expect(html).toContain("Credential Overview")
    expect(html).toContain("Router/Admin Login")
    expect(html).toContain("Wi-Fi / Network")
    expect(html).toContain("Session Cookie")
    expect(html).toContain("credentials in plan")
    expect(html).toContain("still needed")
    expect(html).toContain("aria-label=\"Show password\"")
    expect(html).toContain("setSecretVisible(button, isHidden)")
    expect(html).toContain("const form = event.currentTarget")
    expect(html).toContain("form.reset()")
    expect(html).not.toContain("expected services")
    expect(html).not.toContain("missing services")
    expect(html).not.toContain("HomeVault")
    expect(html).not.toContain("[ esc ]")
    expect(html).not.toContain("event.currentTarget.reset()")
    expect(html).not.toContain("No active handles")
  })

  test("non-positive vault wait time keeps the normal operator wait", () => {
    expect(credentialVaultWaitTimeoutMillis()).toBe(900_000)
    expect(credentialVaultWaitTimeoutMillis(0)).toBe(900_000)
    expect(credentialVaultWaitTimeoutMillis(-1)).toBe(900_000)
    expect(credentialVaultWaitTimeoutMillis(1)).toBe(5_000)
    expect(credentialVaultWaitTimeoutMillis(300)).toBe(300_000)
  })

  test("returns the secure vault URL without asking for chat secrets", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationCredentialsTool
            const def = yield* tool.init()
            const result = yield* def.execute(
              {
                operationID: "Home Network Run",
                action: "vault_url",
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

            expect(result.output).toContain("vault_url: /ulm/credentials?operationID=Home%20Network%20Run&directory=")
            expect(result.output).toContain("opened: false")
            expect(result.output).toContain("Do not paste secrets into chat")
            expect(result.metadata.vaultUrl).toContain("/ulm/credentials?operationID=Home%20Network%20Run&directory=")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("reports credential review status after vault submission", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationCredentialsTool
            const def = yield* tool.init()
            yield* def.execute(
              {
                operationID: "Home Network Run",
                action: "create",
                label: "Router admin",
                username: "admin",
                secret: "do-not-leak",
                target: "192.168.1.1",
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
            yield* Effect.promise(() => submitOperationCredentialReview(dir.path, { operationID: "Home Network Run" }))
            const submitted = yield* def.execute(
              {
                operationID: "Home Network Run",
                action: "review_status",
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
            expect(submitted.output).toContain("submitted: true")
            expect(submitted.output).toContain("router-admin")
            expect(JSON.stringify(submitted.metadata)).not.toContain("do-not-leak")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("get returns redacted credential details and raw-note preview without leaking secrets", async () => {
    await using dir = await tmpdir({ git: true })
    await provideTestInstance({
      directory: dir.path,
      fn: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const tool = yield* OperationCredentialsTool
            const def = yield* tool.init()
            const ctx = {
              sessionID: SessionID.make("session-1"),
              messageID: MessageID.ascending(),
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            }
            yield* def.execute(
              {
                operationID: "Home Network Run",
                action: "create",
                label: "Wifi Info",
                type: "Raw Note",
                secret: "ssid: TrevorNet\npassword: hunter2\noperator note: upstairs closet",
                target: "raw vault item",
                notes: "Use only for authorized home-network validation.",
                rules: "No spraying.",
              },
              ctx,
            )

            const result = yield* def.execute(
              {
                operationID: "Home Network Run",
                action: "get",
                credentialID: "wifi-info",
              },
              ctx,
            )

            expect(result.output).toContain("type: Raw Note")
            expect(result.output).toContain("target: raw vault item")
            expect(result.output).toContain("notes: Use only for authorized home-network validation.")
            expect(result.output).toContain("rules: No spraying.")
            expect(result.output).toContain("ssid: TrevorNet")
            expect(result.output).toContain("password: ********")
            expect(result.output).toContain("operator note: upstairs closet")
            expect(result.output).not.toContain("hunter2")
            expect(JSON.stringify(result.metadata)).not.toContain("hunter2")
          }).pipe(Effect.provide(layer)),
        ),
    })
  })

  test("materialize_env falls back to the ulmcode profile secret store", async () => {
    await using dir = await tmpdir({ git: true })
    await using fallback = await tmpdir({ git: false })
    const previousFallback = process.env.ULMCODE_CREDENTIAL_FALLBACK_DATA_DIR
    process.env.ULMCODE_CREDENTIAL_FALLBACK_DATA_DIR = fallback.path
    try {
      const operationID = slug("Home Network Run", "operation")
      const credentialID = "wifi"
      const credentialsDir = path.join(operationPath(dir.path, operationID), "credentials")
      await fs.mkdir(credentialsDir, { recursive: true })
      await fs.writeFile(
        path.join(credentialsDir, "index.json"),
        JSON.stringify(
          {
            operationID,
            updatedAt: "2026-05-12T00:00:00.000Z",
            credentials: [
              {
                credentialID,
                label: "wifi",
                type: "Router/Admin Login",
                username: "router-user",
                tags: ["structured"],
                createdAt: "2026-05-12T00:00:00.000Z",
                updatedAt: "2026-05-12T00:00:00.000Z",
              },
            ],
          },
          null,
          2,
        ) + "\n",
      )
      const fallbackSecret = path.join(fallback.path, "storage", "ulm", "credential", operationID, `${credentialID}.json`)
      await fs.mkdir(path.dirname(fallbackSecret), { recursive: true })
      await fs.writeFile(
        fallbackSecret,
        JSON.stringify(
          {
            operationID,
            credentialID,
            username: "router-user",
            password: "router-password",
            secret: "router-password",
            updatedAt: "2026-05-12T00:00:00.000Z",
          },
          null,
          2,
        ) + "\n",
      )

      await provideTestInstance({
        directory: dir.path,
        fn: () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const tool = yield* OperationCredentialsTool
              const def = yield* tool.init()
              const result = yield* def.execute(
                {
                  operationID,
                  action: "materialize_env",
                  credentialID,
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

              const envFile = result.metadata.envFile!
              const env = yield* Effect.promise(() => fs.readFile(envFile, "utf8"))
              expect(env).toContain("ULMCODE_CREDENTIAL_WIFI_USERNAME='router-user'")
              expect(env).toContain("ULMCODE_CREDENTIAL_WIFI_PASSWORD='router-password'")
              expect(result.output).not.toContain("router-password")
            }).pipe(Effect.provide(layer)),
          ),
      })
    } finally {
      if (previousFallback === undefined) delete process.env.ULMCODE_CREDENTIAL_FALLBACK_DATA_DIR
      else process.env.ULMCODE_CREDENTIAL_FALLBACK_DATA_DIR = previousFallback
    }
  })
})
