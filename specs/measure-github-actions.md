---
type: Spec
title: Measurement — GitHub Actions scheduled evals
description: Run the eval measurement on a schedule in GitHub Actions (Zen free model, no Ollama gateway) and commit the history + summary back to the repo.
tags:
  - eval
  - measurement
  - github-actions
  - ci
timestamp: 2026-11-26T12:33:17-05:00
generated:
  at: 2026-11-26T12:33:17-05:00
  by: human:mlhamel
status: draft
sources:
  - id: eval-readme
    resource: ../eval/README.md
    title: Eval harness documentation
    last_modified: 2026-11-26T11:58:22-05:00
  - id: eval-measure
    resource: ../eval/measure.mjs
    title: Measure CLI (run + record)
    last_modified: 2026-11-26T11:58:22-05:00
  - id: eval-run
    resource: ../eval/run.mjs
    title: Eval harness runner + evalConfig
    last_modified: 2026-11-26T08:11:12-05:00
  - id: ci-lint
    resource: ../.github/workflows/lint.yml
    title: Existing CI workflow (conventions)
    last_modified: 2026-11-24T22:04:56-05:00
  - id: spec-measure-v1
    resource: measure-eval-v1.md
    title: Measurement v1 spec (what this builds on)
    last_modified: 2026-11-26T11:42:03-05:00
---

# Spec: Measurement — GitHub Actions scheduled evals

This is the prompt for the agent that implements this feature. Read it,
plan first, then build. Ship via a dated topic branch + PR; pushing/merging
master is the human's action.

## Context

Measurement v1 (merged, PR #25) records eval runs in an append-only log
(`eval/results/history.jsonl`) and renders a trend summary
(`eval/results/SUMMARY.md`). The entry point is `node eval/measure.mjs`
(same flags as `eval/run.mjs`: `--tasks`, `--model`, `--timeout`, `--bin`,
`--keep`, `--keep-transcripts`, `--tasks-dir`, `--results-dir`, `--history`;
env `EVAL_MODEL`, `EVAL_RESULTS_DIR`, `EVAL_HISTORY`). A hand-run is
recorded with `node eval/record.mjs --agent … --model … --task … --score …`.

Right now the log only grows when a human runs the measurement locally
against the Ollama gateway (`ollama/glm-5.3-flash:cloud`). The goal is to
make the log fill itself on a schedule, from a runner that is always on,
so the trend is visible without anyone launching anything.

The repo already has CI in `.github/workflows/lint.yml` (jobs `prek` and
`test`, `runs-on: ubuntu-latest`, Node 24, pinned actions). This work adds
a second workflow file; it does not modify `lint.yml`.

## Goal

Run the eval measurement on a schedule in GitHub Actions and commit the
updated `history.jsonl` + `SUMMARY.md` (and any new per-run result files)
back to the repo, so the trend log grows by itself. No secrets, no cost:
the repo is public (GitHub Actions is free) and the model is opencode's
built-in Zen free model.

## What to build

### 1. The workflow file

- New file `.github/workflows/measure.yml`. Do not modify `lint.yml`.
- Triggers: `schedule` (cron, weekly — Mondays 06:00 UTC) and
  `workflow_dispatch` (manual run). No `push` / `pull_request` trigger:
  evals are slow and spend model calls, they run on a schedule, not on
  every change.
- `permissions`: `contents: write` (to commit the results back) at the
  workflow or job level, nothing broader.
- `concurrency`: a group (e.g. `measure`) so two runs never overlap;
  do not cancel a run that is already in progress.
- `timeout-minutes` on the job: generous (e.g. 60), so a hung eval does
  not run forever.
- Follow the existing CI conventions: `runs-on: ubuntu-latest`, Node 24
  via `actions/setup-node` (pinned by commit SHA, as in `lint.yml`),
  `actions/checkout` pinned by commit SHA.

### 2. The model (the one real constraint)

- A GitHub runner has no Ollama gateway, so the workflow cannot use
  `ollama/glm-5.3-flash:cloud`. It runs with `opencode/big-pickle`
  (opencode's built-in Zen free model, no key, no secret).
- Pass the model explicitly: `node eval/measure.mjs --model
opencode/big-pickle`. Do not rely on the default (which is the Ollama
  gateway model from `opencode/opencode.json`).
- Make the model overridable without editing the file: a
  `workflow_dispatch` input (e.g. `model`, default `opencode/big-pickle`)
  that the run step uses. Document how to switch to a cloud model via a
  GitHub secret later (do not add a secret now).
- The harness's `evalConfig` pins a `providers.ollama` block (the 9
  gateway models). Verify that the harness runs cleanly with the Zen
  model in an environment with no Ollama gateway. If the pinned Ollama
  provider block breaks the Zen run, adjust the harness so the Ollama
  provider block is only included for `ollama/` models (and add a test
  for it). Do not assume it works — prove it with the dry run in §5.

### 3. The run

- Install opencode in the runner with the official install script
  (`curl -fsSL https://opencode.ai/install | bash`). Make sure the
  installed binary is on PATH for the measure step — the install script
  adds it to `.bashrc`, which a non-interactive runner shell may not
  source, so add the bin dir to PATH explicitly (e.g. via `$GITHUB_PATH`)
  or pass `--bin` with the full path. Record the installed version in
  the job log (e.g. `opencode --version`); the harness already records
  the opencode version in each result file.
- Run the full suite by default: `node eval/measure.mjs --model
opencode/big-pickle` (all 5 tasks). A failure is data, not a reason
  to skip the recording — `measure.mjs` appends failed runs to the log
  too, and the workflow must still commit the results even if some
  tasks fail. The job may be marked failed when tasks fail, but the
  commit-back step must run anyway (use `if: always()` on that step).
- Do not pass `--keep-transcripts` (transcripts are gitignored and
  would bloat the runner).

### 4. Commit the results back

- After the run, commit everything that changed under `eval/results/`
  (the appended `history.jsonl`, the regenerated `SUMMARY.md`, and any
  new `<date>-<model-slug>.json` result files). Respect the existing
  `.gitignore` (transcripts stay out).
- Commit only if there are changes (no empty commits).
- Use the github-actions bot identity and a clear message, e.g.
  `chore(eval): record scheduled measurement <date>`.
- Push with the built-in `GITHUB_TOKEN` (no extra secret). Note: a push
  made with `GITHUB_TOKEN` does not re-trigger workflows, so this
  commit will not start another `lint` or `measure` run.
- Push to the same branch the workflow ran on (master, for scheduled
  runs).

### 5. Tests / validation

- Validate the workflow YAML (syntax) and that the job definition
  matches the repo's CI conventions (pinned actions, Node 24,
  minimal permissions).
