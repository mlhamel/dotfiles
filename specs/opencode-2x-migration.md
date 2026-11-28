---
type: Spec
title: Migrate everything to opencode 2.x with centrally pinned versions and Dependabot
description: Move the OpenHands container agent from opencode 1.19.6 to the latest 2.x, centralize every version pin in one file, and wire Dependabot plus a drift check so pins stay current.
tags:
  - opencode
  - openhands
  - versions
  - dependabot
  - docker
timestamp: 2026-11-28T08:17:00-05:00
generated:
  at: 2026-11-28T08:17:00-05:00
  by: human:mlhamel
status: draft
sources:
  - id: setup-script
    resource: ../setup.sh
    title: Host bootstrap script (OPENCODE_VERSION pin)
    last_modified: 2026-11-28T08:15:46-05:00
  - id: setup-director
    resource: ../opencode/setup-director.sh
    title: Director install script (DIRECTOR_VERSION pin)
    last_modified: 2026-11-28T08:15:46-05:00
  - id: openhands-script
    resource: ../openhands/openhands.sh
    title: Automated OpenHands setup script (Canvas image pin, V1 installer, v1 config)
    last_modified: 2026-11-28T08:15:46-05:00
  - id: measure-workflow
    resource: ../.github/workflows/measure.yml
    title: Scheduled measurement workflow (opencode pin)
    last_modified: 2026-11-28T08:15:46-05:00
---

# Spec: Migrate everything to opencode 2.x with centrally pinned versions and Dependabot

This is the prompt for the agent that implements this feature. Read it,
plan first, then build. Ship via a dated topic branch + PR; pushing/merging
master is the human's action.

## Context

The factory runs opencode 2.x on the host (pinned 2.3.0, binary 2.4.1)
but the OpenHands container still runs opencode 1.19.6. That is not a
deliberate choice: `openhands.sh` (`ensure_opencode`) runs
`https://opencode.ai/install`, and that installer is v1-only — it
refuses 2.x outright and points at `https://opencode.ai/v2/install`
for 2.x. It installs the latest 1.x, which is 1.19.6. The embedded
container config (`write_config` in `openhands.sh`) is therefore still
in the v1 schema, with a comment saying it must move to the v2 schema
if the binary ever goes 2.x. That moment is now.

Versions are also pinned in several places at once, and they have
already drifted: opencode 2.3.0 (host pin) vs 1.19.6 (container) vs
2.4.1 (host binary); Agent Canvas 1.43.0 (pinned in `openhands.sh`)
vs 1.46.0 (latest). There is no `.github/dependabot.yml`.

Latest versions verified 2026-11-28 (re-check at implementation time,
they move fast):

- opencode 2.x latest: **2.4.2** (npm `@opencode/cli`, latest tag).
  The human's guess (2.4.1) was one patch behind.
- Director latest: **v1.23.0** (still latest on
  `colinsurprenant/director` releases). The pin is current.
- Agent Canvas latest: **1.46.0** (npm `@openhands/agent-canvas`,
  latest tag). The pinned 1.43.0 is three releases behind.

## Goal

After this lands, every opencode in the factory runs 2.x from one
central pin file, the container config is v2 schema, the ACP agent
still runs on GLM via the Ollama gateway, and version drift is caught
automatically (Dependabot where it applies, a drift check for the
rest).

## What to build

### 1. Central versions file (single source of truth)

Create one file at the repo root (suggestion: `versions.env`) holding
every pin:

- `OPENCODE_VERSION` (opencode 2.x, e.g. `2.4.2`)
- `DIRECTOR_VERSION` (e.g. `v1.23.0`)
- `AGENT_CANVAS_VERSION` (e.g. `1.46.0`)

Every consumer reads from it and nowhere else:

- `setup.sh` — `OPENCODE_VERSION` (replaces its hardcoded `2.3.0`
  default; the `OPENCODE_VERSION=x.y.z` override stays).
- `opencode/setup-director.sh` — `DIRECTOR_VERSION` (replaces its
  hardcoded `v1.23.0` default; the override stays).
- `openhands/openhands.sh` — `AGENT_CANVAS_VERSION` for the image tag
  and `OPENCODE_VERSION` for the container binary.
- `.github/workflows/measure.yml` — the `--version` flag (replaces its
  hardcoded `2.3.0`; read the file in a step or pass it via env, do
  not duplicate the number).
- A grep for the pinned numbers must find no hardcoded copy outside
  the central file (test fixtures that stub versions are fixtures, not
  pins — update them to match or mark them explicitly).

The file must be sourceable by bash (`KEY=value` lines, no exports
required) and simple enough to read at a glance. Document it in the
repo (README or a short header comment in the file itself).

### 2. Container opencode 1.19.6 → 2.x

In `openhands/openhands.sh`:

- `ensure_opencode`: switch to the V2 installer
  (`https://opencode.ai/v2/install | bash -s -- --version
"$OPENCODE_VERSION"`), the same call shape `setup.sh` and
  `measure.yml` already use.
