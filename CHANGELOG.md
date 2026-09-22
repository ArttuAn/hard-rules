# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-22

### Added
- `opencode-hard-rules` plugin for opencode 1.x.
- Rules JSON schema (`rules/rules.schema.json`) covering acknowledgement,
  location, budget, infra, legal, service level, enforcement and standing rules.
- Three enforcement layers:
  - rules block injected into every session's system prompt and compaction context;
  - `acknowledge_hard_rules` tool gating mutating/spending tools until the exact phrase is given;
  - mechanical denial of banned tools, forbidden command patterns, forbidden file paths and blocked web hosts.
- Budget model guard: configured models matching `budget.forbidden_models` are
  replaced at config load when `budget.allowed_models` is non-empty.
- Zero-dependency CLI: `status`, `validate`, `render`, `edit`, `new`, `install`, `uninstall`.
- Personal rules live in `~/.config/hard-rules/hard-rules.json`; the repo ships
  neutral defaults.
- 24 unit + plugin smoke tests.
- Logo and icon assets.