- Prove the harness works with the Zen model and no gateway: run
  `node eval/measure.mjs --tasks docs-tree-sync --model
opencode/big-pickle` in a clean environment (a scratch HOME, no
  Ollama running, no gateway reachable) and confirm it records a run
  in the history and regenerates the summary. This is the key
  validation — if it fails, fix the harness config (§2) rather than
  working around it in the workflow.
- Existing suites still pass: `node --test test/plugins/*.test.js`,
  `node --test test/eval/*.test.js`, `node --test test/profiles/*.test.js`,
  `bash test/shell/run.sh`. Prettier, markdownlint, shellcheck clean;
  `git diff --check` clean.
- Do not add a test that runs a real agent in CI (the harness tests
  already cover the runner with stubs).

### 6. Docs

- Update `eval/README.md`: how the scheduled measurement works (schedule,
  model, manual trigger, how to change the model), and that the log now
  also grows from GitHub Actions.
- Update `TODOs.md` (the measurement item) and `CHANGELOG.md` with a dated
  entry.
- Add the new spec to the index in `specs/README.md`.

## Acceptance criteria

- The workflow file exists, is valid YAML, and follows the repo's CI
  conventions (pinned actions, Node 24, minimal permissions, schedule +
  manual trigger only).
- A dry run proves the harness records a Zen-model eval with no Ollama
  gateway (clean HOME, no gateway reachable), and the summary shows it.
- The commit-back step commits `history.jsonl` + `SUMMARY.md` (+ any new
  result files) only when they changed, with the bot identity and a
  clear message, and the job still commits even if some tasks fail.
- The existing harness behavior is unchanged for local runs (same flags,
  same log schema, same summary format); existing tests still pass.

## Out of scope

- Hosting Langfuse / observability of real runs (separate task; GitHub
  Actions is a runner, not a home for a long-lived service).
- A cloud model via a GitHub secret (document the option, do not add one).
- Running the evals on push/PR (schedule + manual only).
- Adding new reference tasks or changing the existing task set.
- Changing `lint.yml`.

## Repo conventions

- Plan first, then build. Show diffs before committing. Ship via a dated
  topic branch + PR (`<type>/<slug>-<YYYY-MM-DD>`); pushing/merging master
  is the human's action. Run tests + linter after changes.
- Node ESM, no new dependencies. Keep the harness's no-deps property.
- No comments in code unless asked (existing scripts do carry explanatory
  headers — follow that style).
- Note: the GitHub API refuses `.github/workflows/` files (403), so a
  workflow file must be committed via a real git clone — which is the
  case here (the agent works in a local clone). Flag it if the push
  path ever changes.
