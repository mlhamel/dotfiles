# dotfiles

Configuration files of Mathieu Leduc-Hamel.

## List of configurations

* [opencode](opencode/) — AI agent toolkit: rules, commands, skills, plugins
* [Homebrew](homebrew/) — Brewfile + lockfile

## Quick start

```bash
git clone https://github.com/mlhamel/dotfiles.git ~/dotfiles
cd ~/dotfiles
```

All paths below assume the clone lives at `~/dotfiles`; substitute your
actual clone path if different.

### opencode

Deploy the opencode config (symlinks it into place):

```bash
~/dotfiles/opencode/install.sh
```

Manual equivalent (only if `~/.config/opencode` does not already exist —
running `ln -s` into an existing real directory nests the link inside it):

```bash
ln -s ~/dotfiles/opencode ~/.config/opencode
```

`install.sh` backs up an existing `~/.config/opencode` *directory*
(pre-existing symlinks are simply removed).

#### What's inside

| Path | Purpose |
|---|---|
| `AGENTS.md` | Agent rules, loaded in every session (kept lean) |
| `opencode.json` | Global permissions (relaxed posture) |
| `agents/` | Custom agents: `ask.md` (read-only Q&A), `review.md` (cross-model code review via `@review`) |
| `commands/` | TUI commands (`/bless`, `/new`, director/session workflow) |
| `skills/` | Deep docs loaded on demand (`workflow`, `scaffolding`) |
| `plugin/` | JS plugins (director state, Obsidian session logger) |
| `install.sh` | One-command deploy via symlink |

See [opencode/README.md](opencode/README.md) for the full architecture,
custom agents, and prerequisites.

### Homebrew

Prerequisite: Ruby with Bundler (run `bundle --version` to check).

Install the packages listed in the Brewfile:

```bash
cd ~/dotfiles
bundle install        # rake, pinned in Gemfile
rake                  # = rake homebrew:install → brew bundle install
```

Refresh the Brewfile after installing/removing packages:

```bash
rake homebrew:update  # = brew bundle dump --force
```

## History note

This repo merged two previously unrelated histories in Oct 2026: the
original Homebrew-based dotfiles and the opencode toolkit. They coexist
in separate directories (`homebrew/`, `opencode/`); no shared files.