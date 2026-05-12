import fs from "fs/promises"
import path from "path"
import { operationPath, operationPlanRequiresCredentialHandoff, slug } from "./artifact"
import {
  containsRawCredentialSecret,
  credentialIndexGaps,
  credentialSubmittedAtGaps,
  expectedCredentialServices,
  missingCredentialServices,
  validCredentialSubmittedAt,
} from "./credential-safety"
import { readOperationCredentialReview } from "./operation-credentials"

export type CredentialReviewStatus = "ready" | "not_required" | "blocked"

export type CredentialReviewResult = {
  operationID: string
  status: CredentialReviewStatus
  checkedAt: string
  credentialsRequired: boolean
  expectedServices: string[]
  submitted: boolean
  submittedAt: string
  credentialCount: number
  gaps: string[]
  files: {
    json: string
    markdown: string
    review: string
  }
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function formatMarkdown(result: CredentialReviewResult) {
  return [
    `# Credential Review: ${result.operationID}`,
    "",
    `- status: ${result.status}`,
    `- checked_at: ${result.checkedAt}`,
    `- credentials_required: ${result.credentialsRequired}`,
    `- expected_services: ${result.expectedServices.length ? result.expectedServices.join(", ") : "none"}`,
    `- submitted: ${result.submitted}`,
    `- submitted_at: ${result.submittedAt || "not submitted"}`,
    `- credential_count: ${result.credentialCount}`,
    `- review_file: ${result.files.review}`,
    "",
    "## Gaps",
    "",
    ...(result.gaps.length ? result.gaps.map((gap) => `- ${gap}`) : ["- none"]),
    "",
  ].join("\n")
}

function credentialServiceGaps(plan: unknown, credentials: unknown[]) {
  const expected = expectedCredentialServices(plan)
  const missing = missingCredentialServices(plan, credentials)
  return {
    expected,
    gaps: missing.map((service) => `credential review is missing a submitted record for plan service: ${service}`),
  }
}

export async function auditCredentialReview(
  worktree: string,
  input: { operationID: string; now?: () => Date },
): Promise<CredentialReviewResult> {
  const operationID = slug(input.operationID, "operation")
  const root = operationPath(worktree, operationID)
  const reviewPath = path.join(root, "credentials", "review-submission.json")
  const plan = await readJson(path.join(root, "plans", "operation-plan.json"))
  const review = await readOperationCredentialReview(worktree, { operationID })
  const credentialCount = Array.isArray(review.credentials) ? review.credentials.length : 0
  const submittedAtGaps = credentialSubmittedAtGaps(review.submittedAt)
  const submitted = Boolean(validCredentialSubmittedAt(review.submittedAt) && credentialCount > 0)
  const operationIDGap =
    review.operationID && slug(review.operationID, "operation") !== operationID
      ? "credential review operation id does not match operation"
      : undefined
  const fileReferenceGap =
    review.file && path.resolve(review.file) !== path.resolve(reviewPath)
      ? "credential review file reference is not canonical"
      : undefined
  const rawSecretInReview = containsRawCredentialSecret(review.credentials)
  const indexGaps = Array.isArray(review.credentials) ? credentialIndexGaps(review.credentials) : []
  const serviceCoverage = credentialServiceGaps(plan, Array.isArray(review.credentials) ? review.credentials : [])
  const credentialsRequired = operationPlanRequiresCredentialHandoff(plan) || serviceCoverage.expected.length > 0
  const gaps = [
    credentialsRequired && !review.submittedAt ? "credentialed plan requires the vault Submit to agent button" : undefined,
    credentialsRequired && review.submittedAt && credentialCount === 0
      ? "credentialed plan requires at least one submitted credential record"
      : undefined,
    ...(credentialsRequired ? submittedAtGaps : []),
    credentialsRequired ? operationIDGap : undefined,
    credentialsRequired ? fileReferenceGap : undefined,
    rawSecretInReview ? "credential review artifact appears to include raw secret fields instead of redacted records" : undefined,
    ...(credentialsRequired ? indexGaps : []),
    ...(credentialsRequired ? serviceCoverage.gaps : []),
  ].filter((gap): gap is string => Boolean(gap))
  const status: CredentialReviewStatus = gaps.length ? "blocked" : credentialsRequired ? "ready" : "not_required"
  const result: CredentialReviewResult = {
    operationID,
    status,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    credentialsRequired,
    expectedServices: credentialsRequired ? serviceCoverage.expected : [],
    submitted,
    submittedAt: review.submittedAt,
    credentialCount,
    gaps,
    files: {
      json: path.join(root, "scheduler", "credential-review.json"),
      markdown: path.join(root, "scheduler", "credential-review.md"),
      review: review.file,
    },
  }
  await fs.mkdir(path.dirname(result.files.json), { recursive: true })
  await fs.writeFile(result.files.json, JSON.stringify(result, null, 2) + "\n")
  await fs.writeFile(result.files.markdown, formatMarkdown(result))
  return result
}

export function formatCredentialReview(result: CredentialReviewResult) {
  return [
    `# Credential Review`,
    "",
    `- operation: ${result.operationID}`,
    `- status: ${result.status}`,
    `- credentials_required: ${result.credentialsRequired}`,
    `- expected_services: ${result.expectedServices.length ? result.expectedServices.join(", ") : "none"}`,
    `- submitted: ${result.submitted}`,
    `- credential_count: ${result.credentialCount}`,
    `- audit: ${result.files.json}`,
  ].join("\n")
}
