# Global rules

These rules apply to every session, on every project. Keep this file lean.

## Working style

- Plan first, then build. For anything non-trivial, load the `planning` skill and follow it: plan in the task tracker, then wait for my approval before building.
- Show me diffs before committing. Never commit unless I explicitly ask.
- Ship via PRs: put work on a dated topic branch (`<type>/<slug>-<YYYY-MM-DD>`); pushing
  the branch and opening the PR (`gh pr create`) is part of shipping when I ask to ship.
  Pushing or merging `master` directly is always the human's action.
- Always run the project's tests and linter after changes. Never claim done without verifying.
- Prefer the ecosystem's official tooling over hand-rolled equivalents.
- No comments in code unless I ask.
- After substantive edits, run `@review` on the changes and report its
  verdict (APPROVE / REQUEST CHANGES) — or say why review is waived. The
  review-enforcer plugin will remind you; don't make it.

## File ownership

- If you run as a different uid than the workspace owner (sandbox/canvas
  agents), anything you create — files, directories, and paths git writes
  under `.git/` — inherits your uid and later breaks host-side tools
  (pre-commit hooks, git writes). Hand ownership back at creation time, not
  at commit time: capture the workspace owner once (`stat` on the repo root),
  then `sudo chown -hR <u>:<g> <new path>` right after creating it; in the
  canvas sudo is passwordless, and on the host you are already the owner so
  skip the chown quietly. `opencode/bin/oh-fix` is the manual host-side
  repair for sessions that leaked ownership.

## Context

- If the project has its own AGENTS.md, its rules take precedence over these.

## Toolkit index

Global commands available anywhere:

- `/bless` — bootstrap the current repo for agent-driven work (analyze, generate AGENTS.md + opencode.json); uses the `workflow` skill
- `/new <language> <name>` — scaffold a new project from scratch with official tooling; uses the `workflow` and `scaffolding` skills
- `/grill-me <idea>` — stress-test an idea through a stateless interview; uses `grill-me` and `grilling`, only when explicitly requested
- `/director-adopt`, `/director-complete`, `/director-handoff` — Director state workflow (needs the `director` binary)
- `/diagrams` — update architecture diagrams in `docs/diagrams/` after structural code changes; `/diagrams audit` for a full consistency check
- `/session-handoff` — checkpoint the conversation into an Obsidian session note (needs the vault's `log_session.py`; set `OBSIDIAN_VAULT` if the vault isn't at `~/Dropbox/obsidian/general`)
- `/progress` — live progress of everything running on the opencode server: background jobs (shells, subagents) + active sessions, one S4-quantified line per item; `/progress <filter>` deep-dives the matches (needs `jq`)

Skills: `planning` (plan-first protocol with the task tracker — load it
before any non-trivial work), `workflow`, `scaffolding`,
`token-optimization` (token-efficiency playbook), `dotfiles` (maintenance
playbook for the dotfiles repo itself). Load via the skill tool when
relevant; `grill-me` and `grilling` are opt-in interview skills, not an
automatic planning step.