- The existing binary is sticky: `ensure_opencode` keeps any
  executable binary it finds, and the 1.19.6 binary is persisted in
  the bind-mounted opencode dir. The migration must replace it, not
  keep it — detect a 1.x binary (e.g. `opencode --version` starts
  with `1.`) and reinstall, or remove it and let the install step run.
  A stale 1.19.6 after this change is a failure, not a fallback.
- `write_config`: rewrite the embedded config to the v2 schema
  (`providers` / `package` / `settings`), mirroring the repo's own
  `opencode/opencode.json` v2 shape (`package:
"aisdk:@ai-sdk/openai-compatible"`, `settings: { baseURL:
"http://host.docker.internal:11434/v1" }`). Keep the same model
  list and the 64k limits. Verify against the 2.4.2 binary whether
  2.x still requires BOTH `limit.context` AND `limit.output` on every
  model (1.19.6 required both and exited before the ACP handshake
  without `output`); check with `opencode debug config` or a live ACP
  handshake, and record the finding in the code comment that
  currently documents the 1.19.6 requirement.
- Bump the Canvas image pin to the latest verified at implementation
  time (1.46.0 as of 2026-11-28).

Director compatibility is already established on the host (opencode
2.3.0 + Director v1.23.0 run together), but the implementation must
still verify Director against 2.4.2 (install/doctor flow plus the
opencode wiring, `director install --opencode`) and report the result.

### 3. Dependabot

Add `.github/dependabot.yml`:

- `github-actions`: update the SHA-pinned actions in the workflows
  (the repo already pins actions by SHA; Dependabot keeps them
  current).
- `docker`: include it if any Dockerfile exists by then; otherwise
  note it as not applicable.

Be explicit in the repo docs about what Dependabot does NOT cover:
it cannot update version strings inside shell scripts. That is what
the central file plus the drift check below are for. Do not pretend
Dependabot covers the shell pins.

### 4. Drift check (for the pins Dependabot cannot see)

Add a CI check (a workflow, or a step in an existing one) that
compares the central pins against upstream latest and reports when
behind:

- opencode: npm `@opencode/cli` latest.
- Director: latest release tag on `colinsurprenant/director`.
- Agent Canvas: npm `@openhands/agent-canvas` latest (the Docker
  image tag tracks the npm version).

Failing the check (or opening an issue) on drift is acceptable; the
exact signal is the implementer's choice, but it must be visible
without a human remembering to check. Note in the docs that Renovate
with `regexManagers` is the alternative that would update the central
file directly — flag it to the human rather than switching silently.

### 5. Docs

- `openhands/README.md`: the container now runs opencode 2.x via the
  V2 installer; the v1-schema note is gone.
- `TODOs.md`: record the migration (and the new pin state) in the
  OpenHands section.
- `CHANGELOG.md`: dated entry with the new versions.

### 6. Tests

- Shell harness cases (`test/shell/run.sh`, the `openhands` cases):
  a 1.x binary present is replaced by the 2.x install (V2 installer
  invoked with the central pin); the generated container config is v2
  schema (`package` + `settings`, no `provider`/`npm`/`options`
  keys); the image tag comes from the central file.
- Node suites and shell harness green; prettier + markdownlint clean;
  `git diff --check` clean.
- The live end-to-end check (`openhands.sh down && up` on the
  human's machine, ACP agent on GLM via the gateway, one real task)
  is a human verification step — the implementing agent has no docker
  daemon, so it verifies with mocks/stubs and documents the manual
  check.

## Acceptance criteria

- The container binary reports a 2.x version (2.4.2, or the latest
  verified at merge time); no 1.19.6 remains anywhere in the factory
  path.
- `openhands.sh up` works end-to-end with the v2 config (human live
  verification); the ACP agent runs on GLM 5.3 Flash via the Ollama
  gateway as before.
- Every version pin lives in the central file; a grep for the pinned
  numbers finds no hardcoded copy outside it (fixtures excepted and
  marked).
- `.github/dependabot.yml` is present and valid; the drift check
  reports a behind-pin correctly.
- Director works against opencode 2.4.2 (install/doctor + opencode
  wiring verified).
- `oh-fix` and the GitHub App wiring are unchanged in behavior (the
  migration must not regress them).

## Out of scope

- The ACP plan → task_tracker exploration (the human's item 3). It
  starts only after this lands, as a separate exploration.
- Switching to Renovate. Noted as an alternative, not built here.
- Bumping Director (already latest) or any other pin beyond the
  three listed.
- macOS bootstrap validation; branch-protection verification.

## Repo conventions

- Dated topic branch + PR; pushing/merging master is the human's
  action.
- Tests in the existing harnesses (`test/shell/run.sh` for shell,
  `node --test` for node suites); prettier + markdownlint clean.
- Never pass text containing backticks through a double-quoted shell
  command — read texts (including PR descriptions) from files instead.
- After every push via the GitHub API, verify the modes of ALL `.sh`
  files via `git ls-tree` — API pushes do not preserve the executable
  bit and can flip modes of files not even touched.
- Never claim the live end-to-end check passed without the human
  running it on their machine (no docker daemon in the sandbox).
