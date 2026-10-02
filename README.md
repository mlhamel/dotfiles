# dotfiles

Configuration files of Mathieu Leduc-Hamel.

## List of configurations

* [opencode](opencode/) — AI agent toolkit: rules, commands, skills, plugins
* [Homebrew](homebrew/) — Brewfile + lockfile

## Quick start

```bash
git clone https://github.com/mlhamel/dotfiles.git
```

### opencode

Deploy the opencode config (symlinks it into place):

```bash
~/dotfiles/opencode/install.sh
```

Manual equivalent:

```bash
ln -s ~/dotfiles/opencode ~/.config/opencode
```

The install script backs up any existing `~/.config/opencode` before symlinking.

#### What's inside

| Path | Purpose |
|---|---|
| `AGENTS.md` | Agent rules, loaded in every session (kept lean) |
| `opencode.json` | Global permissions (relaxed posture) |
| `agent/` | Custom agents (e.g. `ask.md` — read-only Q&A) |
| `commands/` | TUI commands (`/bless`, `/new`, director/session workflow) |
| `skills/` | Deep docs loaded on demand (`workflow`, `scaffolding`) |
| `plugin/` | JS plugins (director state, Obsidian session logger) |
| `install.sh` | One-command deploy via symlink |

See [opencode/README.md](opencode/README.md) for the full architecture
(layering principle, design decisions, how to extend).

### Homebrew

Restore installed packages:

```bash
brew bundle --file=~/dotfiles/homebrew/Brewfile
```

Update dependencies:

```bash
rake    # uses the Rakefile + Gemfile at the repo root
```

## History note

This repo merged two previously unrelated histories in Oct 2026: the
original Homebrew-based dotfiles and the opencode toolkit. They coexist
in separate directories (`homebrew/`, `opencode/`); no shared files.