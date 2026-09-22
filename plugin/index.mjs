// hard-rules opencode plugin.
//
// What it does:
//   1. Injects the full, rendered hard-rules block into the system prompt of
//      every session (and into compaction context, so constraints survive
//      compaction).
//   2. Exposes an `acknowledge_hard_rules` tool. Before any gated tool runs
//      (bash/edit/write/webfetch/...) the session must have acknowledged the
//      rules by calling that tool with the exact configured phrase.
//   3. Denies tool calls that mechanically violate the rules: banned tools,
//      forbidden command patterns, forbidden file paths, blocked web hosts.
//   4. At startup, replaces configured models that match budget.forbidden_models
//      when an allowed list is configured (budget enforcement).
//
// Failure behaviour: if the rules file is missing or invalid, the plugin does
// NOT break opencode (fail-open) but injects a loud warning into every prompt
// and logs the error. Run `hard-rules validate` to see what is wrong.

import {
  ACKNOWLEDGEMENT_TOOL,
  evaluateToolCall,
  guardModels,
  loadRulesFile,
  resolveRulesFilePath,
} from "../lib/rules.mjs"
import { renderRulesToPrompt, ruleLoadFailureBlock } from "../lib/render.mjs"
import { loadToolHelper } from "./tool-loader.mjs"

const PERMISSION_TITLE_TO_TOOL = { edit: "edit", write: "write", bash: "bash", command: "bash", webfetch: "webfetch", websearch: "websearch", task: "task" }

/**
 * The opencode `Plugin` for hard-rules.
 *
 * @type {import("@opencode-ai/plugin").Plugin}
 */
export const HardRulesPlugin = async ({ client }) => {
  const rulesFile = resolveRulesFilePath()
  const state = loadRulesFile(rulesFile)
  const acknowledged = new Map()

  const log = (level, message, extra = undefined) => {
    try {
      void client?.app?.log({ body: { service: "hard-rules", level, message, extra } })
    } catch {
      // never let logging break the plugin
    }
  }

  let toolHelper
  try {
    toolHelper = await loadToolHelper()
  } catch (err) {
    log("error", err.message)
  }

  log("info", "hard-rules loaded", {
    file: rulesFile,
    valid: state.errors.length === 0,
    errors: state.errors,
    warnings: state.warnings,
  })

  const promptBlock = state.rules
    ? renderRulesToPrompt(state.rules, state.warnings)
    : ruleLoadFailureBlock(rulesFile, state.errors)

  const isAcknowledged = (sessionID) => acknowledged.get(sessionID) === true

  return {
    tool: toolHelper
      ? {
          [ACKNOWLEDGEMENT_TOOL]: toolHelper({
            description:
              "Acknowledge the HARD RULES for this session. MUST be called with the exact configured phrase before using any tool that edits files, runs commands, spends money, or contacts the network.",
            args: {
              phrase: toolHelper.schema.string().describe("The exact acknowledgement phrase, just as it appears in the HARD RULES block of the system prompt."),
            },
            async execute(args, context) {
              return {
                title: "Hard rules acknowledged",
                output: `Hard rules acknowledged for session ${context.sessionID}. Enforcement is active from now on.`,
              }
            },
          }),
        }
      : undefined,

    config: async (cfg) => {
      if (!state.rules || !cfg) return
      try {
        const guard = guardModels(cfg, state.rules)
        for (const warning of guard.warnings) {
          state.warnings.push(warning)
          log("warn", warning)
        }
      } catch (err) {
        log("error", "model guard failed", { message: err.message })
      }
    },

    // Inject the rules at the TOP of the system prompt on every request.
    "experimental.chat.system.transform": async (_input, output) => {
      if (output && Array.isArray(output.system)) {
        output.system.unshift(promptBlock)
      }
    },

    // Keep the rules in the compaction prompt so they survive summarisation.
    "experimental.session.compacting": async (_input, output) => {
      if (output?.context) output.context.push(promptBlock)
    },

    // Primary enforcement point.
    "tool.execute.before": async (input, output) => {
      if (!state.rules) return
      const sessionID = input.sessionID
      const verdict = evaluateToolCall({
        tool: input.tool,
        args: output?.args ?? {},
        acknowledged: isAcknowledged(sessionID),
        rules: state.rules,
      })
      if (!verdict.allowed) {
        log("warn", "tool denied", { tool: input.tool, sessionID, reason: verdict.reason })
        throw new Error(verdict.reason)
      }
      if (verdict.acknowledgedNow) {
        acknowledged.set(sessionID, true)
        log("info", "hard rules acknowledged", { sessionID })
      }
    },

    // Defence-in-depth: also deny at the permission gate, so a gated tool can
    // never slip through even if the before-hook ordering changes.
    "permission.ask": async (input, output) => {
      if (!state.rules || !output) return
      if (output.status === "deny") return
      const title = String(input?.title ?? "")
      const toolName =
        (typeof input?.metadata?.tool === "string" && input.metadata.tool) ||
        PERMISSION_TITLE_TO_TOOL[title.split(/[\s:]+/)[0]?.toLowerCase?.()] ||
        ""
      if (!toolName) return
      const verdict = evaluateToolCall({
        tool: toolName,
        args: (typeof input?.metadata?.args === "object" && input.metadata.args) || {},
        acknowledged: isAcknowledged(input.sessionID),
        rules: state.rules,
      })
      if (!verdict.allowed) output.status = "deny"
    },
  }
}

export default HardRulesPlugin