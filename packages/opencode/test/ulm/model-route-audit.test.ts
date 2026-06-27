import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { auditULMModelRoutes } from "@/ulm/model-route-audit"
import { writeOperationGraph } from "@/ulm/operation-graph"
import { tmpdir } from "../fixture/fixture"

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

const cleanProfile = {
  model: "openai/gpt-5.5",
  small_model: "openai/gpt-5.4-mini-fast",
  agent: {
    pentest: { model: "openai/gpt-5.5" },
    action: { model: "openai/gpt-5.5" },
    recon: { model: "openai/gpt-5.4-mini-fast" },
    "person-recon": { model: "openai/gpt-5.4-mini-fast" },
    evidence: { model: "openai/gpt-5.4-mini-fast" },
    validator: { model: "openai/gpt-5.5" },
    "report-writer": { model: "openai/gpt-5.5" },
    "report-reviewer": { model: "openai/gpt-5.5" },
  },
}

describe("ULM model route audit", () => {
  test("passes with GPT-5.5 primary and Mini Fast support lanes", async () => {
    await using dir = await tmpdir({ git: true })
    const profile = path.join(dir.path, "opencode.json")
    const installed = path.join(dir.path, "installed")
    await writeJson(profile, cleanProfile)
    await fs.mkdir(installed, { recursive: true })
    await writeJson(path.join(installed, "opencode.json"), cleanProfile)
    await writeJson(path.join(installed, "ulmcode.json"), cleanProfile)
    await writeOperationGraph(dir.path, { operationID: "School", budgetUSD: 10 })

    const result = await auditULMModelRoutes({
      worktree: dir.path,
      operationID: "School",
      profileConfigPath: profile,
      installedConfigDir: installed,
      includeInstalled: true,
      launchEnv: {
        OPENCODE_APP_NAME: "ulmcode",
        OPENCODE_CONFIG_DIR: installed,
        OPENCODE_CONFIG: path.join(installed, "opencode.json"),
        OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      },
    })

    expect(result.ok).toBe(true)
    expect(result.graphRouteAudit?.routes.every((route) => route.providerID === "openai")).toBe(true)
  })

  test("fails on non-OpenAI providers and installed config drift", async () => {
    await using dir = await tmpdir({ git: true })
    const profile = path.join(dir.path, "opencode.json")
    const installed = path.join(dir.path, "installed")
    await writeJson(profile, { ...cleanProfile, provider: { anthropic: {} } })
    await fs.mkdir(installed, { recursive: true })
    await writeJson(path.join(installed, "opencode.json"), cleanProfile)
    await writeJson(path.join(installed, "ulmcode.json"), { ...cleanProfile, model: "opencode/big-pickle" })

    const result = await auditULMModelRoutes({
      worktree: dir.path,
      profileConfigPath: profile,
      installedConfigDir: installed,
      includeInstalled: true,
      checkLaunchEnv: false,
    })

    expect(result.ok).toBe(false)
    expect(result.gaps.join("\n")).toContain("provider key is not allowed")
    expect(result.gaps.join("\n")).toContain("opencode/big-pickle")
    expect(result.gaps.join("\n")).toContain("installed opencode.json and ulmcode.json disagree")
  })

  test("strict launch env fails closed when ULM OpenAI routing env is unset", async () => {
    await using dir = await tmpdir({ git: true })
    const profile = path.join(dir.path, "opencode.json")
    const installed = path.join(dir.path, "installed")
    await writeJson(profile, cleanProfile)
    await fs.mkdir(installed, { recursive: true })
    await writeJson(path.join(installed, "opencode.json"), cleanProfile)
    await writeJson(path.join(installed, "ulmcode.json"), cleanProfile)

    const result = await auditULMModelRoutes({
      worktree: dir.path,
      profileConfigPath: profile,
      installedConfigDir: installed,
      includeInstalled: true,
      launchEnv: {},
    })

    expect(result.ok).toBe(false)
    expect(result.launchEnv.ok).toBe(false)
    expect(result.gaps.join("\n")).toContain("OPENCODE_APP_NAME must be ulmcode, got unset")
    expect(result.gaps.join("\n")).toContain("OPENCODE_CONFIG_DIR must point at")
    expect(result.gaps.join("\n")).toContain("OPENCODE_DISABLE_PROJECT_CONFIG must be 1, got unset")
  })
})
