---
type: Spec
title: OpenHands — GitHub App for push + PR (multi-repo) with secrets management
description: Let the OpenHands ACP agent push branches and open PRs on any repo where a GitHub App is installed, with the app's private key managed as a host file (mode 600) mounted read-only into the container and installation tokens minted on demand.
tags:
  - openhands
  - github-app
  - secrets
  - github
  - docker
timestamp: 2026-11-27T11:10:13-05:00
generated:
  at: 2026-11-27T11:10:13-05:00
  by: human:mlhamel
status: draft
sources:
  - id: openhands-script
    resource: ../openhands/openhands.sh
    title: Automated OpenHands setup script
    last_modified: 2026-11-27T11:09:13-05:00
  - id: openhands-readme
    resource: ../openhands/README.md
    title: OpenHands setup documentation
    last_modified: 2026-11-27T11:09:13-05:00
  - id: threat-model
    resource: ../docs/threat-model.md
    title: Threat model v1
    last_modified: 2026-11-27T11:09:13-05:00
  - id: todos
    resource: ../TODOs.md
    title: Backlog (OpenHands section)
    last_modified: 2026-11-27T11:09:13-05:00
---

# Spec: OpenHands — GitHub App for push + PR (multi-repo) with secrets management

This is the prompt for the agent that implements this feature. Read it,
plan first, then build. Ship via a dated topic branch + PR; pushing/merging
master is the human's action.

## Context

The OpenHands ACP agent works end to end (GLM 5.3 Flash via the Ollama
gateway, commits locally) but cannot push branches or open PRs: the
container holds no GitHub identity. The human currently does the last
mile himself — `oh-fix`, `git push`, `gh pr create` from his laptop,
where `gh` is already authenticated. That manual step is the remaining
friction in the async loop.

The goal is multi-repo: the agent should work on many repos, not just
dotfiles. A per-repo fine-grained PAT does not scale (one token per
repo, or one token with access to all of them, which widens the blast
radius instead of narrowing it). A GitHub App installed per repo does:
it is installed on selected repos only, with narrow permissions, and
hands out short-lived installation tokens (1 hour).

Decision (2026-11-27): GitHub App route, v1 with the private key as a
host file mounted read-only into the container plus on-demand token
minting. A host-side token broker (the key never enters the container)
is the v2 hardening option and is out of scope here.

Security notes (see `docs/threat-model.md`):

- The private key is the long-lived credential. It can mint tokens for
  every repo where the app is installed, so it must never be in the
  repo, never in the container image, never in a log.
- The app gets the minimum permissions: repository `contents: write`
  (push branches) and `pull_requests: write` (open PRs), plus the
  implicit `metadata: read`. Nothing else.
- Branch protection on `master` is a prerequisite: with `master`
  protected (PR required, no direct push), the worst a tricked agent
  can do is push a branch and open a PR, which the human reviews before
  merging. That protection is currently NOT verified — the human must
  verify/enable it in GitHub Settings → Branches → `master` before
  relying on the app.
- Residual risk, stated plainly: with the v1 design the agent _can_
  read the private key inside the container (it is mounted there). A
  prompt-injected agent could theoretically exfiltrate it. What bounds
  it: the key only serves repos where the app is installed, with just
  the two permissions above, and the human can regenerate it in a
  minute (see rotation below).

## Goal

After this lands, the ACP agent can `git push` a branch and open a PR
on any repo where the GitHub App is installed, without the human
pushing. The human still reviews and merges PRs. The private key is
never in the repo, never in the image, never in a log, and installation
tokens are minted on demand and never persisted.

## What to build

### 1. GitHub App definition (human step, documented — not built)

The spec and the README must document the exact steps for the human to
create the app in the GitHub UI (the implementation cannot create it:
the private key is generated in the UI and must never transit through
the agent):

- Create the app under the human's account: Settings → Developer
  settings → GitHub Apps → New GitHub App. Name it something
  recognizable (suggestion: `openhands-agent`).
- Permissions — repository only, minimum: `contents: write`,
  `pull_requests: write` (`metadata: read` is implicit). No
  organization, user, or account permissions. No other repository
  permissions.
- Webhook: inactive (no URL — the app needs no events).
- Generate a private key (PEM) and download it once.
- Install the app on selected repos only (never "all repositories"):
  dotfiles first, then each additional repo the human wants to open to
  the agent.

### 2. Host-side secrets layout

On the human's machine, under `~/.config/openhands/`:

- `github-app.pem` — the private key, mode `600`, owned by the human.
  This is the only secret file. It is never copied anywhere except the
  read-only container mount below.
- `github-app.conf` — not secret: the App ID (e.g.
  `GITHUB_APP_ID=123456`). The App ID is a public identifier, not a
  credential.

Document this layout in `openhands/README.md`, including the rotation
procedure: regenerate the key in the app's GitHub settings (the old key
dies immediately), replace the host file, `openhands.sh restart`.
Revocation: uninstall the app from a repo to cut that repo off
instantly; suspend or delete the app to kill everything.

### 3. Token-minting helper (in the repo, not secret)

A script in the repo (suggestion: `openhands/bin/gh-app-token`) that
mints an installation token on demand:

