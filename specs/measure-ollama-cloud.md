---
type: Spec
title: Measurement — Ollama Cloud API key (GLM in CI)
description: Wire the OLLAMA_API_KEY GitHub secret into the scheduled measurement so ollama/<model>:cloud models (GLM 5.3 Flash) resolve via the Ollama Cloud API with no local gateway.
tags:
  - eval
  - measurement
  - github-actions
  - ollama
  - ci
timestamp: 2026-11-26T15:08:45-05:00
generated:
  at: 2026-11-26T15:08:45-05:00
  by: human:mlhamel
status: draft
sources:
  - id: eval-run
    resource: ../eval/run.mjs
    title: Eval harness runner + evalConfig
    last_modified: 2026-11-26T15:05:43-05:00
  - id: eval-readme
    resource: ../eval/README.md
    title: Eval harness documentation
    last_modified: 2026-11-26T15:05:43-05:00
  - id: ci-measure
    resource: ../.github/workflows/measure.yml
    title: Scheduled measurement workflow
    last_modified: 2026-11-26T15:05:43-05:00
  - id: spec-measure-gh
    resource: measure-github-actions.md
    title: Measurement via GitHub Actions spec
    last_modified: 2026-11-26T15:05:43-05:00
  - id: spec-measure-v1
    resource: measure-eval-v1.md
    title: Measurement v1 spec
    last_modified: 2026-11-26T15:05:43-05:00
---

# Spec: Measurement — Ollama Cloud API key (GLM in CI)

This is the prompt for the agent that implements this feature. Read it,
plan first, then build. Ship via a dated topic branch + PR; pushing/merging
master is the human's action.

## Context

The scheduled measurement workflow (`.github/workflows/measure.yml`,
merged as PR #30) runs `node eval/measure.mjs --model "$EVAL_MODEL"`
weekly, with the model from the `EVAL_MODEL` repository variable
(default `opencode/big-pickle`). The repository now has an
`OLLAMA_API_KEY` secret (Ollama Cloud API key) and `EVAL_MODEL` is set
to `ollama/glm-5.3-flash:cloud`, so the scheduled runs should use the
same GLM model as the local runs — directly comparable results.

That does not work yet, for two reasons:

1. The workflow does not pass the secret to the Measure step, so
   `OLLAMA_API_KEY` is not in the environment when the harness runs.
2. The harness (`eval/run.mjs`, `evalConfig`) pins the Ollama provider
   with no `baseURL`, so it defaults to the local gateway
   (`http://localhost:11434`), which does not exist in a GitHub
   runner. A `ollama/<model>:cloud` model cannot resolve there.

The harness writes the eval config to `opencode.json` inside the
scratch workdir (`runTask` in `eval/run.mjs`), and opencode reads it
from there. The provider is `@ai-sdk/openai-compatible`, which speaks
the OpenAI-compatible API — the cloud equivalent of the local
`http://localhost:11434/v1` is `https://ollama.com/v1`.

## Goal

Make the scheduled measurement use the Ollama Cloud API (with the
`OLLAMA_API_KEY` secret) when the key is present, so
`ollama/<model>:cloud` models resolve with no local gateway, while
keeping the existing behavior (local gateway, no key) unchanged when
the key is absent.

## What to build

### 1. Workflow: pass the secret to the Measure step

- In `.github/workflows/measure.yml`, add `OLLAMA_API_KEY` to the
  environment of the Measure step, from the secret:
  `OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}`.
- Pass it unconditionally (an empty value when the secret is not set
  is harmless — the harness treats an absent/empty key as "no cloud",
  see §2). Do not echo the key, do not log it, do not write it to a
  file in the workflow.
- Note: the GitHub API refuses `.github/workflows/` files (403), so
  this file must be committed via a real git clone — which is the
  case here (the agent works in a local clone). Flag it if the push
  path ever changes.

### 2. Harness: use the cloud endpoint when the key is present

- In `eval/run.mjs` (`evalConfig`), when `OLLAMA_API_KEY` is set in
  the environment (non-empty), configure the Ollama provider to use
  the cloud endpoint: set `providers.ollama.options.baseURL` to
  `https://ollama.com/v1`.
- When the key is absent/empty, keep the current behavior exactly
  (no `baseURL`, local gateway default). Local runs must be
  unaffected.
- The API key must NEVER be written to disk: not in the generated
  `opencode.json`, not in logs, not in the history. It must reach the
  provider via the environment (or via opencode's `{env:...}`
  reference in the generated config), so it only exists in the
  subprocess environment. Verify how the `@ai-sdk/openai-compatible`
  provider obtains its key (env var vs. config option) and use the
  path that does not persist the key to a file; if the provider only
  accepts the key via a config option, use opencode's `{env:...}`
  reference rather than the literal key.
- Keep the pinned `providers.ollama.models` list as-is (the cloud
  models are the same names). Only the endpoint/key wiring changes.

### 3. Tests / validation

- Add unit tests (in `test/eval/`, `node --test`, no new
  dependencies) for: `evalConfig` with the key set (cloud baseURL
  present, key not in the generated config object), and with the key
  absent (no baseURL, behavior unchanged).
- Prove it end to end with a dry run: with `OLLAMA_API_KEY` set (a
  real key, in a scratch HOME, no local gateway running), run
  `node eval/measure.mjs --tasks docs-tree-sync --model
ollama/glm-5.3-flash:cloud` and confirm it records a run in the
  history and regenerates the summary. This is the key validation —
  it proves the cloud path works without a gateway. Use a scratch
  results dir (`--results-dir` + `--history`) so the dry run does not
  touch the real history.
- Prove the no-key path is unchanged: the same dry run without the
  key against the local gateway still works as before.
- Existing suites still pass: `node --test test/plugins/*.test.js`,
  `node --test test/eval/*.test.js`, `node --test test/profiles/*.test.js`,
  `bash test/shell/run.sh`. Prettier, markdownlint, shellcheck clean;
  `git diff --check` clean.
- Do not add a test that runs a real agent in CI (the harness tests
  already cover the runner with stubs). The dry run above is a manual
  validation, not a CI test.

### 4. Docs

- Update `eval/README.md`: how the cloud path works (key via
  `OLLAMA_API_KEY`, cloud endpoint, when it applies), that the key is
  never written to disk, and how to switch back to the local gateway
  (unset the key).
- Update `TODOs.md` (the measurement item) and `CHANGELOG.md` with a dated
  entry.
- Add the new spec to the index in `specs/README.md`.

## Acceptance criteria

- The workflow passes `OLLAMA_API_KEY` to the Measure step (from the
  secret, unconditionally).
- With the key set, the harness configures the Ollama provider for
  the cloud endpoint and a GLM eval records successfully with no
  local gateway running; the key appears nowhere on disk (config,
  logs, history).
- Without the key, the harness behavior is unchanged (local gateway,
  same config shape); existing tests still pass.
- The workflow file is valid YAML and follows the repo's CI
  conventions.

## Out of scope

- Changing the scheduled model default (stays `opencode/big-pickle`
  unless `EVAL_MODEL` says otherwise) or the schedule.
- Hosting Langfuse / observability of real runs.
- Running the evals on push/PR.
- Adding new reference tasks or changing the existing task set.

## Repo conventions

- Plan first, then build. Show diffs before committing. Ship via a dated
  topic branch + PR (`<type>/<slug>-<YYYY-MM-DD>`); pushing/merging master
  is the human's action. Run tests + linter after changes.
- Node ESM, no new dependencies. Keep the harness's no-deps property.
- No comments in code unless asked (existing scripts do carry explanatory
  headers — follow that style).
