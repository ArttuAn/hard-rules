// Locate the @opencode-ai/plugin runtime so the hard-rules plugin can build its
// custom tool with the *matching* zod instance that opencode itself uses.
//
// Priority: HARD_RULES_PLUGIN_PKG env override, then the opencode global config
// install (where opencode already keeps the package), then the bare specifier
// (for workspaces where it resolves directly).

import { homedir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const candidates = []
if (process.env.HARD_RULES_PLUGIN_PKG) candidates.push(process.env.HARD_RULES_PLUGIN_PKG)
candidates.push(
  path.join(homedir(), ".config", "opencode", "node_modules", "@opencode-ai", "plugin", "dist", "index.js"),
)

export async function loadToolHelper() {
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(candidate).href)
      if (mod && typeof mod.tool === "function") return mod.tool
    } catch {
      // try next candidate
    }
  }
  try {
    const mod = await import("@opencode-ai/plugin")
    if (mod && typeof mod.tool === "function") return mod.tool
  } catch {
    // fall through
  }
  throw new Error(
    "hard-rules: could not load the @opencode-ai/plugin tool helper. Set HARD_RULES_PLUGIN_PKG to the plugin package's dist/index.js path.",
  )
}