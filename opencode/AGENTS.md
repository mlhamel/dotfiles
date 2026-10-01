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

- `/bless` — bootstrap the current repo for agent-driven work (analyze, generate AGENTS.md + opencode.json)
- `/new <language> <name>` — scaffold a new project from scratch with official tooling

Both commands rely on the `workflow` and `scaffolding` skills; load them via the skill tool when invoked.