- Inputs: App ID and private-key path (flags or env vars, e.g.
  `GITHUB_APP_ID` and `GITHUB_APP_KEY_FILE`). It must also resolve the
  installation ID for a repo: list installations (`GET
/app/installations` with the JWT) and match by repository full name,
  or accept an installation ID directly.
- Steps: build a JWT (RS256, `iss` = App ID, `iat` = now, `exp` = now +
  10 minutes), exchange it for an installation token (`POST
/app/installations/{installation_id}/access_tokens`), print the token
  to stdout only.
- The token is never written to a file, never logged. On failure it
  exits non-zero with a clear message (bad key, unknown repo, API
  error) and prints nothing secret.
- Dependencies: use only tools verified present in the container image
  (`ghcr.io/openhands/agent-canvas:1.43.0`) — `openssl` for the JWT
  signature and `curl` for the API calls, or `python3` if it is
  present. Verify first; do not assume.

### 4. Git credential helper (transparent `git push`)

A small script (or a mode of the minting helper) that git invokes as a
credential helper: when git needs auth for `https://github.com`, it
mints a fresh installation token and returns it as the password. This
makes `git push` work transparently for the agent with no token
persisted anywhere.

### 5. `gh` CLI in the container

Verify whether `gh` is present in the container image. If it is, the
agent uses `gh pr create` with `GH_TOKEN` set from the minting helper
(a small wrapper, or the helper's output fed to `gh auth`). If it is
not, install it the way `ensure_opencode` installs opencode (persisted,
one-time cost), or create the PR via the GitHub API with `curl` as a
fallback. Do not assume `gh` is there — check first, then decide, and
record the decision in the README.

### 6. `openhands.sh` integration

- New step in `cmd_up` (suggestion: `ensure_github_app`), after the
  container starts and before or with the config install:
  - If the key file is absent: log a warning that GitHub is not wired
    (the agent cannot push) and continue — the Canvas still works.
    GitHub is an optional capability, not a requirement to start.
  - If the key file is present: fail fast when its mode is not `600`
    (a security misconfiguration, not something to work around), and
    fail fast when the App ID config is missing.
  - Mount the key read-only in `start_container` (`-v
"$KEY_FILE:/home/openhands/.config/github-app.pem:ro"`), only when
    the key exists. Never copy the key into a writable container path.
  - Install the minting helper and the credential helper into the
    container (`docker cp` + `chown`, like `install_config`), and
    configure the git credential helper for the container user.
- `cmd_status` and `show_summary` report the GitHub App state (key
  present/absent, wired or not, App ID when configured).
- The script must never print the key or a token. `set -euo pipefail`
  and the existing `log`/`die` helpers stay.

### 7. Docs

- `openhands/README.md`: the human setup steps (create the app with
  the exact permissions, key file + App ID layout, install on repos,
  rotation/revocation, the branch-protection prerequisite).
- `TODOs.md`: a new item in the "Agent cloud/async — OpenHands"
  section recording this work.
- `CHANGELOG.md`: dated entry.

### 8. Tests

- Unit/shell tests for the minting helper: JWT shape (header,
  payload, RS256 signature verifiable with the public key), token
  exchange against a mocked GitHub API (stub server or `curl` mock),
  failure modes (missing key, bad key, unknown repo, API error) exit
  non-zero with a clear message and no secret in the output.
- Shell harness cases for `openhands.sh` (see `test/shell/run.sh`,
  the `openhands` cases): key absent → warning and the container still
  starts without the mount; key present with mode `644` → `up` fails;
  key present with mode `600` → the `docker run` line carries the
  read-only mount and the helper is copied into the container.
- Prettier 3.1.0 `--check` and markdownlint-cli2 0.23.3 clean on
  changed files; `git diff --check` clean; node suites and shell
  harness green.

## Acceptance criteria

- `openhands.sh up` with no key file: warns about GitHub not being
  wired and starts the container normally (existing behavior
  preserved).
- `openhands.sh up` with a key file at mode `600` and an App ID:
  mounts the key read-only, installs the helper, configures the git
  credential helper; `git push` and PR creation work from inside the
  container. The live end-to-end check (a real app + a real repo) is a
  human verification step on the human's machine — the implementing
  agent cannot create the app or hold the key, so it verifies with
  mocks and documents the manual check.
- The private key never appears in the repo, the image, or any log:
  `grep -r` for the key material (or a canary string) finds nothing in
  the repo, and no tool output in the PR contains it.
- The minting helper mints a token that the mocked GitHub API accepts,
  and the credential helper returns it in the git credential protocol
  format.
- `oh-fix` is unchanged (ownership is a mount problem, not an identity
  problem) and the human still reviews + merges every PR.

## Out of scope

- Host-side token broker (v2 hardening — the key never enters the
  container). Noted as a follow-up, not built here.
- Creating the GitHub App via API. The human creates it in the UI; the
  spec documents the steps.
- Branch protection enforcement. The human verifies/enables it in
  GitHub Settings; the spec lists it as a prerequisite.
- Any GitHub App permission beyond `contents: write` and
  `pull_requests: write` (no issue comments, no checks, no actions).
- Changing the ACP agent's behavior. It already commits; this only adds
  push + PR capability.

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
- The private key and any minted token are never committed, never
  pasted in chat, never put in a PR body, never written to a file in
  the repo. The implementing agent works with mocks and placeholder key
  material only.
