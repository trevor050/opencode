import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const packageRoot = path.join(__dirname, "../..")
const repoRoot = path.join(packageRoot, "../..")
const profileRoot = path.join(repoRoot, "tools/ulmcode-profile")

describe("ULM profile authenticated browser MCPs", () => {
  test("adds a persistent Playwright MCP workbench without removing lightweight browser tools", async () => {
    const opencode = JSON.parse(await fs.readFile(path.join(profileRoot, "opencode.json"), "utf8")) as {
      mcp?: Record<string, { type?: string; command?: string[]; enabled?: boolean }>
    }

    expect(opencode.mcp?.agent_browser?.command).toContain("agent-browser-mcp")
    expect(opencode.mcp?.playwright?.command).toContain("@playwright/mcp@latest")
    expect(opencode.mcp?.playwright_persistent).toMatchObject({
      type: "local",
      command: ["__ULMCODE_PROFILE_DIR__/mcp/playwright-persistent/run-stdio.sh"],
    })
  })

  test("keeps browser allowlists and profile smoke checks aligned", async () => {
    const installScript = await fs.readFile(path.join(profileRoot, "scripts/install-profile.sh"), "utf8")
    const auditSource = await fs.readFile(path.join(packageRoot, "src/ulm/model-route-audit.ts"), "utf8")
    const profileSmoke = await fs.readFile(path.join(profileRoot, "test-profile.sh"), "utf8")
    const wrapper = await fs.readFile(path.join(profileRoot, "mcp/playwright-persistent/run-stdio.sh"), "utf8")

    expect(installScript).toContain("playwright_persistent")
    expect(auditSource).toContain('"playwright_persistent"')
    expect(profileSmoke).toContain('"playwright_persistent"')
    expect(wrapper).toContain("--user-data-dir")
    expect(wrapper).toContain("--output-dir")
    expect(wrapper).toContain("ULMCODE_OPERATION_ID")
  })
})
