import { test } from "node:test"
import assert from "node:assert/strict"

import {
  ACKNOWLEDGEMENT_TOOL,
  evaluateToolCall,
  globToRe,
  guardModels,
  loadRulesFile,
  validateRules,
} from "../lib/rules.mjs"
import { renderRulesToPrompt } from "../lib/render.mjs"

const BASE_RULES = () => ({
  version: 1,
  acknowledgement: { require: true, phrase: "I have read and will honour the hard rules of this workspace." },
  location: { country: "FI", region: "eu", timezone: "Europe/Helsinki", languages_served: ["en", "fi"] },
  budget: { currency: "EUR", max_monthly_spend_units: 200, forbidden_models: ["*opus*"], allowed_models: ["anthropic/claude-haiku-4-6"] },
  infra: { data_residency: ["eu"], hosting_region_allowlist: ["eu"] },
  legal: { jurisdiction_codes: ["fi", "eu"], must_comply: ["gdpr"] },
  enforcement: {
    deny_until_acknowledged: ["bash", "edit", "write", "webfetch"],
    bash_forbidden_patterns: ["npm publish", "us-central1"],
    write_forbidden_paths: ["**/.env"],
    webfetch_forbidden_hosts: ["doubleclick.net"],
  },
  extra_rules: ["Never route data outside the EU."],
})

// ---------------------------------------------------------------- validation

test("valid rules pass validation", () => {
  assert.deepEqual(validateRules(BASE_RULES()).errors, [])
})

test("unknown top-level key is an error", () => {
  const errors = validateRules({ ...BASE_RULES(), wat: 1 }).errors
  assert.ok(errors.some((e) => e.includes("wat")))
})

test("bad country code is an error", () => {
  const errors = validateRules({ ...BASE_RULES(), location: { country: "Finland" } }).errors
  assert.ok(errors.some((e) => e.includes("country")))
})

test("negative budget is an error", () => {
  const errors = validateRules({ ...BASE_RULES(), budget: { max_monthly_spend_units: -5 } }).errors
  assert.ok(errors.some((e) => e.includes("negative")))
})

test("invalid regex in enforcement is an error", () => {
  const errors = validateRules({ ...BASE_RULES(), enforcement: { bash_forbidden_patterns: ["("] } }).errors
  assert.ok(errors.some((e) => e.includes("invalid regex")))
})

test("missing acknowledgement phrase is an error", () => {
  const errors = validateRules({ ...BASE_RULES(), acknowledgement: { require: true, phrase: "" } }).errors
  assert.ok(errors.some((e) => e.includes("phrase")))
})

test("warns when forbidden models have no allowed replacement", () => {
  const warnings = validateRules({ ...BASE_RULES(), budget: { forbidden_models: ["*opus*"], allowed_models: [] } }).warnings
  assert.ok(warnings.some((w) => w.includes("allowed_models")))
})

// ---------------------------------------------------------------- load

test("loadRulesFile loads and validates a real file", () => {
  const state = loadRulesFile(new URL("../rules/hard-rules.json", import.meta.url).pathname)
  assert.ok(state.rules, "rules should load")
  assert.equal(state.errors.length, 0)
})

test("loadRulesFile reports missing file", () => {
  const state = loadRulesFile("/nonexistent/hard-rules.json")
  assert.equal(state.rules, null)
  assert.ok(state.errors.some((e) => e.includes("not found")))
})

// ---------------------------------------------------------------- enforcement

test("unacknowledged gated tool is denied", () => {
  const result = evaluateToolCall({ tool: "bash", args: { command: "echo hi" }, acknowledged: false, rules: BASE_RULES() })
  assert.equal(result.allowed, false)
  assert.match(result.reason, /not yet acknowledged/)
})

test("unacknowledged read-only tool is allowed", () => {
  const result = evaluateToolCall({ tool: "read", args: { filePath: "/x" }, acknowledged: false, rules: BASE_RULES() })
  assert.equal(result.allowed, true)
})

test("acknowledgement with wrong phrase is rejected", () => {
  const result = evaluateToolCall({ tool: ACKNOWLEDGEMENT_TOOL, args: { phrase: "nope" }, acknowledged: false, rules: BASE_RULES() })
  assert.equal(result.allowed, false)
})

test("acknowledgement with correct phrase sets acknowledgedNow", () => {
  const result = evaluateToolCall({ tool: ACKNOWLEDGEMENT_TOOL, args: { phrase: BASE_RULES().acknowledgement.phrase }, acknowledged: false, rules: BASE_RULES() })
  assert.equal(result.allowed, true)
  assert.equal(result.acknowledgedNow, true)
})

