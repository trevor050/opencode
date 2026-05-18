function normalizedSecretValue(value: string) {
  const trimmed = value.trim()
  const quoted = trimmed.match(/^(['"])(.*)\1$/)
  return quoted ? quoted[2]!.trim() : trimmed
}

function isMasked(value: unknown) {
  return typeof value === "string" && /^[*xX]+$/.test(normalizedSecretValue(value))
}

function isSensitiveCredentialKey(key: string) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const wordSet = new Set(words)
  const isCookieControl =
    wordSet.has("cookie") &&
    (wordSet.has("samesite") ||
      (wordSet.has("same") && wordSet.has("site")) ||
      wordSet.has("accepted") ||
      wordSet.has("enabled") ||
      wordSet.has("required") ||
      wordSet.has("verified"))
  if (isCookieControl) return false
  return (
    wordSet.has("password") ||
    wordSet.has("passwd") ||
    wordSet.has("pwd") ||
    wordSet.has("psk") ||
    wordSet.has("secret") ||
    wordSet.has("token") ||
    wordSet.has("cookie") ||
    wordSet.has("bearer") ||
    (wordSet.has("api") && wordSet.has("key")) ||
    (wordSet.has("private") && wordSet.has("key"))
  )
}

export function containsRawCredentialSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsRawCredentialSecret(item))
  if (typeof value === "string") {
    const trimmed = value.trim()
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return containsRawCredentialSecret(JSON.parse(trimmed))
      } catch {}
    }
    return value.split(/\r?\n/).some((line) => {
      const assignment = line.match(
        /(?<![-\w])(?:password|pass|passwd|pwd|psk|secret|token|api[_ -]?key|private[_ -]?key|cookie|auth|bearer)(?![-\w])\s*[:=]\s*(.+)$/i,
      )
      if (!assignment) return false
      return normalizedSecretValue(assignment[1]!).trim() !== "" && !isMasked(assignment[1])
    })
  }
  if (!value || typeof value !== "object") return false
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (isSensitiveCredentialKey(key)) {
      return typeof entry === "string" && entry.trim() !== "" && !isMasked(entry)
    }
    return containsRawCredentialSecret(entry)
  })
}

