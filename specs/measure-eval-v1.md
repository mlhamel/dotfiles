---
type: Spec
title: Measurement v1 — scheduled evals + trend log
description: Build spec for the factory measurement loop v1 — append-only eval history log, deterministic trend summary, and recorded/manual run entry points.
tags:
  - eval
  - measurement
  - opencode
  - openhands
timestamp: 2026-11-26T11:08:37-05:00
generated:
  at: 2026-11-26T11:08:37-05:00
  by: human:mlhamel
status: draft
sources:
  - id: eval-readme
    resource: ../eval/README.md
    title: Eval harness documentation
    last_modified: 2026-11-26T08:11:12-05:00
  - id: eval-run
    resource: ../eval/run.mjs
    title: Eval harness runner
    last_modified: 2026-11-26T08:11:12-05:00
  - id: dotfiles-todos
    resource: ../TODOs.md
    title: TODOs — Comparaison eval outcome
    last_modified: 2026-11-26T10:58:54-05:00
---

# Spec: Measurement v1 — scheduled evals + trend log

This is the prompt for the agent that implements this feature. Read it,
plan first, then build. Ship via a dated topic branch + PR; pushing/merging
master is the human's action.

## Context

This repo has an eval harness, `eval/run.mjs` (Node ESM, no dependencies).
It runs reference tasks in a scratch copy via `opencode run` and writes one
JSON result per run to `eval/results/<date>-<model-slug>.json`. There are 5
tasks in `eval/tasks/`: `fix-nudger-band`, `fix-plan-exemption`,
`add-fallback-gateway-test`, `docs-tree-sync`, `add-darwin-services-fail-case`.
Each task has a `prompt.md` and deterministic `checks.json` (no LLM-as-judge).

So far the comparison is a single data point: `docs-tree-sync`, 3/3 for both
opencode (18.8 s, 18372 tokens in / 3886 out) and OpenHands (tie — the task
is too simple to discriminate). The harder tasks should discriminate better,
but nobody re-runs the suite regularly and the results live in scattered
JSON files, so trends are invisible.

## Goal

Make eval results visible over time, so we can compare agents/models and
spot regressions, without digging through result JSONs. This is v1 of the
factory's measurement loop. (Langfuse / observability of real runs is a
separate, later task.)

## What to build

### 1. An append-only history log

- File: `eval/results/history.jsonl` (one JSON object per line, one per eval run).
- Each entry records: `ts` (ISO timestamp), `agent` (`opencode` or
  `openhands`), `model` (e.g. `ollama/glm-5.3-flash:cloud`), `task`, `score`
  (`passed`/`total`), `checks` (per-check pass/fail, as in the harness
  result), `tokens_in`, `tokens_out` (null when unknown, e.g. a manual
  OpenHands run), `duration_s` (null when unknown), `source` (the harness
  result file for opencode, or a short note for OpenHands).
- Appending must be safe to re-run and must never rewrite history
  (append only).
- Seed the log with the two known baseline runs so the summary is not
  empty:
  - opencode, `docs-tree-sync`, 2026-11-25, 3/3, 18372 in / 3886 out, 18.8 s.
  - openhands, `docs-tree-sync`, 2026-11-25, 3/3, tokens/duration unknown
    (note: OpenHands reported 164128 total tokens, 133120 cached; duration
    not measured).

### 2. A summary generator

- Reads `eval/results/history.jsonl` and writes `eval/results/SUMMARY.md`.
- The summary has: a table of all runs (newest first) with date, agent,
  model, task, score, tokens in/out, duration; and a short aggregate per
  (agent, model, task): number of runs, mean score, mean tokens in/out,
  mean duration.
- Regenerate it whenever a run is recorded. Keep it deterministic (same
  input → same output) so diffs are reviewable.

### 3. A single entry point to run + record an opencode eval

- Either a `--record` flag on `eval/run.mjs` or a small wrapper (e.g.
  `eval/measure.mjs`) that runs the harness for the given `--tasks` /
  `--model` and appends the result(s) to the log + regenerates the summary.
- It must reuse the harness's existing runner (do not duplicate the agent
  invocation or the check logic).
- It must be safe to re-run. A run is identified by its timestamp, so
  recording the same run twice is visible as two entries, not silently
  merged.

### 4. A documented way to record a manual OpenHands run

- OpenHands evals cannot be run from the harness (they need Canvas), so
  they are recorded by hand. Provide a small CLI (e.g. `eval/record.mjs`
  or a `--record-manual` mode) that takes `--agent openhands --model …
--task … --score 3/3 [--tokens-in …] [--tokens-out …] [--duration-s …]
[--note …]`, validates the input, appends to the log, and regenerates
  the summary.
- Document it in `eval/README.md` with an example.

### 5. Tests

- Unit tests for: appending to the log (including the seed entries), the
  summary generation (deterministic output, correct aggregates, handles
  missing tokens/duration), and the manual-record CLI (valid + invalid
  input).
- Put them in `test/eval/` following the existing layout. Run with
  `node --test`. No new dependencies.
- Do not add a test that runs a real agent (the harness tests already
  cover the runner with stubs; keep it that way).

### 6. Docs

- Update `eval/README.md`: how to run a measurement, how to record an
  OpenHands run, where the summary lives, and the log schema.
- Update `TODOs.md` (the measurement item) and `CHANGELOG.md` with a dated
  entry.

## Acceptance criteria

- Running the measurement for one task/model appends exactly one entry to
  `history.jsonl` and regenerates `SUMMARY.md` with that run visible.
- The seeded baselines appear in the summary.
- The existing harness behavior is unchanged: the 5 tasks still run the
  same way, existing tests still pass.
- `bash test/shell/run.sh`, `node --test test/plugins/*.test.js
test/eval/*.test.js test/profiles/*.test.js`, Prettier, markdownlint,
  shellcheck all pass; `git diff --check` clean.

## Out of scope

- Langfuse / observability of real runs (separate task).
- Automating the OpenHands eval (needs the Canvas API/automations; manual
  recording for now).
- A dashboard or web UI (the markdown summary is enough for v1).
- Adding new reference tasks or changing the existing task set.

## Repo conventions

- Plan first, then build. Show diffs before committing. Ship via a dated
  topic branch + PR (`<type>/<slug>-<YYYY-MM-DD>`); pushing/merging master
  is the human's action. Run tests + linter after changes.
- Node ESM, no new dependencies. Keep the harness's no-deps property.
- No comments in code unless asked (existing scripts do carry explanatory
  headers — follow that style).

## Citations

[1] [Eval harness documentation](../eval/README.md) — harness mechanics,
results layout, deterministic checks, reference-task list (source id:
`eval-readme`).

[2] [Eval harness runner](../eval/run.mjs) — task execution and the
one-JSON-per-run result shape (source id: `eval-run`).

[3] [TODOs — Comparaison eval](../TODOs.md) — docs-tree-sync outcome: 3/3
for both opencode (18.8 s) and OpenHands, tie, task too simple to
discriminate (source id: `dotfiles-todos`).

The token figures quoted above (18372 in / 3886 out for opencode; 164128
total / 133120 cached for OpenHands) come from the 2026-11-25 eval
sessions; no committed in-repo artifact records them, so treat them as
reported by those sessions.
