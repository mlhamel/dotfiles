---
name: workflow
description: Playbooks for blessing existing repos and scaffolding new projects, including the per-project opencode.json template
---

# Workflow playbooks

## Bless playbook

Bootstrap a repository for agent-driven development. Use when `/bless` is invoked or when starting work in an unblessed repo.

1. **Detect** — identify language, framework, package manager, test runner, linter/formatter. Read manifests (`pyproject.toml`, `package.json`, `Cargo.toml`, `go.mod`, etc.) and CI configs. Don't guess; read.
2. **Plan** — show me what you found and what you intend to create. Wait for approval.
3. **Create** — generate or improve, in this order:
   - `AGENTS.md` (see template below)
   - `opencode.json` with strict per-project permissions (see template below)
   - `.gitignore` if missing (use the language's standard template)
   - `git init` + initial commit only if the directory isn't a repo yet
4. **Verify** — confirm every command documented in AGENTS.md actually runs (build, test, lint). Fix AGENTS.md if anything is wrong.
5. **Report** — summarize what was created and what I should review.

### AGENTS.md template

Adapt to what was detected; drop sections that don't apply:

```markdown
# <project>

One-paragraph description of what this project does.

## Commands
- build: <command>
- test: <command> (single test: <command>)
- lint: <command>
- format: <command>

## Structure
- brief map of the important directories

## Conventions
- language/framework-specific patterns actually observed in this codebase
- gotchas an agent would miss from filenames alone
```

Rules for the template:
- Only document commands you have verified run.
- Conventions must be observed in the actual code, not generic best practices.
- Keep it under ~60 lines; reference other docs instead of duplicating.

### Per-project opencode.json template

Strict posture for unfamiliar code:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "ask",
    "bash": {
      "*": "ask",
      "git status*": "allow",
      "git diff*": "allow",
      "git log*": "allow",
      "<test command>*": "allow",
      "<lint command>*": "allow"
    }
  }
}
```

Replace `<test command>*` and `<lint command>*` with the detected tooling (e.g. `pytest *`, `npm test*`, `cargo test*`, `ruff *`, `golangci-lint *`). Leave `git commit`, `git push`, and destructive commands on `ask`.

## New-project playbook

Use when `/new <language> <name>` is invoked, together with the `scaffolding` skill.

1. **Confirm** — restate language, project name, and any constraints back to me.
2. **Scaffold** — use the official scaffolder from the `scaffolding` skill. Never hand-roll project structure.
3. **Baseline** — add `.gitignore`, README, one example test, lint config if the scaffolder doesn't.
4. **Bless** — run the bless playbook above on the fresh project.
5. **Verify** — build and tests pass; commit only if I ask.