const NEGATED_CREDENTIAL_GUESSING_PATTERN =
  /\b(?:no|do\s+not|don't|never|avoid|without)\b[\s\S]{0,140}\b(?:password\s+(?:spray|spraying|guess|guessing|brute|bruteforce|brute-force)|brute\s+force|default\s+(?:credential|credentials|password|passwords|login|logins)|credential\s+guessing|vendor\s+defaults?)\b(?:\s+(?:is|are)\s+(?:authorized|allowed|permitted))?/gi

function withoutNegatedCredentialGuessingPolicy(text: string) {
  return text.replace(NEGATED_CREDENTIAL_GUESSING_PATTERN, " ")
}

const DEFAULT_CREDENTIAL_GUESS_PATTERNS = [
  /\badmin\s*[:/]\s*admin\b/i,
  /\badmin\s*[:/]\s*password\b/i,
  /\badministrator\s*[:/]\s*password\b/i,
  /\broot\s*[:/]\s*root\b/i,
  /\bguest\s*[:/]\s*guest\b/i,
  /\b(?:try|trying|guess|guessing|spray|spraying)\b[\s\S]{0,120}\b(?:admin|administrator|root|guest)\b(?:\s*[:/]\s*(?:password|admin|default|vendor|root|guest)|[\s\S]{0,80}\b(?:password|credential|login|default|vendor)\b)/i,
  /\b(?:test|testing)\b[\s\S]{0,80}\b(?:default|vendor|factory)\b[\s\S]{0,80}\b(?:admin|administrator|root|guest|password|credential|login)\b/i,
  /\b(?:hydra|medusa|ncrack|crackmapexec|netexec)\b[\s\S]{0,160}\b(?:password|user|username|login|credential)\b/i,
  /\b(?:default|vendor|factory)\s+(?:password|credential|login|admin)\b/i,
  /\bpassword\s+(?:spray|spraying|guess|guessing|brute|bruteforce|brute-force)\b/i,
]

export function credentialGuessingPolicyGaps(value: unknown): string[] {
  const text = withoutNegatedCredentialGuessingPolicy(typeof value === "string" ? value : JSON.stringify(value ?? ""))
  if (!text.trim()) return []
  if (/\b(?:vault|operation_credentials|ULMCODE_CREDENTIAL_|credentialID|credential_id|redacted credential)\b/i.test(text)) {
    return []
  }
  return DEFAULT_CREDENTIAL_GUESS_PATTERNS.filter((pattern) => pattern.test(text)).map(
    () => "default/admin/vendor credential guessing is blocked unless the exact value comes from the operation credential vault",
  )
}

export function containsCredentialGuessing(value: unknown) {
  return credentialGuessingPolicyGaps(value).length > 0
}

export function credentialIndexGaps(credentials: unknown[]): string[] {
  const gaps: string[] = []
  const seen = new Set<string>()
  credentials.forEach((credential, index) => {
    if (!credential || typeof credential !== "object") {
      gaps.push(`credential review index record ${index + 1} is not an object`)
      return
    }
    const record = credential as Record<string, unknown>
    const rawID = typeof record.credentialID === "string" ? record.credentialID : typeof record.id === "string" ? record.id : ""
    const credentialID = rawID.trim()
    if (!credentialID) {
      gaps.push(`credential review index record ${index + 1} is missing a credential id`)
      return
    }
    const normalizedID = credentialID.toLowerCase()
    if (seen.has(normalizedID)) {
      gaps.push(`credential review index has duplicate credential id: ${credentialID}`)
    } else {
      seen.add(normalizedID)
    }
    const label = typeof record.label === "string" ? record.label.trim() : ""
    if (!label) {
      gaps.push(`credential review index record ${index + 1} is missing a label`)
    }
  })
  return gaps
}

export function validCredentialSubmittedAt(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

export function credentialSubmittedAtGaps(value: unknown): string[] {
  return value && !validCredentialSubmittedAt(value) ? ["credential review submittedAt is not a valid timestamp"] : []
}

export function expectedCredentialServices(plan: unknown) {
  const rawText = JSON.stringify(plan ?? "")
  const text = rawText.toLowerCase()
  const credentialTargets =
    plan && typeof plan === "object" && !Array.isArray(plan) && Array.isArray((plan as { credentialTargets?: unknown }).credentialTargets)
      ? (plan as { credentialTargets: unknown[] }).credentialTargets
          .filter((target): target is string => typeof target === "string")
          .map((target) => target.trim().toLowerCase())
          .filter(Boolean)
      : []
  const explicitServices = [
    credentialTargets,
    /\btemplateName"\s*:\s*"school-laptop-48h\b/.test(rawText) ||
    /\btemplate_name"\s*:\s*"school-laptop-48h\b/.test(rawText)
      ? ["genesis", "google"]
      : undefined,
  ]
    .flat()
    .filter((service): service is string => Boolean(service))
  const disablesImplicitCredentialInference =
    /\b(?:no|without)\s+(?:live\s+|credentialed\s+|submitted\s+|operator\s+|test\s+){0,5}credentials?\b/.test(text) ||
    /\bcredential(?:ed)?\s+(?:handling|login|testing|review|checks?)\s+(?:is\s+)?(?:not\s+applicable|out\s+of\s+scope|excluded|not\s+required)\b/.test(
      text,
    ) ||
    /\bsynthetic(?:-only|\s+only|\s+lab(?:-only|\s+only)?)\b.{0,160}\b(?:no|without)\b.{0,80}\bcredentials?\b/.test(text)
  if (disablesImplicitCredentialInference) return [...new Set(explicitServices)]
  const services = [
    explicitServices,
    serviceHasCredentialContext(text, "genesis") ? "genesis" : undefined,
    serviceHasCredentialContext(text, "google") ? "google" : undefined,
    serviceHasCredentialContext(text, "sis") ? "sis" : undefined,
  ]
    .flat()
    .filter((service): service is string => Boolean(service))
  return [...new Set(services)]
}

export function credentialRecordText(record: unknown) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return ""
  return Object.entries(record)
    .filter(([key]) => !["password", "secret"].includes(key.toLowerCase()))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()
}

function credentialRecordStructuredServices(record: unknown) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return []
  const fields = ["service", "target", "provider", "system"]
  return fields
    .flatMap((field) => {
      const value = (record as Record<string, unknown>)[field]
      if (Array.isArray(value)) return value
      return value === undefined ? [] : [value]
    })
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

const CREDENTIAL_SERVICE_ALIASES: Record<string, string[]> = {
  genesis: ["genesis"],
  google: ["google", "workspace", "gmail"],
  sis: ["sis", "student information system"],
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function serviceHasCredentialContext(text: string, service: string) {
  const aliases = CREDENTIAL_SERVICE_ALIASES[service] ?? [service]
  const credentialContext =
    "(?:credential(?:ed|s)?|auth(?:enticated|entication)?|login|logins|vault|submitted|provided|available|test\\s+account|operator-provided|redacted)"
  return aliases.some((alias) => {
    const escaped = escapeRegex(alias)
    return (
      new RegExp(`\\b${escaped}\\b[\\s\\S]{0,140}\\b${credentialContext}\\b`, "i").test(text) ||
      new RegExp(`\\b${credentialContext}\\b[\\s\\S]{0,140}\\b${escaped}\\b`, "i").test(text)
    )
  })
}

function hasNonNegatedCredentialService(text: string, service: string) {
  const aliases = CREDENTIAL_SERVICE_ALIASES[service] ?? [service]
  return aliases.some((alias) => {
    const escaped = escapeRegex(alias)
    const serviceMention = new RegExp(`\\b${escaped}\\b`, "i")
    if (!serviceMention.test(text)) return false
    const negatedMention = new RegExp(
      `\\b(?:not|no|without|missing|absent|none|unsubmitted)\\b(?:\\W+\\w+){0,4}\\W+${escaped}\\b|\\b${escaped}\\b(?:\\W+\\w+){0,4}\\W+\\b(?:missing|absent|unsubmitted)\\b`,
      "i",
    )
    return !negatedMention.test(text)
  })
}

export function missingCredentialServices(plan: unknown, credentials: unknown[]) {
  const structuredServices = credentials.flatMap(credentialRecordStructuredServices)
  const submittedRecords = credentials.map(credentialRecordText)
  return expectedCredentialServices(plan).filter(
    (service) =>
      !structuredServices.some((recordService) => hasNonNegatedCredentialService(recordService, service)) &&
      !submittedRecords.some((record) => hasNonNegatedCredentialService(record, service)),
  )
}
