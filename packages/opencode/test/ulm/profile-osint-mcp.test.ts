import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packageRoot = path.join(__dirname, "../..")
const repoRoot = path.join(packageRoot, "../..")
const profileRoot = path.join(repoRoot, "tools/ulmcode-profile")

describe("ULM profile API-key-free OSINT MCPs", () => {
  test("adds focused no-key OSINT MCPs to the profile", async () => {
    const opencode = JSON.parse(await fs.readFile(path.join(profileRoot, "opencode.json"), "utf8")) as {
      mcp?: Record<string, { type?: string; command?: string[]; url?: string; oauth?: boolean; enabled?: boolean }>
    }

    expect(opencode.mcp?.companyscope).toEqual({
      type: "local",
      command: ["npx", "-y", "companyscope-mcp"],
    })
    expect(opencode.mcp?.not_human_search).toMatchObject({
      type: "remote",
      url: "https://nothumansearch.ai/mcp",
      enabled: true,
      oauth: false,
    })
    expect(opencode.mcp?.openregistry).toMatchObject({
      type: "remote",
      url: "https://openregistry.sophymarine.com/mcp",
      enabled: true,
    })
  })

  test("keeps launch and audit allowlists aligned with added MCPs", async () => {
    const installScript = await fs.readFile(path.join(profileRoot, "scripts/install-profile.sh"), "utf8")
    const auditSource = await fs.readFile(path.join(packageRoot, "src/ulm/model-route-audit.ts"), "utf8")
    const profileSmoke = await fs.readFile(path.join(profileRoot, "test-profile.sh"), "utf8")

    for (const mcp of ["companyscope", "not_human_search", "openregistry"]) {
      expect(installScript).toContain(mcp)
      expect(auditSource).toContain(`"${mcp}"`)
      expect(profileSmoke).toContain(`"${mcp}"`)
    }
  })
})
