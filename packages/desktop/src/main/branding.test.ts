import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  APP_IDS,
  APP_NAMES,
  DESKTOP_PROTOCOLS,
  PRIMARY_DESKTOP_PROTOCOL,
  SETTINGS_STORE,
  WINDOW_TITLE,
  getDesktopAppId,
  getDesktopAppName,
  getSidecarEnvDefaults,
  getUlmOperationsDirectory,
  isDesktopDeepLink,
} from "./branding"

describe("desktop branding", () => {
  test("uses ULMCode channel app names and ids", () => {
    expect(APP_NAMES).toEqual({
      dev: "ULMCode Dev",
      beta: "ULMCode Beta",
      prod: "ULMCode Desktop",
    })
    expect(APP_IDS).toEqual({
      dev: "ai.ulmcode.desktop.dev",
      beta: "ai.ulmcode.desktop.beta",
      prod: "ai.ulmcode.desktop",
    })
    expect(getDesktopAppName("beta")).toBe("ULMCode Beta")
    expect(getDesktopAppName("unknown")).toBe("ULMCode Dev")
    expect(getDesktopAppId("prod")).toBe("ai.ulmcode.desktop")
    expect(getDesktopAppId("unknown")).toBe("ai.ulmcode.desktop.dev")
  })

  test("publishes ulmcode as primary protocol and still accepts opencode links", () => {
    expect(PRIMARY_DESKTOP_PROTOCOL).toBe("ulmcode")
    expect(DESKTOP_PROTOCOLS).toEqual(["ulmcode", "opencode"])
    expect(isDesktopDeepLink("ulmcode://session/abc")).toBe(true)
    expect(isDesktopDeepLink("opencode://session/abc")).toBe(true)
    expect(isDesktopDeepLink("https://ulmcode.ai")).toBe(false)
  })

  test("uses ULMCode window title and settings store", () => {
    expect(WINDOW_TITLE).toBe("ULMCode Desktop")
    expect(SETTINGS_STORE).toBe("ulmcode.settings")
  })

  test("renderer HTML titles match the desktop window title", async () => {
    for (const file of ["index.html", "loading.html"]) {
      expect(await Bun.file(join(import.meta.dir, "../renderer", file)).text()).toContain(
        `<title>${WINDOW_TITLE}</title>`,
      )
    }
  })

  test("sets ULMCode sidecar env defaults without overriding explicit env", () => {
    expect(getSidecarEnvDefaults("/Users/tester", {})).toEqual({
      XDG_CONFIG_HOME: "/Users/tester/.config/ulmcode-xdg",
      XDG_DATA_HOME: "/Users/tester/.local/share/ulmcode",
      XDG_STATE_HOME: "/Users/tester/.local/state/ulmcode",
      XDG_CACHE_HOME: "/Users/tester/.cache/ulmcode",
      OPENCODE_APP_NAME: "ulmcode",
      OPENCODE_CONFIG_DIR: "/Users/tester/.config/ulmcode",
      OPENCODE_CONFIG: "/Users/tester/.config/ulmcode/opencode.json",
      OPENCODE_DB: "opencode-local.db",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_MCP_ALLOWLIST: "websearch,agent_browser,playwright,pentestMCP",
      OMO_DISABLE_POSTHOG: "1",
    })

    expect(
      getSidecarEnvDefaults("/Users/tester", {
        XDG_DATA_HOME: "/custom/data",
        OPENCODE_CONFIG_DIR: "/custom/config",
        OPENCODE_DB: "custom.db",
        OPENCODE_MCP_ALLOWLIST: "agent_browser",
      }),
    ).toMatchObject({
      XDG_DATA_HOME: "/custom/data",
      OPENCODE_CONFIG_DIR: "/custom/config",
      OPENCODE_CONFIG: "/custom/config/opencode.json",
      OPENCODE_DB: "custom.db",
      OPENCODE_MCP_ALLOWLIST: "agent_browser",
    })
  })

  test("resolves the ULM operations directory without exposing project semantics", () => {
    expect(getUlmOperationsDirectory("/Users/tester", { ULMCODE_OPERATIONS_DIR: "/ops" })).toBe("/ops")

    expect(
      getUlmOperationsDirectory("/Users/tester", {}, (path) =>
        path === "/Users/tester/codeprojects/ULMcode/opencode/.ulmcode/operations",
      ),
    ).toBe("/Users/tester/codeprojects/ULMcode/opencode/packages/opencode")

    expect(getUlmOperationsDirectory("/Users/tester", {})).toBe("/Users/tester/.config/ulmcode")
  })
})
