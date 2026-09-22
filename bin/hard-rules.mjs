#!/usr/bin/env node
// hard-rules CLI: status / validate / render / edit / new / install / uninstall.
// Zero npm dependencies.

import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { DEFAULT_DENY_UNTIL_ACKNOWLEDGED, loadRulesFile, resolveRulesFilePath, userRulesPath } from "../lib/rules.mjs"
import { renderRulesToPrompt, ruleLoadFailureBlock } from "../lib/render.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")
const DEFAULT_TEMPLATE = path.resolve(ROOT, "rules", "hard-rules.default.json")
const SCHEMA_FILE = path.resolve(ROOT, "rules", "rules.schema.json")

const PLUGIN_ENTRY = path.resolve(ROOT, "plugin", "index.mjs")
const CLI_ENTRY = path.resolve(HERE, "hard-rules.mjs")
const GLOBAL_PLUGINS_DIR = () => path.join(homedir(), ".config", "opencode", "plugins")
const GLOBAL_PLUGIN_LOADER = () => path.join(GLOBAL_PLUGINS_DIR(), "hard-rules.mjs")
const BIN_LINK = () => path.join(homedir(), ".local", "bin", "hard-rules")

const ANSI = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", bold: "\x1b[1m", dim: "\x1b[2m" }
const color = (code, s) => (process.stdout.isTTY ? `${ANSI[code]}${s}${ANSI.reset}` : s)

function resolvedFile(arg) {
  return arg ? path.resolve(arg) : resolveRulesFilePath()
}

function scaffoldUserRules() {
  const file = HARD_RULES_USER_FILE()
  if (existsSync(file)) return file
  mkdirSync(path.dirname(file), { recursive: true })
  copyFileSync(DEFAULT_TEMPLATE, file)
  return file
}
const HARD_RULES_USER_FILE = () => {
  if (process.env.HARD_RULES_FILE) return path.resolve(process.env.HARD_RULES_FILE)
  return userRulesPath()
}

// ---------------------------------------------------------------- commands

function cmdStatus(arg) {
  const file = resolvedFile(arg)
  const state = loadRulesFile(file)
  console.log(color("bold", "HARD RULES"))
  console.log(`  file:      ${file}`)
  console.log(`  schema:    ${SCHEMA_FILE}`)
  if (!state.rules) {
    console.log(`  status:    ${color("red", "INVALID / NOT LOADED")}`)
    for (const e of state.errors) console.log(`    ${color("red", "•")} ${e}`)
    for (const w of state.warnings) console.log(`    ${color("yellow", "•")} ${w}`)
    process.exitCode = 1
    return
  }
  const r = state.rules
  const ack = r.acknowledgement ?? {}
  const gate = r.enforcement?.deny_until_acknowledged ?? DEFAULT_DENY_UNTIL_ACKNOWLEDGED
  const summary = [
    ["extra rules", r.extra_rules?.length ?? 0],
    ["forbidden models", r.budget?.forbidden_models?.length ?? 0],
    ["forbidden command patterns", r.enforcement?.bash_forbidden_patterns?.length ?? 0],
    ["forbidden file paths", r.enforcement?.write_forbidden_paths?.length ?? 0],
    ["blocked web hosts", r.enforcement?.webfetch_forbidden_hosts?.length ?? 0],
    ["banned tools", r.enforcement?.deny_tools?.length ?? 0],
  ]
  console.log(`  status:    ${color("green", "ok")} (${r.name ?? "unnamed"})`)
  console.log(`  groups:    location, budget, infra, legal, service_level, enforcement`)
  for (const [label, n] of summary) if (n > 0) console.log(`  ${label}:     ${n}`)
  console.log(`  ack:       ${ack.require === false ? "not required" : `required — "${ack.phrase}"`}`)
  console.log(`  enforce:   acknowledgment gate = ${color("bold", (ack.require ?? true) ? "ON" : "OFF")}`)
  console.log(`            gated tools: ${gate.join(", ")}`)
  for (const w of state.warnings) console.log(`  ${color("yellow", "warn")} ${w}`)
}

function cmdValidate(arg) {
  const file = resolvedFile(arg)
  const state = loadRulesFile(file)
  if (state.rules) {
    console.log(color("green", `✓ ${file}`))
    console.log(color("green", "  rules are valid and will be enforced."))
    for (const w of state.warnings) console.log(`  ${color("yellow", "warn")} ${w}`)
    return
  }
  console.log(color("red", `✗ ${file}`))
  for (const e of state.errors) console.log(`  ${color("red", "•")} ${e}`)
  for (const w of state.warnings) console.log(`  ${color("yellow", "•")} ${w}`)
  console.log(color("dim", "  Tip: hard-rules new to write a fresh template, or hard-rules edit to fix."))
  process.exitCode = 1
}

function cmdRender(arg) {
  const file = resolvedFile(arg)
  const state = loadRulesFile(file)
  if (state.rules) {
    console.log(renderRulesToPrompt(state.rules, state.warnings))
  } else {
    console.log(ruleLoadFailureBlock(file, state.errors))
    process.exitCode = 1
  }
}

function cmdNew(arg) {
  const file = arg ? path.resolve(arg) : HARD_RULES_USER_FILE()
  if (existsSync(file)) {
    console.error(color("red", `Refusing to overwrite existing file: ${file}`))
    process.exitCode = 1
    return
  }
  mkdirSync(path.dirname(file), { recursive: true })
  copyFileSync(DEFAULT_TEMPLATE, file)
  console.log(color("green", `✓ Wrote rules template to ${file}`))
  console.log(color("dim", "  Edit it now (hard-rules edit), then restart opencode to enforce."))
}

function cmdEdit(arg) {
  const file = arg ? path.resolve(arg) : scaffoldUserRules()
  if (!existsSync(file)) cmdNew(file)
  const editor = process.env.VISUAL || process.env.EDITOR || "vi"
  const res = spawnSync(editor, [file], { stdio: "inherit", shell: true })
  if (res.status !== 0) {
    console.error(color("red", `Editor "${editor}" exited with status ${res.status ?? "error"}.`))
    process.exitCode = 1
    return
  }
  cmdValidate(file)
}

function cmdInstall() {
  const loader = GLOBAL_PLUGIN_LOADER()
  const binLink = BIN_LINK()
  mkdirSync(GLOBAL_PLUGINS_DIR(), { recursive: true })
  writeFileSync(
    loader,
    `// auto-generated by hard-rules install; remove with: hard-rules uninstall\nexport { default } from ${JSON.stringify(PLUGIN_ENTRY)}\n`,
  )
  const userRules = scaffoldUserRules()
  console.log(color("green", `✓ Personal rules: ${userRules}`))
  console.log(color("dim", `  (plugin loads ${process.env.HARD_RULES_FILE ? "your $HARD_RULES_FILE" : "this file"} next; bundled rules/hard-rules.json are neutral defaults)`))
  try {
    mkdirSync(path.dirname(binLink), { recursive: true })
    rmSync(binLink, { force: true })
    symlinkSync(CLI_ENTRY, binLink)
    console.log(color("green", `✓ Plugin loader: ${loader}`))
    console.log(color("green", `✓ CLI link:      ${binLink} -> ${CLI_ENTRY}`))
  } catch (err) {
    console.log(color("yellow", `✓ Plugin loader: ${loader}`))
    console.log(color("yellow", `  (CLI symlink skipped: ${err.message})`))
  }
  console.log(color("bold", "Restart opencode (quit and reopen) for the plugin to load and start enforcing."))
}

function cmdUninstall() {
  rmSync(GLOBAL_PLUGIN_LOADER(), { force: true })
  rmSync(BIN_LINK(), { force: true })
  console.log(color("green", "✓ Removed plugin loader and CLI link."))
  console.log(color("bold", "Restart opencode for the change to take effect."))
}

function cmdHelp() {
  console.log(`hard-rules — hard constraints for every opencode session

USAGE
  hard-rules [command] [file]

COMMANDS
  status                Show rules state and enforcement summary (default)
  validate [file]       Validate the rules file against the schema
  render                Print the exact prompt block agents will receive
  edit [file]           Open the rules file in $EDITOR (scaffolds if missing)
  new [file]            Write a fresh rules template
  install               Link the plugin into global opencode config
  uninstall             Remove the plugin loader and CLI link

ENV
  HARD_RULES_FILE       Path to the rules JSON (default: ~/.config/hard-rules/hard-rules.json)
  HARD_RULES_PLUGIN_PKG Path to @opencode-ai/plugin dist/index.js (plugin only)

Sources: ${PLUGIN_ENTRY}`)
}

// ------------------------------------------------------------------ main

const [command, ...rest] = process.argv.slice(2)
const arg = rest.find((a) => !a.startsWith("-"))

switch (command) {
  case undefined:
  case "status":
    cmdStatus(arg)
    break
  case "validate":
    cmdValidate(arg)
    break
  case "render":
    cmdRender(arg)
    break
  case "new":
    cmdNew(arg)
    break
  case "edit":
    cmdEdit(arg)
    break
  case "install":
    cmdInstall()
    break
  case "uninstall":
    cmdUninstall()
    break
  case "-h":
  case "--help":
  case "help":
    cmdHelp()
    break
  default:
    console.error(color("red", `Unknown command: ${command}`))
    cmdHelp()
    process.exitCode = 1
}