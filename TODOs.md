# dotfiles — TODOs

Ideas and deferred work for this repo. Anything landed gets checked off or
deleted, not left to rot.

## Setup / portability

- [ ] **Unified bootstrap script** — a single `setup.sh` at the repo root that
      chains: symlink deploy (`opencode/install.sh`) → Director
      (`opencode/setup-director.sh`) → apt packages on Debian/Ubuntu
      (`apt/install.sh`) or a pointer to the Homebrew flow on macOS. One
      command, fresh machine to working.
- [ ] **Install opencode itself** — the bootstrap assumes `opencode` is
      already installed; add detection + install (curl script or package
      manager) so `setup.sh` works from a truly bare machine.
- [ ] **Aptfile `--check` in CI** — `apt/generate.sh --check` and
      `prek run --all-files` as a GitHub Actions workflow on push, so drift
      and lint failures surface without a local commit.
- [ ] **Test `install.sh` idempotency** — run the opencode deploy twice in a
      row on a scratch HOME and confirm the symlink path is stable.

## apt section

- [ ] **Third-party sources bootstrap** — `docker-ce`, `google-chrome-stable`,
      `brave-browser`, `code`, `spotify-client`, etc. only resolve if their
      vendor repos are configured. Either document the required source setup
      per package or add a `sources.sh` that configures the common ones
      (keyring + `sources.list.d` entries, no secrets).
- [ ] **Aptfile review pass** — the 242-package list is a first dump; review
      for things that shouldn't be managed (firmware, `task-*` meta-packages)
      and things that should be in `exclude.txt`.
- [ ] **Flatpak/\_snap inventory** — several desktop apps ship via
      flatpak/snap, not apt; decide whether to version those too
      (`flatpak list --app`, `snap list`) or leave them manual.

## opencode toolkit

- [ ] **More cross-model agents** — the `review` pattern (different model
      family for independent opinion) could extend to a `security` auditor
      agent or an `architecture` second-opinion agent.
- [ ] **Reviewer verdict enforcement** — have the build agent automatically
      run `@review` after substantive changes, or surface the verdict in
      the commit flow, instead of relying on remembering to ask.
- [ ] **Session-handoff vault path** — `commands/session-handoff.md`
      hardcodes the Obsidian vault path on this machine; parameterize or
      detect the vault root (the session-logger plugin already has a
      `vaultRoot()` finder that could be reused).
- [ ] **Skill for dotfiles itself** — a `skills/dotfiles/SKILL.md` playbook:
      how to regenerate the Aptfile, refresh the Brewfile, bump hook revs —
      so an agent session can maintain this repo without re-deriving the
      flow.

## Housekeeping

- [ ] **Brewfile refresh** — `homebrew/Brewfile` predates the apt work; run
      `rake homebrew:update` on the Mac next time to sync it with reality.
- [ ] **Gemfile relevance** — now that prek replaced the rake-driven dev
      flow for linting, decide whether the Rakefile/Gemfile still earn
      their keep or should be folded into a plain script.
- [ ] **Secrets audit** — one-time sweep (gitleaks or manual grep) across
      history to confirm nothing sensitive rode along in the merged
      histories.
