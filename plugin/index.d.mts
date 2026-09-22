import type { Plugin } from "@opencode-ai/plugin"

/**
 * Investigate: hard constraints for every opencode session.
 *
 * - Injects the rendered rules block into the system prompt of every session
 *   and into compaction context.
 * - Registers the `acknowledge_hard_rules` tool; gated tools are denied until
 *   a session has acknowledged the rules with the exact configured phrase.
 * - Denies tool calls that mechanically violate the rules (banned tools,
 *   forbidden command patterns, forbidden file paths, blocked web hosts).
 * - Replaces configured models matching `budget.forbidden_models` with the
 *   first `budget.allowed_models` entry at config load.
 */
export declare const HardRulesPlugin: Plugin

export default HardRulesPlugin