// hard-rules core engine: loading, validation, and tool-call enforcement.
// Shared by the opencode plugin and the hard-rules CLI. Zero npm dependencies.

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ACKNOWLEDGEMENT_TOOL = "acknowledge_hard_rules"

// ~/.config/hard-rules/hard-rules.json — the personal, per-user rules file.
// Bundled rules/hard-rules.json is a safe neutral template shipped in the repo.
export function userRulesPath() {
  return path.join(homedir(), ".config", "hard-rules", "hard-rules.json")
}

export function bundledRulesPath() {
  return fileURLToPath(new URL("../rules/hard-rules.json", import.meta.url))
}

/**
 * Resolution order for the rules file:
 *   1. $HARD_RULES_FILE
 *   2. ~/.config/hard-rules/hard-rules.json (if it exists)
 *   3. the bundled neutral default shipped with the package
 */
export function resolveRulesFilePath() {
  if (process.env.HARD_RULES_FILE) return process.env.HARD_RULES_FILE
  const user = userRulesPath()
  if (existsSync(user)) return user
  return bundledRulesPath()
}

export const DEFAULT_DENY_UNTIL_ACKNOWLEDGED = [
  "bash",
  "edit",
  "write",
  "create",
  "patch",
  "webfetch",
  "websearch",
  "task",
]

