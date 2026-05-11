import { describe, expect, test } from "bun:test"
import { auditModelRoutes, buildModelRuntimeCatalog, resolveModelRuntime } from "@/ulm/model-runtime-catalog"

describe("ULM model runtime catalog", () => {
  test("builds model limits, costs, and cost cliffs from provider metadata", () => {
    const catalog = buildModelRuntimeCatalog({
      openai: {
        source: "env",
        models: {
          "gpt-current": {
            limit: { context: 1_000_000, output: 128_000 },
            cost: {
              input: 2,
              output: 10,
              cache: { read: 0.2, write: 1 },
              experimentalOver200K: { input: 4, output: 20, cache: { read: 0.4, write: 2 } },
            },
          },
        },
      },
    })

    expect(catalog["openai/gpt-current"]).toMatchObject({
      providerKind: "api",
      contextLimit: 1_000_000,
      outputLimit: 128_000,
      inputUSDPerMTok: 2,
      outputUSDPerMTok: 10,
      cacheReadUSDPerMTok: 0.2,
      cacheWriteUSDPerMTok: 1,
      costCliffTokens: 200_000,
    })
    expect(resolveModelRuntime("openai/gpt-current", catalog)?.contextLimit).toBe(1_000_000)
  })

  test("does not infer unavailable OpenCode Go route metadata", () => {
    const catalog = buildModelRuntimeCatalog({
      "opencode-go": {
        source: "custom",
        models: {
          default: {
            limit: { context: 200_000, output: 32_000 },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          },
        },
      },
    })

    expect(resolveModelRuntime("opencode-go/qwen3.6-plus", catalog)).toBeUndefined()
  })

  test("audits primary and fallback route availability against provider metadata", () => {
    const providers = {
      openai: {
        source: "env",
        models: {
          "gpt-5.5": { limit: { context: 1_000_000, output: 128_000 } },
        },
      },
    }

    const audit = auditModelRoutes({
      operationID: "school",
      providers,
      routes: [
        { route: "openai/gpt-5.5", laneID: "report_writing", role: "primary" },
        { route: "openai/gpt-5.5", laneID: "recon", role: "fallback" },
        { route: "openai/missing-model", laneID: "recon", role: "fallback" },
      ],
    })

    expect(audit.routes.find((route) => route.route === "openai/gpt-5.5")).toMatchObject({
      availableInProviderList: true,
      hasRuntimeMetadata: true,
      quotaPolicyKnown: false,
    })
    expect(audit.routes.find((route) => route.route === "openai/missing-model")).toMatchObject({
      availableInProviderList: false,
      hasRuntimeMetadata: false,
    })
    expect(audit.gaps).toContain("openai/missing-model: route is not present in provider model list")
    expect(audit.gaps).toContain("openai/missing-model: runtime metadata is missing")
  })
})
