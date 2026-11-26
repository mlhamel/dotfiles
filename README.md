# dotfiles

Configuration files of Mathieu Leduc-Hamel.

## List of configurations

- [opencode](opencode/) — AI agent toolkit: rules, commands, skills, plugins
- [docs](docs/) — threat model + security docs for the factory
- [homebrew](homebrew/) — Brewfile + lockfile (macOS-only; see [homebrew/README.md](homebrew/README.md))
- [apt](apt/) — Aptfile + generate/install scripts (Debian/Ubuntu; see [apt/README.md](apt/README.md))
- [specs](specs/) — OKF-format spec documents (see [specs/README.md](specs/README.md))

## Quick start

One command, fresh machine to working (installs opencode if missing,
symlinks the config, wires Director, installs apt packages on
Debian/Ubuntu; per-step SKIP\_\* env vars documented in the script):

```bash
git clone https://github.com/mlhamel/dotfiles.git ~/dotfiles
~/dotfiles/setup.sh
```

Or step by step:

```bash
cd ~/dotfiles   # all paths below assume the clone lives here
```

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

`install.sh` backs up an existing `~/.config/opencode` _directory_
(pre-existing symlinks are simply removed).

#### What's inside

| Path                | Purpose                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `AGENTS.md`         | Agent rules, loaded in every session (kept lean)                                             |
| `opencode.json`     | Global permissions (relaxed posture)                                                         |
| `agents/`           | Custom agents: `ask.md` (read-only Q&A), `review.md` (cross-model code review via `@review`) |
| `commands/`         | TUI commands (`/bless`, `/new`, director/session workflow)                                   |
| `skills/`           | Deep docs loaded on demand (`workflow`, `scaffolding`)                                       |
| `plugins/`          | JS plugins (director state, Obsidian session logger)                                         |
| `install.sh`        | One-command deploy via symlink                                                               |
| `setup-director.sh` | Optional: install Director binary + wire opencode                                            |

See [opencode/README.md](opencode/README.md) for the full architecture,
custom agents, and prerequisites.

### Homebrew

`setup.sh` runs `brew bundle` on the Brewfile as its packages step on
macOS (Homebrew itself is the only prerequisite; if it is missing,
`setup.sh` warns and continues). The Rake flow below stays as a manual
alternative — it needs Ruby with Bundler (`brew install ruby &&
gem install bundler`).

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

### apt (Debian/Ubuntu)

```bash
sudo ~/dotfiles/apt/sources.sh   # third-party vendor repos (idempotent)
~/dotfiles/apt/install.sh         # install everything in the Aptfile
~/dotfiles/apt/generate.sh       # refresh the Aptfile from this machine
```

See [apt/README.md](apt/README.md) for the filters, sources.sh, and caveats.

## Development

Linting runs locally via [prek](https://github.com/j178/prek) and in CI on
every push/PR (`.github/workflows/lint.yml`):

```bash
prek install          # wire git hooks (once per clone)
prek run --all-files  # run everything now
```

Hooks: whitespace/EOF/merge-conflict hygiene, JSON validation, markdownlint,
shellcheck on the setup scripts, prettier on markdown/JSON. Lockfiles
(`package-lock.json`, `Brewfile.lock.json`), `node_modules/`, and the
Director-managed `opencode/plugins/` are excluded.

Tests run in CI too (same workflow, `test` job) — see
[test/README.md](test/README.md):

```bash
node --test test/plugins/*.test.js   # plugin suites
bash test/shell/run.sh               # bootstrap scripts
```

## History note

This repo merged two previously unrelated histories in Oct 2026: the
original Homebrew-based dotfiles and the opencode toolkit. They coexist
in separate directories (`homebrew/`, `opencode/`); no shared files.