const SCOPE_KEYS = new Set([
  "version",
  "name",
  "acknowledgement",
  "location",
  "budget",
  "infra",
  "legal",
  "service_level",
  "enforcement",
  "extra_rules",
])

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export function loadRulesFile(filePath) {
  const result = { rules: null, errors: [], warnings: [] }
  if (!filePath || !existsSync(filePath)) {
    result.errors.push(`Rules file not found: ${filePath ?? "(none)"}`)
    return result
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"))
  } catch (err) {
    result.errors.push(`Rules file is not valid JSON: ${err.message}`)
    return result
  }
  const verdict = validateRules(parsed)
  result.errors.push(...verdict.errors)
  result.warnings.push(...verdict.warnings)
  if (result.errors.length === 0) result.rules = parsed
  return result
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const COUNTRY_RE = /^[A-Z]{2}$/

function isStr(v) {
  return typeof v === "string"
}

function isStrArray(v) {
  return Array.isArray(v) && v.every(isStr)
}

export function validateRules(rules) {
  const errors = []
  const warnings = []
  if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
    errors.push("Rules must be a JSON object.")
    return { errors, warnings }
  }

  for (const key of Object.keys(rules)) {
    if (!SCOPE_KEYS.has(key)) errors.push(`Unknown top-level key "${key}".`)
  }

  if (rules.version !== 1) errors.push('"version" must be 1.')
  if ("name" in rules && !isStr(rules.name)) errors.push('"name" must be a string.')

  // acknowledgement ---
  const ack = rules.acknowledgement ?? {}
  if (typeof ack !== "object" || Array.isArray(ack)) {
    errors.push('"acknowledgement" must be an object.')
  } else {
    if (typeof ack.require !== "boolean") errors.push('"acknowledgement.require" must be a boolean.')
    if (!isStr(ack.phrase) || ack.phrase.trim() === "") errors.push('"acknowledgement.phrase" must be a non-empty string.')
    for (const key of Object.keys(ack)) {
      if (!["require", "phrase"].includes(key)) errors.push(`Unknown key "acknowledgement.${key}".`)
    }
  }

  // location ---
  const loc = rules.location
  if (loc !== undefined) {
    if (typeof loc !== "object" || Array.isArray(loc)) errors.push('"location" must be an object.')
    else {
      if ("country" in loc && (!isStr(loc.country) || !COUNTRY_RE.test(loc.country)))
        errors.push('"location.country" must be a two-letter ISO country code (e.g. "FI").')
      if ("region" in loc && !isStr(loc.region)) errors.push('"location.region" must be a string.')
      if ("timezone" in loc && !isStr(loc.timezone)) errors.push('"location.timezone" must be a string.')
      if ("live_language_primary" in loc && !isStr(loc.live_language_primary))
        errors.push('"location.live_language_primary" must be a string.')
      if ("languages_served" in loc && !isStrArray(loc.languages_served))
        errors.push('"location.languages_served" must be an array of strings.')
    }
  }

  // budget ---
  const budget = rules.budget
  if (budget !== undefined) {
    if (typeof budget !== "object" || Array.isArray(budget)) errors.push('"budget" must be an object.')
    else {
      if ("currency" in budget && (!isStr(budget.currency) || budget.currency.trim() === ""))
        errors.push('"budget.currency" must be a non-empty string (e.g. "EUR").')
      for (const key of ["max_monthly_spend_units", "max_single_task_spend_units", "cost_checkpoint_threshold_units"]) {
        if (key in budget && typeof budget[key] !== "number")
          errors.push(`"budget.${key}" must be a number.`)
        else if (key in budget && budget[key] !== null && budget[key] < 0)
          errors.push(`"budget.${key}" cannot be negative.`)
      }
      if ("forbidden_models" in budget && !isStrArray(budget.forbidden_models))
        errors.push('"budget.forbidden_models" must be an array of glob strings.')
      if ("allowed_models" in budget && !isStrArray(budget.allowed_models))
        errors.push('"budget.allowed_models" must be an array of model strings.')
      if ("prefer_open_source" in budget && typeof budget.prefer_open_source !== "boolean")
        errors.push('"budget.prefer_open_source" must be a boolean.')
    }
  }

  // infra / legal / service_level ---
  for (const scope of ["infra", "legal", "service_level"]) {
    const s = rules[scope]
    if (s === undefined) continue
    if (typeof s !== "object" || Array.isArray(s)) {
      errors.push(`"${scope}" must be an object.`)
      continue
    }
    if (scope === "service_level") {
      if ("max_acceptable_latency_ms" in s && typeof s.max_acceptable_latency_ms !== "number")
        errors.push('"service_level.max_acceptable_latency_ms" must be a number.')
      if ("uptime_target" in s && (typeof s.uptime_target !== "number" || s.uptime_target < 0 || s.uptime_target > 100))
        errors.push('"service_level.uptime_target" must be a number between 0 and 100.')
      if ("notes" in s && !isStrArray(s.notes)) errors.push('"service_level.notes" must be an array of strings.')
    } else {
      for (const key of [
        "hosting_region_allowlist",
        "data_residency",
        "cloud_provider_allowlist",
        "cloud_provider_denylist",
        "must_have",
        "forbidden_tech",
        "jurisdiction_codes",
        "must_comply",
        "consent_required_features",
      ]) {
        if (key in s && !isStrArray(s[key])) errors.push(`"${scope}.${key}" must be an array of strings.`)
      }
      if ("age_gate_required" in s && typeof s.age_gate_required !== "boolean")
        errors.push('"legal.age_gate_required" must be a boolean.')
    }
  }

  // enforcement ---
  const enf = rules.enforcement
  if (enf !== undefined) {
    if (typeof enf !== "object" || Array.isArray(enf)) errors.push('"enforcement" must be an object.')
    else {
      for (const key of ["deny_tools", "deny_until_acknowledged", "bash_forbidden_patterns", "write_forbidden_paths", "webfetch_forbidden_hosts"]) {
        if (key in enf && !isStrArray(enf[key])) errors.push(`"enforcement.${key}" must be an array of strings.`)
      }
      for (const p of enf.bash_forbidden_patterns ?? []) {
        try {
          new RegExp(p, "i")
        } catch {
          errors.push(`"enforcement.bash_forbidden_patterns" contains an invalid regex: ${JSON.stringify(p)}`)
        }
      }
    }
  }

  // extra_rules ---
  if ("extra_rules" in rules && !isStrArray(rules.extra_rules))
    errors.push('"extra_rules" must be an array of strings.')
  if (Array.isArray(rules.extra_rules)) {
    rules.extra_rules.forEach((r, i) => {
      if (r.trim() === "") errors.push(`"extra_rules[${i}]" cannot be empty.`)
    })
  }

  // advisory warnings ---
  const allowListEmpty = (arr) => !Array.isArray(arr) || arr.length === 0
  const budgetForbids = budget?.forbidden_models ?? []
  if (Array.isArray(budgetForbids) && budgetForbids.length && allowListEmpty(budget?.allowed_models)) {
    warnings.push('"budget.forbidden_models" is set but "budget.allowed_models" is empty: model replacements will not be possible; forbidden models will only be flagged.')
  }
  if (loc?.country) {
    const resid = rules.infra?.data_residency ?? []
    if (Array.isArray(resid) && resid.length && !resid.some((r) => typeof r === "string" && r.toLowerCase() === "eu") && (loc.country === "FI" || loc.region === "eu")) {
      warnings.push('"location" is EU but "infra.data_residency" does not include "eu".')
    }
  }

  return { errors, warnings }
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

export function globToRe(glob) {
  let re = "^"
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") re += ".*"
    else if (c === "?") re += "."
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  re += "$"
  try {
    return new RegExp(re)
  } catch {
    return null
  }
}

function safeRe(pattern) {
  try {
    return new RegExp(pattern.replace(/\*/g, ".*"), "i")
  } catch {
    return null
  }
}

function hostForUrl(url) {
  if (typeof url !== "string") return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    const m = url.match(/^https?:\/\/([^/?#]+)/i)
    return m ? m[1].replace(/^www\./, "").toLowerCase() : ""
  }
}

const WRITE_TOOLS = new Set(["edit", "write", "create", "patch"])

/**
 * Evaluate a single tool call against the hard rules.
 *
 * @param {object} ctx
 * @param {string} ctx.tool
 * @param {object} ctx.args
 * @param {boolean} ctx.acknowledged  has this session given the acknowledgement phrase?
 * @param {object} ctx.rules          validated rules object
 * @returns {{allowed: true, acknowledgedNow?: boolean} | {allowed: false, reason: string}}
 */
export function evaluateToolCall({ tool: t, args = {}, acknowledged = false, rules }) {
  const ack = rules?.acknowledgement ?? {}
  const enf = rules?.enforcement ?? {}

  // 1) the acknowledgement tool itself
  if (t === ACKNOWLEDGEMENT_TOOL) {
    if (!acknowledged && ack.phrase) {
      const given = typeof args.phrase === "string" ? args.phrase.trim() : ""
      if (given !== ack.phrase.trim()) {
        return {
          allowed: false,
          reason: `Acknowledgement rejected: the phrase does not match the required phrase. Use exactly: "${ack.phrase.trim()}"`,
        }
      }
    }
    return { allowed: true, acknowledgedNow: true }
  }

  // 2) banned tools
  const denyTools = enf.deny_tools ?? []
  if (denyTools.includes(t)) {
    return { allowed: false, reason: `Tool "${t}" is banned by the hard rules (enforcement.deny_tools).` }
  }

  // 3) acknowledgement gate
  const requireAck = ack.require !== false
  const denyUntil = enf.deny_until_acknowledged ?? DEFAULT_DENY_UNTIL_ACKNOWLEDGED
  if (requireAck && !acknowledged && denyUntil.includes(t)) {
    return {
      allowed: false,
      reason: `Hard rules not yet acknowledged. Call the "${ACKNOWLEDGEMENT_TOOL}" tool with the exact phrase before using "${t}".`,
    }
  }

  // 4) bash command patterns
  if (t === "bash" && typeof args.command === "string") {
    for (const p of enf.bash_forbidden_patterns ?? []) {
      const re = safeRe(p)
      if (re && re.test(args.command)) {
        return { allowed: false, reason: `Command blocked by hard rule (pattern: ${JSON.stringify(p)}).` }
      }
    }
  }

  // 5) write/edit path patterns
  if (WRITE_TOOLS.has(t) && typeof args.filePath === "string") {
    for (const glob of enf.write_forbidden_paths ?? []) {
      const re = globToRe(glob)
      if (re && re.test(args.filePath)) {
        return { allowed: false, reason: `Path blocked by hard rule (pattern: ${JSON.stringify(glob)}).` }
      }
    }
  }

  // 6) webfetch host patterns
  if (t === "webfetch" && typeof args.url === "string") {
    const host = hostForUrl(args.url)
    for (const blocked of enf.webfetch_forbidden_hosts ?? []) {
      const b = String(blocked).toLowerCase()
      if (host === b || host.endsWith("." + b)) {
        return { allowed: false, reason: `Host "${host}" is blocked by the hard rules (webfetch_forbidden_hosts).` }
      }
    }
  }

  return { allowed: true }
}

// ---------------------------------------------------------------------------
// Model / budget guard (applied to the merged config at startup)
// ---------------------------------------------------------------------------

/**
 * Replace or flag models that violate budget.forbidden_models.
 * Mutates cfg in place when a replacement is possible.
 * @returns {{ warnings: string[], changed: boolean }}
 */
export function guardModels(cfg, rules) {
  const budget = rules?.budget ?? {}
  const forbids = (budget.forbidden_models ?? []).map(safeRe).filter(Boolean)
  const warnings = []
  let changed = false
  if (!forbids.length) return { warnings, changed }

  const allowed = (budget.allowed_models ?? []).map((s) => s).filter(Boolean)
  const check = (model, label) => {
    if (typeof model !== "string" || !model) return
    if (forbids.some((re) => re.test(model))) {
      if (allowed.length) {
        warnings.push(`Model "${model}" (${label}) is forbidden by the hard rules; replaced with allowed model "${allowed[0]}".`)
        return allowed[0]
      }
      warnings.push(`Model "${model}" (${label}) is forbidden by the hard rules, and no replacement is configured (budget.allowed_models is empty).`)
      return undefined
    }
    return undefined
  }

  if (typeof cfg?.model === "string") {
    const m = check(cfg.model, "default model")
    if (m !== undefined) {
      cfg.model = m
      changed = true
    }
  }
  if (typeof cfg?.small_model === "string") {
    const m = check(cfg.small_model, "small model")
    if (m !== undefined) {
      cfg.small_model = m
      changed = true
    }
  }
  if (cfg?.agent && typeof cfg.agent === "object") {
    for (const [name, agent] of Object.entries(cfg.agent)) {
      if (agent && typeof agent === "object" && typeof agent.model === "string") {
        const m = check(agent.model, `agent "${name}"`)
        if (m !== undefined) {
          agent.model = m
          changed = true
        }
      }
    }
  }
  return { warnings, changed }
}