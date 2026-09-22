// Render the loaded rules as a prompt block injected into every session.

import { ACKNOWLEDGEMENT_TOOL } from "./rules.mjs"

function heading(text) {
  return `## ${text}`
}

function bullet(items) {
  if (!Array.isArray(items) || items.length === 0) return "  (none)"
  return items.map((i) => `  - ${i}`).join("\n")
}

export function renderRulesToPrompt(rules, warnings = []) {
  const ack = rules.acknowledgement ?? {}
  const loc = rules.location ?? {}
  const budget = rules.budget ?? {}
  const infra = rules.infra ?? {}
  const legal = rules.legal ?? {}
  const sl = rules.service_level ?? {}
  const enf = rules.enforcement ?? {}
  const name = rules.name ?? "unset"

  const lines = []
  lines.push("# HARD RULES \u2014 NON-NEGOTIABLE")
  lines.push("")
  lines.push(`These rules are injected by the **hard-rules** plugin into every opencode session (project: "${name}"). Every product, architecture choice, deployment target and line of code you produce in this session MUST satisfy these constraints. They describe real obligations of the person running this session, including legal ones. Treat them as absolute. If following a rule conflicts with the user's casual request, the rule wins \u2014 and if meeting these rules requires asking the user something, ask instead of violating them.`)
  lines.push("")

  lines.push(heading("Acknowledge before acting"))
  lines.push(`Before using any tool listed under the acknowledgement gate below (edits, commands, network, subagents), you MUST call the \`${ACKNOWLEDGEMENT_TOOL}\` tool once with the exact phrase:`)
  lines.push(`  \u201C${ack.phrase ?? "(none configured)"}\u201D`)
  lines.push("If you try to use a gated tool first, it will be denied with an explanation. Read-only tools (read, glob, grep, list) are always allowed.")
  lines.push("")

  if (Object.keys(loc).length) {
    lines.push(heading("Location & users"))
    lines.push(`  - Country / jurisdiction: \`${loc.country ?? "?"}\` (region \`${loc.region ?? "?"}\`` + (loc.timezone ? `, timezone \`${loc.timezone}\`)` : ")`"))
    lines.push(`  - Primary language: \`${loc.live_language_primary ?? "?"}\`; languages to serve: ` + bullet(loc.languages_served ?? []).trim().replace(/^  -/, ""))
    lines.push(`Design for these users first: latency, language, payment method and cultural expectations must be chosen for them, not for a generic audience.`)
    lines.push("")
  }

  if (Object.keys(budget).length) {
    lines.push(heading("Budget"))
    lines.push(`  - Currency: ${budget.currency ?? "?"}; monthly cap: ${budget.max_monthly_spend_units ?? "unset"}; per-task cap: ${budget.max_single_task_spend_units ?? "unset"}`)
    lines.push(`  - Forbidden models: ` + bullet(budget.forbidden_models ?? []).trim().replace(/^  -/, ""))
    lines.push(`  - Allowed models: ` + bullet(budget.allowed_models ?? []).trim().replace(/^  -/, ""))
    if (budget.prefer_open_source) lines.push(`  - Prefer open-source building blocks where they are a strictly-better free-of-charge fit.`)
    lines.push(`Never exceed the caps. If a reasonable approach would exceed them, stop and ask the user before proceeding.`)
    lines.push("")
  }

  if (Object.keys(infra).length) {
    lines.push(heading("Infrastructure"))
    lines.push(`  - Allowed hosting regions: ` + bullet(infra.hosting_region_allowlist ?? []).trim().replace(/^  -/, ""))
    lines.push(`  - Data residency requirements: ` + bullet(infra.data_residency ?? []).trim().replace(/^  -/, ""))
    lines.push(`  - Allowed providers: ` + bullet(infra.cloud_provider_allowlist ?? []).trim().replace(/^  -/, ""))
    if (infra.cloud_provider_denylist?.length) lines.push(`  - Denied providers: ` + bullet(infra.cloud_provider_denylist).trim().replace(/^  -/, ""))
    lines.push(`  - Mandatory properties: ` + bullet(infra.must_have ?? []).trim().replace(/^  -/, ""))
    lines.push(`  - Forbidden tech: ` + bullet(infra.forbidden_tech ?? []).trim().replace(/^  -/, ""))
    lines.push(`Pick infrastructure that satisfies data residency and region allowlists. Do not silently substitute an out-of-allowlist provider or region.`)
    lines.push("")
  }

  if (Object.keys(legal).length) {
    lines.push(heading("Legal & compliance"))
    lines.push(`  - Jurisdiction(s): ` + bullet(legal.jurisdiction_codes ?? []).trim().replace(/^  -/, ""))
    lines.push(`  - Must comply with: ` + bullet(legal.must_comply ?? []).trim().replace(/^  -/, ""))
    if (legal.age_gate_required) lines.push(`  - Age gate required before any content.`)
    if (legal.consent_required_features?.length) lines.push(`  - Explicit consent required before: ` + bullet(legal.consent_required_features).trim().replace(/^  -/, ""))
    lines.push(`Violating these is not acceptable, even if the user asks directly. When a feature could trip a legal requirement you cannot resolve confidently, stop and flag it.`)
    lines.push("")
  }

  if (Object.keys(sl).length) {
    lines.push(heading("Service level"))
    if (sl.max_acceptable_latency_ms != null) lines.push(`  - Max acceptable latency: ${sl.max_acceptable_latency_ms} ms`)
    if (sl.uptime_target != null) lines.push(`  - Uptime target: ${sl.uptime_target}%`)
    lines.push(`  - Notes: ` + bullet(sl.notes ?? []).trim().replace(/^  -/, ""))
    lines.push("")
  }

  lines.push(heading("Enforcement summary"))
  lines.push(`  - Acknowledgement gate required: ${ack.require !== false ? "yes" : "no"}`)
  lines.push(`  - Tools denied until acknowledged: ` + bullet(enf.deny_until_acknowledged ?? []).trim().replace(/^  -/, ""))
  lines.push(`  - Banned tools: ` + bullet(enf.deny_tools ?? []).trim().replace(/^  -/, ""))
  lines.push(`  - Forbidden command patterns: ` + bullet(enf.bash_forbidden_patterns ?? []).trim().replace(/^  -/, ""))
  lines.push(`  - Forbidden file paths: ` + bullet(enf.write_forbidden_paths ?? []).trim().replace(/^  -/, ""))
  lines.push(`  - Blocked web hosts: ` + bullet(enf.webfetch_forbidden_hosts ?? []).trim().replace(/^  -/, ""))
  lines.push("")

  lines.push(heading("Standing build rules"))
  lines.push(bullet(rules.extra_rules ?? []))
  lines.push("")

  lines.push(heading("Model budget guard"))
  lines.push("The plugin inspects the merged opencode config at startup and replaces any configured model that matches `budget.forbidden_models` when an `budget.allowed_models` entry exists; otherwise it warns.")
  lines.push("")

  if (Array.isArray(warnings) && warnings.length) {
    lines.push(heading("Plugin warnings"))
    lines.push(bullet(warnings))
    lines.push("")
  }

  lines.push("---")
  lines.push("End of HARD RULES. Acknowledge them with the acknowledgement tool before building.")
  return lines.join("\n")
}

export function ruleLoadFailureBlock(rulesFile, errors = []) {
  const lines = []
  lines.push("# HARD RULES \u2014 COULD NOT BE LOADED")
  lines.push("")
  lines.push(`The hard-rules plugin is active but its rules file could not be loaded:`)
  lines.push(`  file: \`${rulesFile}\``)
  lines.push("")
  lines.push("Errors:")
  lines.push(bullet(errors.length ? errors : ["unknown"]))
  lines.push("")
  lines.push("Consequence: NO hard-rule enforcement is active in this session.")
  lines.push("Fix the file and restart opencode. You can also run: `node ~/hard-rules/bin/hard-rules.mjs validate`")
  return lines.join("\n")
}