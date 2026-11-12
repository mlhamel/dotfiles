# SSSM execution rules

Short-context discipline modeled on the Semantic State Space Model concept
("You don't need long context", NVIDIA, arXiv:2611.05306): keep the live
window short and carry the state outside the transcript. The context window
is capped at 65536 tokens and compaction fires around 49152, so context is a
scarce, deliberately budgeted resource. These rules are always in effect.

## 1. Persistent logbook (`STATE.md`)

Maintain `.opencode/STATE.md` in the active workspace across the whole task:
create it on the first action of a substantive task, update it at every
milestone. It carries, kept current at all times:

- **Goal** — the task's main objective and acceptance criteria
- **Current Progress** — the state of the code and tests
- **Relevant Artifacts** — the relevant files and their exact paths
- **Next Immediate Action** — the exact next action to execute
- **Blockers** — open obstacles

Never presume the previous transcript persists: every architectural decision
and key result must land in `STATE.md` the moment it happens. On creation,
also add `.opencode/STATE.md` to the project's `.git/info/exclude` so it
never shows in `git status` and never enters a commit.

## 2. Selective reads — zero context flooding

- Never read a whole file longer than 80 lines: locate with ripgrep first,
  then read targeted slices (for example, a ±20-line range around the match).
- Redirect verbose terminal output (tests, builds, compilations) to
  `/tmp/opencode/` and inspect it with `grep`, `head`, or `tail` instead of
  letting it flood context.

## 3. Atomicity of actions

- Keep the loop at one action followed by observation and a `STATE.md`
  update, instead of stacking dozens of actions in one window without
  logging state.
- Write key decisions and outcomes to `STATE.md` as they happen: a fresh
  session must be able to resume from the file alone.
