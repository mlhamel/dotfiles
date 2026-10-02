# dotfiles — TODOs

Ideas and deferred work for this repo. Anything landed gets checked off or
deleted, not left to rot.

Priorities: **P1** do soon · **P2** do eventually · **P3** nice to have.

## Setup / portability

- [x] **P1 · Unified bootstrap script** — `setup.sh` at the repo root chains
      opencode binary install (official curl script) → symlink deploy
      (`opencode/install.sh`) → Director (`opencode/setup-director.sh`) →
      apt packages (`apt/install.sh`), with per-step SKIP\_\* env overrides.
- [x] **P1 · Secrets audit** — done 2026-10-01: swept all 21 commits in both
      histories for key/token/password patterns (content, deleted files,
      filenames). Clean — no secrets rode along.
- [x] **P2 · Install opencode itself** — covered by `setup.sh` (P1 bootstrap,
      step 1): detects an existing binary, otherwise installs via the
      official curl script; SKIP_OPENCODE=1 opt-out.
- [x] **P2 · Aptfile `--check` in CI** — `.github/workflows/lint.yml` runs
      `prek run --all-files` on push/PR via `j178/prek-action`. The Aptfile
      drift check is deliberately local-only (it diffs against the machine's
      package set — always-fail on a runner); documented in the workflow
      and apt/README.md.
- [ ] **P3 · Test `install.sh` idempotency** — run the opencode deploy twice in a
      row on a scratch HOME and confirm the symlink path is stable.

## apt section

- [x] **P2 · Third-party sources bootstrap** — `apt/sources.sh` configures
      the 7 vendor repos in the Aptfile (docker, chrome, brave, code,
      spotify, gh, gcloud); deb822 format, idempotent guards, --dry-run,
      keyrings fetched at runtime.
- [x] **P2 · Aptfile review pass** — generate.sh now also filters dpkg
      essential packages and runtime lib\* deps (keeps lib\*-dev);
      exclude.txt curated with firmware/bootloader/task-\*/GPU entries;
      242 → 114 packages.
- [ ] **P3 · Flatpak/\_snap inventory** — several desktop apps ship via
      flatpak/snap, not apt; decide whether to version those too
      (`flatpak list --app`, `snap list`) or leave them manual.

## opencode toolkit

- [x] **P2 · Session-handoff vault path** — `/session-handoff` and the
      session-logger plugin now resolve the vault from `OBSIDIAN_VAULT`
      (default `~/Dropbox/obsidian/general`) instead of a hardcoded
      absolute path; documented in the command, AGENTS.md, and README.
- [x] **P2 · Skill for dotfiles itself** — `skills/dotfiles/SKILL.md`:
      repo map, change flow (prek → commit → changelog → TODO checkoff),
      Aptfile/Brewfile regeneration, hook-rev bumps, CI notes, conventions.
- [ ] **P3 · More cross-model agents** — the `review` pattern (different model
      family for independent opinion) could extend to a `security` auditor
      agent or an `architecture` second-opinion agent.
- [ ] **P3 · Reviewer verdict enforcement** — have the build agent automatically
      run `@review` after substantive changes, or surface the verdict in
      the commit flow, instead of relying on remembering to ask.

## Housekeeping

- [ ] **P3 · Brewfile refresh** — `homebrew/Brewfile` predates the apt work; run
      `rake homebrew:update` on the Mac next time to sync it with reality.
- [ ] **P3 · Gemfile relevance** — now that prek replaced the rake-driven dev
      flow for linting, decide whether the Rakefile/Gemfile still earn
      their keep or should be folded into a plain script.
