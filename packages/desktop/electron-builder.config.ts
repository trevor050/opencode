import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Configuration } from "electron-builder"
import {
  APP_IDS,
  APP_NAMES,
  DESKTOP_PROTOCOLS,
  getDesktopPublishConfig,
  resolveDesktopChannel,
} from "./src/main/branding"

const execFileAsync = promisify(execFile)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const signScript = path.join(rootDir, "script", "sign-windows.ps1")

async function signWindows(configuration: { path: string }) {
  if (process.platform !== "win32") return
  if (process.env.GITHUB_ACTIONS !== "true") return

  await execFileAsync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", signScript, configuration.path],
    { cwd: rootDir },
  )
}

const channel = (() => {
  return resolveDesktopChannel(process.env.OPENCODE_CHANNEL)
})()

const getBase = (): Configuration => ({
  artifactName: "ulmcode-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "ULMCode",
    schemes: DESKTOP_PROTOCOLS,
  },
  win: {
    icon: `resources/icons/icon.ico`,
    signtoolOptions: {
      sign: signWindows,
    },
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const base = getBase()

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId: APP_IDS.dev,
        productName: APP_NAMES.dev,
        rpm: { packageName: "ulmcode-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId: APP_IDS.beta,
        productName: APP_NAMES.beta,
        protocols: { name: APP_NAMES.beta, schemes: DESKTOP_PROTOCOLS },
        publish: getDesktopPublishConfig(channel),
        rpm: { packageName: "ulmcode-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId: APP_IDS.prod,
        productName: APP_NAMES.prod,
        protocols: { name: APP_NAMES.prod, schemes: DESKTOP_PROTOCOLS },
        publish: getDesktopPublishConfig(channel),
        rpm: { packageName: "ulmcode" },
      }
    }
  }
}

export default getConfig()
