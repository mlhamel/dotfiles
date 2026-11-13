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

## 4. Always-visible progress

- Long commands — anything past ~1 minute (builds, full test suites) — launch
  in the background (`background: true`) so live output stays watchable;
  proceed on the completion notification.
- Never redirect command output to `/dev/null` (or `-o /dev/null`, `> &-`):
  silence hides a hung, crashed, or failed run. Redirect into
  `/tmp/opencode/` and let the file carry it (section 2).
- Do not wait blind until completion: poll the log at short intervals
  (`sleep N; grep`/`tail`) and report interim progress in each reply — e.g.
  `make bench` redirected to a log is polled with
  `grep -c '^\[' bench.log` against the known work total, a test log with
  `grep -c '^test '` (and totals from a `-- --list` run). A verdict with no
  interim observations means you were not actually watching the run.
- Every status about a live run is one quantified line:
  `<cmd> · <log> · <done>/<total> <unit> · elapsed <T> · next check <N>s`.
  Counts come from a fresh grep of the log in the same turn — "on the
  final suites" is not a count — and the log path is always named so the
  human can `tail -f` it directly. If the runner has no per-item output,
  rerun with a verbose/list option or wrap it so the log gains countable
  stage markers.
- On any turn triggered by a background notification, poll the logs of
  ALL live background jobs before writing — not only the job that woke
  you.
- If a long step must block the transcript, announce before launching: the
  command, why it is slow, where output lands.
- Once it finishes, ingest a tail/grep verdict line: what ran, counts or key
  metric, exit code, wall time, e.g.
  `pytest: 214 passed, 3 failed, exit 1, 96s (fails in /tmp/opencode/test.log)`.
  A run is not "verified" because the shell returned — the log must show the
  summary line. Short commands stay unchanged.