test("bash forbidden pattern is denied after acknowledgement", () => {
  const result = evaluateToolCall({ tool: "bash", args: { command: "npm publish" }, acknowledged: true, rules: BASE_RULES() })
  assert.equal(result.allowed, false)
  assert.match(result.reason, /npm publish/)
})

test("normal bash is allowed after acknowledgement", () => {
  const result = evaluateToolCall({ tool: "bash", args: { command: "npm test" }, acknowledged: true, rules: BASE_RULES() })
  assert.equal(result.allowed, true)
})

test("write to forbidden path is denied", () => {
  const result = evaluateToolCall({ tool: "edit", args: { filePath: "/proj/.env" }, acknowledged: true, rules: BASE_RULES() })
  assert.equal(result.allowed, false)
})

test("webfetch to blocked host is denied", () => {
  const result = evaluateToolCall({ tool: "webfetch", args: { url: "https://stats.doubleclick.net/x" }, acknowledged: true, rules: BASE_RULES() })
  assert.equal(result.allowed, false)
})

test("banned tool is denied even if acknowledged", () => {
  const rules = { ...BASE_RULES(), enforcement: { ...BASE_RULES().enforcement, deny_tools: ["task"] } }
  const result = evaluateToolCall({ tool: "task", args: {}, acknowledged: true, rules })
  assert.equal(result.allowed, false)
})

test("globToRe matches **/.env against nested paths", () => {
  assert.ok(globToRe("**/.env").test("a/b/.env"))
  assert.ok(!globToRe("**/.env").test("a/b/.env.bak"))
})

// ---------------------------------------------------------------- model guard

test("guardModels replaces a forbidden default model", () => {
  const cfg = { model: "anthropic/claude-opus-4-6", small_model: "anthropic/claude-haiku-4-6" }
  const { warnings, changed } = guardModels(cfg, BASE_RULES())
  assert.equal(cfg.model, "anthropic/claude-haiku-4-6")
  assert.equal(changed, true)
  assert.ok(warnings.some((w) => w.includes("opus")))
})

test("guardModels flags but does not touch when no allowed model", () => {
  const cfg = { model: "anthropic/claude-opus-4-6" }
  const rules = { ...BASE_RULES(), budget: { forbidden_models: ["*opus*"], allowed_models: [] } }
  const { warnings, changed } = guardModels(cfg, rules)
  assert.equal(cfg.model, "anthropic/claude-opus-4-6")
  assert.equal(changed, false)
  assert.ok(warnings.some((w) => w.includes("no replacement")))
})

test("guardModels guards agent models", () => {
  const cfg = { agent: { build: { model: "anthropic/claude-opus-4-6" } } }
  guardModels(cfg, BASE_RULES())
  assert.equal(cfg.agent.build.model, "anthropic/claude-haiku-4-6")
})

// ---------------------------------------------------------------- render

test("render includes phrase, sections and standing rules", () => {
  const out = renderRulesToPrompt(BASE_RULES())
  assert.match(out, /HARD RULES/)
  assert.match(out, /acknowledge_hard_rules/)
  assert.match(out, /I have read and will honour the hard rules/)
  assert.match(out, /Budget/)
  assert.match(out, /Infrastructure/)
  assert.match(out, /Legal & compliance/)
  assert.match(out, /Never route data outside the EU/)
})

// ---------------------------------------------------------------- plugin smoke

test("plugin loads, injects rules, and gates tools", async () => {
  const pluginPath = new URL("../plugin/index.mjs", import.meta.url)
  const { default: HardRulesPlugin } = await import(pluginPath)
  const hooks = await HardRulesPlugin({ client: { app: { log: async () => {} } }, directory: "/tmp" })

  const out = { system: ["base"] }
  await hooks["experimental.chat.system.transform"]({}, out)
  assert.ok(out.system[0].includes("HARD RULES"))
  assert.ok(out.system.some((s) => s.includes(ACKNOWLEDGEMENT_TOOL)))

  let blocked = null
  try {
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, { args: { command: "echo hi" } })
  } catch (err) {
    blocked = err.message
  }
  assert.ok(blocked && blocked.includes("not yet acknowledged"), `expected denial, got: ${blocked}`)

  const ackOut = { args: { phrase: BASE_RULES().acknowledgement.phrase } }
  await hooks["tool.execute.before"]({ tool: ACKNOWLEDGEMENT_TOOL, sessionID: "s1", callID: "c2" }, ackOut)

  let blocked2 = null
  try {
    await hooks["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c3" }, { args: { command: "npm publish" } })
  } catch (err) {
    blocked2 = err.message
  }
  assert.match(blocked2, /npm publish/)
})