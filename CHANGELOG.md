# Changelog

All notable changes to this repo. Dates are YYYY-MM-DD (local commit date);
entries reference the committing hash. Newest first. When adding an entry,
use today's date and the hash of the change once committed.

## 2026-10-02

- `(this)` — Complete all six P2 TODOs: CI lint workflow (j178/prek-action); apt/sources.sh vendor repo bootstrap (7 repos, deb822, idempotent, --dry-run); Aptfile curation 242→114 (dpkg-essential + runtime-lib\* filters, curated exclude.txt); OBSIDIAN_VAULT parameterization for /session-handoff + session-logger plugin; skills/dotfiles maintenance playbook; "install opencode" verified covered by setup.sh
- `e0329a7` — Pin changelog hash for ollama provider entry
- `59949b5` — Define the ollama provider in global opencode.json (baseURL + curated cloud models); plain `opencode` now starts on glm-5.3:cloud without `ollama launch`

## 2026-10-01

- `4bff9a7` — Add `setup.sh` unified bootstrap (opencode binary → config symlink → Director → apt packages, per-step SKIP\_\* overrides); complete full-history secrets audit (clean); check off both P1 TODOs
- `f889e09` — Add `CHANGELOG.md`: dated log of notable changes, backfilled from git history
- `f8fe827` — Add `TODOs.md`: deferred setup, apt, toolkit, and housekeeping work
- `3021d36` — Add `apt/` section: Aptfile (242 pkgs) + `generate.sh`/`install.sh` for Debian/Ubuntu
- `6f249d8` — Add prek/pre-commit linting: markdownlint, shellcheck, prettier, hygiene hooks
- `54368b7` — Add `opencode/setup-director.sh`: idempotent Director install + opencode wiring
- `32b7a48` — Add `homebrew/README.md`: macOS-only scope, fresh-Mac setup instructions
- `142b0f5` — Remove obsolete Ruby 2.3.3 pin from Gemfile
- `efed976` — Address documentation review: fix rake instructions, document prerequisites, unify deploy paths
- `feb661a` — Document custom agents (`ask`, cross-model `review`) in READMEs
- `10bad28` — Add cross-model review agent (Gemma via ollama); rename `agent/` → `agents/`
- `def1fff` — Document repo layout and deploy instructions in README
- `cdf69d7` — Add `Ask` agent (read-only Q&A primary agent)
- `0244f37` — Merge Homebrew dotfiles with opencode toolkit (unrelated histories)
- `9e1f962` — Add portable opencode toolkit: rules, commands, skills, plugins

## 2022-10-28

- `5169160` — Update deps.

## 2017-07-16

- `b7da91e` — Adds ways of updating dependencies
- `7ee7acf` — Adds basic Rakefile for restoring installed package

## 2017-07-14

- `8039580` — Removes sub git
- `cac0ad1` — Adds more stuff and organize things by applications

## 2017-07-13

- `2065225` — Adds atom packages

## 2016-10-04

- `f6c6bec` — Adds fish configuration
