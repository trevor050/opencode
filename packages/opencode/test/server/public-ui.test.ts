import { describe, expect, test } from "bun:test"
import { isPublicUIPath } from "@/server/shared/public-ui"

describe("public UI auth bypasses", () => {
  test("allows the credential vault page and form actions without exposing materialized secrets", () => {
    expect(isPublicUIPath("GET", "/ulm/credentials")).toBe(true)
    expect(isPublicUIPath("GET", "/ulm/operation/school/credentials")).toBe(true)
    expect(isPublicUIPath("POST", "/ulm/operation/school/credentials")).toBe(true)
    expect(isPublicUIPath("POST", "/ulm/operation/school/credentials/submit")).toBe(true)
    expect(isPublicUIPath("DELETE", "/ulm/operation/school/credentials/cred-1")).toBe(true)

    expect(isPublicUIPath("POST", "/ulm/operation/school/credentials/materialize-env")).toBe(false)
  })
})
