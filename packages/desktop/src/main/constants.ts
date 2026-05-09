import { app } from "electron"
import { SETTINGS_STORE as DESKTOP_SETTINGS_STORE, resolveDesktopChannel } from "./branding"

const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL = resolveDesktopChannel(raw)

export const SETTINGS_STORE = DESKTOP_SETTINGS_STORE
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
