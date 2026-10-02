---
name: dotfiles
description: Maintenance playbook for this dotfiles repo — regenerate the Aptfile, refresh the Brewfile, bump hook revisions, and the lint/commit flow for every change
---

# dotfiles maintenance playbook

The repo lives at `~/src/github.com/mlhamel/dotfiles` (deployed to
`~/.config/opencode` via symlink). Load this skill when working on the repo
itself.

## Repo map

- `opencode/` — opencode config (agents, commands, skills, plugins); `README.md` there documents architecture
- `apt/` — Debian/Ubuntu packages; `homebrew/` — macOS packages
- `setup.sh` — fresh-machine bootstrap; `opencode/setup-director.sh` — Director install
- `TODOs.md` — prioritized backlog (P1/P2/P3). `CHANGELOG.md` — dated change log.
- `.pre-commit-config.yaml` — hooks (markdownlint, shellcheck, prettier, hygiene)

## Every change: the flow

1. Edit files.
2. Run hooks: `prek run --files <changed>` (fast) or `prek run --all-files`.
3. Commit — the pre-commit hook runs the same hooks; if a hook auto-fixes a
   file, the commit aborts → `git add` the fixes → commit again.
4. Add a `CHANGELOG.md` entry under today's date (`## YYYY-MM-DD`), hash
   filled in after the commit (amend or a pin commit is fine).
5. Check off / update the relevant `TODOs.md` item if one existed.
6. Push is the user's action — never push (global permission denies it).

## Regenerate the Aptfile (after apt install/remove on this machine)

```bash
~/dotfiles/apt/generate.sh    # dump + filter (base/essential, lib* runtime, exclude.txt)
~/dotfiles/apt/generate.sh --check   # verify no drift
```

Review the diff — the filters are heuristic (dpkg priority/essential,
`^lib` without `-dev`, `apt/exclude.txt`). Add machine-specific packages to
`exclude.txt`, not by hand-editing the Aptfile.

New third-party apt repo needed? Add it to `apt/sources.sh` (deb822
`.sources` preferred; idempotent guards; keyrings to `/etc/apt/keyrings`).

## Refresh the Brewfile (on the Mac)

```bash
cd ~/dotfiles && rake homebrew:update   # = brew bundle dump --force
```

## Bump hook revisions

Edit `.pre-commit-config.yaml` `rev:` fields to the latest tags, then:

```bash
prek run --all-files   # recreates envs; fix any fallout the bumps surface
```

## CI

`.github/workflows/lint.yml` runs `prek run --all-files` on push/PR via
`j178/prek-action`. Do NOT add `apt/generate.sh --check` to CI — it diffs
against the machine's installed packages and would always fail on a runner.

## Conventions

- Shell scripts: bash, `set -euo pipefail`, `--dry-run` mode where the action
  is invasive, idempotent guards for anything re-runnable.
- Docs: READMEs explain why/how for humans; agents' behavior lives in
  `opencode/AGENTS.md` + skills, not duplicated into READMEs.
- No comments in code unless the user asks (existing comment blocks explain
  non-obvious design — leave them).
- Never commit secrets; vendor keyrings are fetched at runtime, never stored.
