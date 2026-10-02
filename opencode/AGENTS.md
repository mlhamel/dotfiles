# Global rules

These rules apply to every session, on every project. Keep this file lean.

## Working style

- Plan first, then build. For anything non-trivial, propose a plan and wait for approval.
- Show me diffs before committing. Never commit unless I explicitly ask.
- Always run the project's tests and linter after changes. Never claim done without verifying.
- Prefer the ecosystem's official tooling over hand-rolled equivalents.
- No comments in code unless I ask.

## Context

- If the project has its own AGENTS.md, its rules take precedence over these.

## Toolkit index

Global commands available anywhere:

- `/bless` — bootstrap the current repo for agent-driven work (analyze, generate AGENTS.md + opencode.json); uses the `workflow` skill
- `/new <language> <name>` — scaffold a new project from scratch with official tooling; uses the `workflow` and `scaffolding` skills
- `/director-adopt`, `/director-complete`, `/director-handoff` — Director state workflow (needs the `director` binary)
- `/session-handoff` — checkpoint the conversation into an Obsidian session note (needs the vault's `log_session.py`)

Load skills via the skill tool when the commands are invoked.
