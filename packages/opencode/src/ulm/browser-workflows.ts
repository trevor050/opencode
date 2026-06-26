export type BrowserWorkflowID =
  | "sis-role-export-review"
  | "google-admin-mfa-sharing-review"
  | "microsoft-entra-role-mfa-review"
  | "mdm-admin-device-review"

export type BrowserWorkflowManifest = {
  id: BrowserWorkflowID
  serviceType: "sis" | "google-admin" | "microsoft-entra" | "mdm"
  loginAssumption: string
  steps: string[]
  requiredScreenshots: string[]
  requiredNotes: string[]
  prohibitedRawData: string[]
  expectedEvidenceArtifacts: string[]
}

const WORKFLOWS: BrowserWorkflowManifest[] = [
  {
    id: "sis-role-export-review",
    serviceType: "sis",
    loginAssumption: "operator has completed login in the persistent browser profile; use only redacted role/account labels",
    steps: [
      "Open the SIS landing page and record the authenticated role context without capturing student data.",
      "Find role, permission, user-management, export, report, and impersonation surfaces.",
      "Check whether exports or reports expose student data by role, using metadata and redacted previews only.",
      "Record navigation paths, screenshots, and blockers; do not download or retain raw student records.",
    ],
    requiredScreenshots: ["landing-page-role-context", "role-or-permission-summary", "export-or-report-surface"],
    requiredNotes: ["role observed", "sensitive surfaces", "export controls", "blockers"],
    prohibitedRawData: ["student records", "grades", "IEP/504 details", "health records", "discipline records"],
    expectedEvidenceArtifacts: ["browser/session-log.jsonl", "browser/screenshots/", "browser/sis-role-export-review.md"],
  },
  {
    id: "google-admin-mfa-sharing-review",
    serviceType: "google-admin",
    loginAssumption: "operator has completed Google Admin login in the persistent browser profile",
    steps: [
      "Record admin role context and scoped organization units.",
      "Review MFA, recovery, sharing, app access, and external collaboration settings.",
      "Capture redacted screenshots of policy pages and note inherited settings.",
      "List evidence-backed gaps and unknowns for validation.",
    ],
    requiredScreenshots: ["google-admin-role-context", "mfa-policy-summary", "sharing-policy-summary"],
    requiredNotes: ["admin role", "MFA posture", "sharing posture", "app access posture"],
    prohibitedRawData: ["mailbox contents", "drive document contents", "student records", "secrets"],
    expectedEvidenceArtifacts: ["browser/session-log.jsonl", "browser/screenshots/", "browser/google-admin-review.md"],
  },
  {
    id: "microsoft-entra-role-mfa-review",
    serviceType: "microsoft-entra",
    loginAssumption: "operator has completed Microsoft/Entra admin login in the persistent browser profile",
    steps: [
      "Record tenant/admin role context without exposing user private data.",
      "Review privileged roles, conditional access, MFA posture, app registrations, and guest access.",
      "Capture redacted policy and role screenshots.",
      "Record unknowns that need export/parser follow-up.",
    ],
    requiredScreenshots: ["entra-role-context", "conditional-access-summary", "privileged-role-summary"],
    requiredNotes: ["tenant role", "MFA/conditional access", "guest access", "app registration risks"],
    prohibitedRawData: ["mailbox contents", "chat contents", "student records", "secrets"],
    expectedEvidenceArtifacts: ["browser/session-log.jsonl", "browser/screenshots/", "browser/microsoft-entra-review.md"],
  },
  {
    id: "mdm-admin-device-review",
    serviceType: "mdm",
    loginAssumption: "operator has completed MDM admin login in the persistent browser profile",
    steps: [
      "Record MDM role context and managed device scope.",
      "Review enrollment, compliance, remote action, app deployment, and lost-mode controls.",
      "Capture redacted screenshots of policy summaries and risky admin actions.",
      "Record device-data handling limits and validation follow-ups.",
    ],
    requiredScreenshots: ["mdm-role-context", "device-compliance-summary", "remote-action-controls"],
    requiredNotes: ["admin role", "device scope", "remote action controls", "policy gaps"],
    prohibitedRawData: ["device precise location", "student personal files", "secrets", "raw serial inventory unless authorized"],
    expectedEvidenceArtifacts: ["browser/session-log.jsonl", "browser/screenshots/", "browser/mdm-admin-review.md"],
  },
]

export function browserWorkflowManifests() {
  return WORKFLOWS
}

export function getBrowserWorkflow(id: BrowserWorkflowID | string) {
  return WORKFLOWS.find((workflow) => workflow.id === id)
}
