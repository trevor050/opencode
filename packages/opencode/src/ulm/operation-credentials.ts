import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { Storage } from "@/storage/storage"
import { operationPath, slug } from "./artifact"

export type OperationCredentialInput = {
  operationID: string
  credentialID?: string
  label: string
  type?: string
  username?: string
  password?: string
  secret?: string
  url?: string
  target?: string
  tags?: string[]
  notes?: string
  rules?: string
}

export type OperationCredentialRecord = {
  credentialID: string
  label: string
  type?: string
  username?: string
  url?: string
  target?: string
  tags: string[]
  notes?: string
  rules?: string
  createdAt: string
  updatedAt: string
}

type OperationCredentialSecret = {
  operationID: string
  credentialID: string
  username?: string
  password?: string
  secret?: string
  updatedAt: string
}

type CredentialIndex = {
  operationID: string
  updatedAt: string
  credentials: OperationCredentialRecord[]
}

function indexPath(worktree: string, operationID: string) {
  return path.join(operationPath(worktree, slug(operationID, "operation")), "credentials", "index.json")
}

function storageKey(operationID: string, credentialID: string) {
  return ["ulm", "credential", slug(operationID, "operation"), slug(credentialID, "credential")]
}

async function readIndex(file: string, operationID: string): Promise<CredentialIndex> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as CredentialIndex
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { operationID, updatedAt: new Date(0).toISOString(), credentials: [] }
    }
    throw error
  }
}

async function writeIndex(file: string, index: CredentialIndex) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await fs.chmod(path.dirname(file), 0o700)
  await fs.writeFile(file, JSON.stringify(index, null, 2) + "\n", { mode: 0o600 })
  await fs.chmod(file, 0o600)
}

function redacted(record: OperationCredentialRecord) {
  return {
    ...record,
    password: "********",
  }
}

function envName(record: OperationCredentialRecord, suffix: string) {
  return `ULMCODE_CREDENTIAL_${record.credentialID.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_${suffix}`
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\"'\"'")}'`
}

function selectCredentials(index: CredentialIndex, credentialIDs?: string[]) {
  if (!credentialIDs?.length) return index.credentials
  const wanted = new Set(credentialIDs.map((id) => slug(id, "credential")))
  return index.credentials.filter((item) => wanted.has(item.credentialID))
}

export async function writeOperationCredential(storage: Storage.Interface, worktree: string, input: OperationCredentialInput) {
  const operationID = slug(input.operationID, "operation")
  const credentialID = slug(input.credentialID ?? input.label, `credential-${Date.now()}`)
  const file = indexPath(worktree, operationID)
  const index = await readIndex(file, operationID)
  const existing = index.credentials.find((item) => item.credentialID === credentialID)
  const now = new Date().toISOString()
  const record: OperationCredentialRecord = {
    credentialID,
    label: input.label,
    type: input.type,
    username: input.username,
    url: input.url,
    target: input.target,
    tags: input.tags ?? [],
    notes: input.notes,
    rules: input.rules,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await Effect.runPromise(
    storage.write<OperationCredentialSecret>(storageKey(operationID, credentialID), {
      operationID,
      credentialID,
      username: input.username,
      password: input.password ?? input.secret,
      secret: input.secret ?? input.password,
      updatedAt: now,
    }),
  )
  await writeIndex(file, {
    operationID,
    updatedAt: now,
    credentials: [...index.credentials.filter((item) => item.credentialID !== credentialID), record],
  })
  return { operationID, credentialID, index: file, credential: redacted(record) }
}

export async function readOperationCredentials(worktree: string, input: { operationID: string; credentialID?: string }) {
  const operationID = slug(input.operationID, "operation")
  const file = indexPath(worktree, operationID)
  const index = await readIndex(file, operationID)
  return {
    operationID,
    index: file,
    credentials: selectCredentials(index, input.credentialID ? [input.credentialID] : undefined).map(redacted),
  }
}

export async function deleteOperationCredential(storage: Storage.Interface, worktree: string, input: { operationID: string; credentialID: string }) {
  const operationID = slug(input.operationID, "operation")
  const credentialID = slug(input.credentialID, "credential")
  const file = indexPath(worktree, operationID)
  const index = await readIndex(file, operationID)
  const next = index.credentials.filter((item) => item.credentialID !== credentialID)
  await Effect.runPromise(storage.remove(storageKey(operationID, credentialID)))
  await writeIndex(file, { operationID, updatedAt: new Date().toISOString(), credentials: next })
  return { operationID, credentialID, index: file, deleted: next.length !== index.credentials.length }
}

export async function materializeOperationCredentials(
  storage: Storage.Interface,
  worktree: string,
  input: { operationID: string; credentialIDs?: string[] },
) {
  const operationID = slug(input.operationID, "operation")
  const file = indexPath(worktree, operationID)
  const selected = selectCredentials(await readIndex(file, operationID), input.credentialIDs)
  const secrets = await Promise.all(
    selected.map(async (credential) => {
      try {
        return await Effect.runPromise(storage.read<OperationCredentialSecret>(storageKey(operationID, credential.credentialID)))
      } catch {
        return undefined
      }
    }),
  )
  const entries = selected.flatMap((credential, index) => {
    const secret = secrets[index]
    return [
      secret?.username ? `export ${envName(credential, "USERNAME")}=${shellQuote(secret.username)}` : undefined,
      secret?.password ? `export ${envName(credential, "PASSWORD")}=${shellQuote(secret.password)}` : undefined,
      secret?.secret ? `export ${envName(credential, "SECRET")}=${shellQuote(secret.secret)}` : undefined,
      credential.url ? `export ${envName(credential, "URL")}=${shellQuote(credential.url)}` : undefined,
      credential.target ? `export ${envName(credential, "TARGET")}=${shellQuote(credential.target)}` : undefined,
    ].filter((item): item is string => item !== undefined)
  })
  const envFile = path.join(os.tmpdir(), `ulmcode-${operationID}-credentials-${Date.now()}.env`)
  await fs.writeFile(envFile, entries.join("\n") + "\n", { mode: 0o600 })
  await fs.chmod(envFile, 0o600)
  return {
    operationID,
    envFile,
    credentials: selected.map((credential) => ({
      credentialID: credential.credentialID,
      label: credential.label,
      variables: [
        `${envName(credential, "USERNAME")}`,
        `${envName(credential, "PASSWORD")}`,
        `${envName(credential, "SECRET")}`,
        `${envName(credential, "URL")}`,
        `${envName(credential, "TARGET")}`,
      ],
    })),
  }
}
