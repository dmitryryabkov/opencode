import { app } from "electron"

type Channel = "dev" | "beta" | "prod" | "dogfood"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" || raw === "dogfood" ? raw : "dev"

export const APP_NAMES: Record<Channel, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
  dogfood: "OpenCode Dogfood",
}

export const APP_IDS: Record<Channel, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
  dogfood: "ai.opencode.desktop.dogfood",
}

export const PROTOCOL_SCHEMES: Record<Channel, string> = {
  dev: "opencode-dev",
  beta: "opencode",
  prod: "opencode",
  dogfood: "opencode-dogfood",
}

export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_ENABLED_KEY = "wslEnabled"
export const UPDATER_ENABLED = app.isPackaged && (CHANNEL === "beta" || CHANNEL === "prod")
