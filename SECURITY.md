# Security boundaries

Hard-rules is a local policy plugin and CLI, running as the same account that
owns its configuration. It is not a filesystem or process sandbox.

- The positional file argument and HARD_RULES_FILE intentionally select an
  arbitrary local rules file. Read/status/render/edit use that user-selected
  file. New-file creation refuses an existing entry, uses exclusive copy and
  sets owner-only POSIX permissions. These paths are not remote request input.
- VISUAL / EDITOR intentionally selects a trusted editor executable. The CLI
  passes the rules filename as one literal argument with shell execution off.
  Environment configuration may select a program; a filename may not become a
  shell command. Use a wrapper executable for editor flags.
- bash_forbidden_patterns contains intentional regular expressions authored by
  the configuration owner. Regex injection findings on that operation do not
  indicate an unintended interpretation of literal text. Do not load untrusted
  regex configuration: a pathological regex can consume CPU. Model patterns use
  the documented matching semantics; those are separate from command regexes.

CodeQL path findings on explicit CLI-selected files and regex findings on trusted
rule definitions are reviewed as intentional capabilities. This rationale does
not cover paths or patterns sourced from a remote service or model output.
The editor filename shell-injection issue must be fixed in code, not dismissed
under the trusted-configuration rationale.

Missing or invalid rules deny the plugin's tool and permission hooks. Its
filesystem checks remain susceptible to concurrent filesystem changes; OS
permissions and an execution sandbox provide stronger isolation.
