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
- [ ] **P2 · Install opencode itself** — the bootstrap assumes `opencode` is
      already installed; add detection + install (curl script or package
      manager) so `setup.sh` works from a truly bare machine.
- [ ] **P2 · Aptfile `--check` in CI** — `apt/generate.sh --check` and
      `prek run --all-files` as a GitHub Actions workflow on push, so drift
      and lint failures surface without a local commit.
- [ ] **P3 · Test `install.sh` idempotency** — run the opencode deploy twice in a
      row on a scratch HOME and confirm the symlink path is stable.

## apt section

- [ ] **P2 · Third-party sources bootstrap** — `docker-ce`, `google-chrome-stable`,
      `brave-browser`, `code`, `spotify-client`, etc. only resolve if their
      vendor repos are configured. Either document the required source setup
      per package or add a `sources.sh` that configures the common ones
      (keyring + `sources.list.d` entries, no secrets).
- [ ] **P2 · Aptfile review pass** — the 242-package list is a first dump; review
      for things that shouldn't be managed (firmware, `task-*` meta-packages)
      and things that should be in `exclude.txt`.
- [ ] **P3 · Flatpak/\_snap inventory** — several desktop apps ship via
      flatpak/snap, not apt; decide whether to version those too
      (`flatpak list --app`, `snap list`) or leave them manual.

## opencode toolkit

- [ ] **P2 · Session-handoff vault path** — `commands/session-handoff.md`
      hardcodes the Obsidian vault path on this machine; parameterize or
      detect the vault root (the session-logger plugin already has a
      `vaultRoot()` finder that could be reused).
- [ ] **P2 · Skill for dotfiles itself** — a `skills/dotfiles/SKILL.md` playbook:
      how to regenerate the Aptfile, refresh the Brewfile, bump hook revs —
      so an agent session can maintain this repo without re-deriving the
      flow.
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
