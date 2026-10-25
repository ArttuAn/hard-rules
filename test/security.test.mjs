import { test } from "node:test"
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { evaluateToolCall, loadRulesFile, validateRules } from "../lib/rules.mjs"

const base = () => ({version: 1, acknowledgement: {require: true, phrase: "ack"}})

test("command regex quantifiers are enforced exactly as validated", () => {
  const rules = {...base(), enforcement: {bash_forbidden_patterns: ["^echo(?:\\s+blocked)*$"]}}
  assert.deepEqual(validateRules(rules).errors, [])
  for (const command of ["echo", "echo blocked", "echo blocked blocked"]) {
    assert.equal(evaluateToolCall({tool: "bash", args: {command}, acknowledged: true, rules}).allowed, false)
  }
  assert.equal(evaluateToolCall({tool: "bash", args: {command: "echo allowed"}, acknowledged: true, rules}).allowed, true)
})

test("malformed nested rules return validation errors rather than breaking plugin startup", () => {
  for (const key of ["location", "budget", "infra", "legal", "service_level", "enforcement"]) {
    for (const value of [null, 42, "invalid", []]) {
      const result = validateRules({...base(), [key]: value})
      assert.ok(result.errors.length, `${key}: ${value}`)
    }
  }
  for (const bad of [false, {}, 4]) {
    assert.ok(validateRules({...base(), enforcement: {bash_forbidden_patterns: bad}}).errors.length)
    assert.ok(validateRules({...base(), extra_rules: [bad]}).errors.length)
  }
})

test("malformed file leaves rules unavailable for the deny hooks", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rules-invalid-"))
  try {
    const file = path.join(root, "rules.json")
    writeFileSync(file, JSON.stringify({...base(), location: null}))
    assert.equal(loadRulesFile(file).rules, null)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test("JSON errors do not quote private rule values into logs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rules-private-"))
  try {
    const file = path.join(root, "rules.json")
    writeFileSync(file, "private-credential-value")
    const state = loadRulesFile(file)
    assert.equal(state.rules, null)
    assert.ok(state.errors.length)
    assert.ok(!state.errors.join(" ").includes("private-credential-value"))
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test("new rules files have owner-only POSIX permissions", {skip: process.platform === "win32"}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "rules-permissions-"))
  try {
    const file = path.join(root, "new.json")
    const cli = fileURLToPath(new URL("../bin/hard-rules.mjs", import.meta.url))
    const result = spawnSync(process.execPath, [cli, "new", file], {encoding: "utf8"})
    assert.equal(result.status, 0, result.stderr)
    assert.equal(statSync(file).mode & 0o777, 0o600)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test("editor receives one literal filename including shell metacharacters", {skip: process.platform === "win32"}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "rules-editor-"))
  try {
    const editor = path.join(root, "editor with spaces")
    const captured = path.join(root, "argv.txt")
    const marker = path.join(root, "injected")
    const file = path.join(root, "rules;touch injected;#.json")
    writeFileSync(file, JSON.stringify(base()))
    writeFileSync(editor, '#!/bin/sh\nprintf "%s\\n" "$#" "$1" > "$CAPTURED"\n')
    chmodSync(editor, 0o700)
    const cli = fileURLToPath(new URL("../bin/hard-rules.mjs", import.meta.url))
    const result = spawnSync(process.execPath, [cli, "edit", file], {
      cwd: root, encoding: "utf8", env: {...process.env, VISUAL: editor, EDITOR: editor, CAPTURED: captured},
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(captured, "utf8"), `1\n${file}\n`)
    assert.equal(existsSync(marker), false)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test("npm installation has no global configuration lifecycle hook", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)))
  assert.equal(pkg.scripts.install, undefined)
  assert.equal(pkg.scripts.postinstall, undefined)
  assert.equal(pkg.scripts.preinstall, undefined)
})
