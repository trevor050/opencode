import { describe, expect, test } from "bun:test"
import { containsRawCredentialSecret, expectedCredentialServices, missingCredentialServices } from "@/ulm/credential-safety"

describe("credential safety", () => {
  test("allows hyphenated evidence ids that end with secret-like words", () => {
    expect(
      containsRawCredentialSecret(
        "- ev-reset-audit-log-token: Synthetic exposed reset token audit log (evidence/raw/ev-reset-audit-log-token.txt)",
      ),
    ).toBe(false)
  })

  test("rejects raw credential secrets in JSON-shaped strings", () => {
    expect(containsRawCredentialSecret('{"resetToken":"reset-lab-token-7142"}')).toBe(true)
  })

  test("allows JSON security-control metadata that mentions cookies", () => {
    expect(containsRawCredentialSecret('{"cookieSameSite":"none","cookieAccepted":true}')).toBe(false)
  })

  test("does not treat negated service labels as credential coverage", () => {
    const plan = { credentialTargets: ["genesis", "google"] }

    expect(
      missingCredentialServices(plan, [
        { credentialID: "genesis-1", label: "Genesis SIS redacted account" },
        { credentialID: "placeholder-1", label: "Not Google, no Google credential submitted" },
      ]),
    ).toEqual(["google"])
  })

  test("counts explicit service fields even when the label says no-secret placeholder", () => {
    const plan = { credentialTargets: ["genesis", "google", "sis"] }

    expect(
      missingCredentialServices(plan, [
        {
          credentialID: "cred-synthetic-genesis-no-secret",
          label: "Synthetic Genesis SIS no-secret scope placeholder",
          service: "genesis",
          target: "genesis",
        },
        {
          credentialID: "cred-synthetic-google-no-secret",
          label: "Synthetic Google Workspace no-secret scope placeholder",
          service: "google",
          target: "google",
        },
        {
          credentialID: "cred-synthetic-sis-no-secret",
          label: "Synthetic SIS no-secret scope placeholder",
          service: "sis",
          target: "sis",
        },
      ]),
    ).toEqual([])
  })

  test("does not infer credential handoff from synthetic no-credential service mentions", () => {
    expect(
      expectedCredentialServices({
        assumptions: [
          "Synthetic lab evidence mentions Genesis SIS and Google Workspace only.",
          "Credential handling is not applicable for this synthetic-only drill.",
          "No credentials are available or required.",
        ],
      }),
    ).toEqual([])
  })

  test("does not infer credential services from service inventory without credential context", () => {
    expect(
      expectedCredentialServices({
        assumptions: [
          "Synthetic Genesis SIS role export is supplied evidence only.",
          "Synthetic Google Workspace group listing is supplied evidence only.",
          "No raw secrets, student records, or live system access are in scope.",
        ],
        phases: [
          {
            actions: [
              "Create evidence records for Genesis SIS and Google Workspace.",
              "Create professional people profiles and an identity graph.",
            ],
          },
        ],
      }),
    ).toEqual([])
  })

  test("infers credential services when service names appear near credential context", () => {
    expect(
      expectedCredentialServices({
        phases: [{ actions: ["Use submitted Genesis and Google credentials for authenticated checks."] }],
      }),
    ).toEqual(["genesis", "google"])
  })
})
