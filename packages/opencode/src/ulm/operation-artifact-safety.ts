import fs from "fs/promises"
import path from "path"
import { containsRawCredentialSecret, credentialGuessingPolicyGaps } from "./credential-safety"

export type OperationArtifactSafetyFinding = {
  label: string
  reason: string
}

export type OperationArtifactSafetyResult = {
  operationID: string
  ok: boolean
  checkedAt: string
  findings: OperationArtifactSafetyFinding[]
}

const sensitiveIdentityKeys = new Set([
  "username",
  "user",
  "login",
  "handle",
  "ssid",
  "networkname",
  "network_name",
  "wifi",
  "wifissid",
  "wifi_ssid",
])

function slug(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || fallback
}

function operationPath(worktree: string, operationID: string) {
  return path.join(worktree, ".ulmcode", "operations", slug(operationID, "operation"))
}

function masked(value: string) {
  return /^\s*(?:\[REDACTED[^\]]*\]|\*{3,}|x{3,}|redacted|masked)\s*$/i.test(value)
}

function keyName(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
}

function walk(label: string, value: unknown, findings: OperationArtifactSafetyFinding[]) {
  if (containsRawCredentialSecret(value)) findings.push({ label, reason: "raw credential secret" })
  for (const gap of credentialGuessingPolicyGaps(value)) findings.push({ label, reason: gap })
  if (typeof value === "string") {
    const identityAssignment = value.match(/\b(?:username|user|ssid|wi-fi|wifi|handle)\s*[:=]\s*([^\s,;<>]+)/i)
    if (identityAssignment && !masked(identityAssignment[1] ?? "")) {
      findings.push({ label, reason: "raw username/handle/SSID text" })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(`${label}[${index}]`, item, findings))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, entry] of Object.entries(value)) {
    const childLabel = `${label}.${key}`
    const normalized = keyName(key)
    if (typeof entry === "string" && sensitiveIdentityKeys.has(normalized) && entry.trim() && !masked(entry)) {
      findings.push({ label: childLabel, reason: "raw username/handle/SSID value" })
    }
    if (
      typeof entry === "string" &&
      (normalized === "prompt" || normalized === "command") &&
      /\b(?:password|credential|username|ssid|token|cookie|secret|admin\/password|admin:password)\b/i.test(entry)
    ) {
      findings.push({ label: childLabel, reason: "sensitive restart prompt or command text" })
    }
    walk(childLabel, entry, findings)
  }
}

export function scanOperationArtifactValue(operationID: string, label: string, value: unknown): OperationArtifactSafetyResult {
  const findings: OperationArtifactSafetyFinding[] = []
  walk(label, value, findings)
  return {
    operationID: slug(operationID, "operation"),
    ok: findings.length === 0,
    checkedAt: new Date().toISOString(),
    findings,
  }
}

export function assertOperationArtifactSafe(operationID: string, label: string, value: unknown) {
  const result = scanOperationArtifactValue(operationID, label, value)
  if (!result.ok) throw new Error(`${label} failed credential leak audit: ${result.findings.map((item) => item.reason).join("; ")}`)
}

export async function scanOperationArtifactFile(operationID: string, file: string): Promise<OperationArtifactSafetyResult> {
  const text = await fs.readFile(file, "utf8")
  let value: unknown = text
  if (/\.json$/i.test(file)) {
    try {
      value = JSON.parse(text)
    } catch {}
  }
  return scanOperationArtifactValue(operationID, file, value)
}

export async function scanOperationArtifacts(worktree: string, operationID: string): Promise<OperationArtifactSafetyResult> {
  const id = slug(operationID, "operation")
  const root = operationPath(worktree, id)
  const files: string[] = []
  async function collect(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await collect(full)
      else if (/\.(json|jsonl|md|html|txt)$/i.test(entry.name)) files.push(full)
    }
  }
  for (const dir of ["deliverables", "reports", "supervisor", "tasks", "memory"].map((item) => path.join(root, item))) {
    await collect(dir)
  }
  const results = await Promise.all(files.map((file) => scanOperationArtifactFile(id, file)))
  const findings = results.flatMap((result) => result.findings)
  return { operationID: id, ok: findings.length === 0, checkedAt: new Date().toISOString(), findings }
}
