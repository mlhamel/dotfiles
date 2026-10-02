# opencode toolkit

Personal, portable opencode configuration. Everything the agent needs to
work the way I want — rules, commands, skills — versioned in one repo.

## Architecture

```
opencode/
├── README.md                  # You are here. Human-facing docs.
├── AGENTS.md                  # Agent rules. Loaded in EVERY session. Keep lean.
├── opencode.json              # Global permissions (relaxed posture)
├── agents/                    # Custom agents
│   ├── ask.md                 #   read-only Q&A primary agent
│   └── review.md              #   cross-model code reviewer (see below)
├── commands/                  # Thin triggers, typed in the TUI
│   ├── bless.md               #   /bless  → bootstrap any cloned repo
│   ├── new.md                 #   /new    → scaffold a fresh project
│   ├── director-*.md          #   /director-* → Director state workflow
│   └── session-handoff.md     #   /session-handoff → Obsidian checkpoint
├── skills/                    # Deep docs, loaded ON DEMAND via the skill tool
│   ├── workflow/SKILL.md      #   bless/new playbooks, per-project config template
│   └── scaffolding/SKILL.md   #   per-language scaffolder reference
├── plugin/                    # JS plugins (director state, Obsidian session logger)
│   ├── director.js
│   └── session-logger.js
├── install.sh                 # Deploy: symlink into ~/.config/opencode
└── setup-director.sh          # Optional: install Director binary + wire opencode
```

## The layering principle

| Layer      | Loaded         | Purpose                                          |
|------------|----------------|--------------------------------------------------|
| `AGENTS.md`| every session  | lean rules + one-line index of commands/skills   |
| `skills/`  | on demand      | the deep knowledge; agent reads it when relevant  |
| `commands/`| when typed     | thin triggers: "load skill X, then do Y"          |

Why: always-loaded files burn context in every session. Skills act as a
table of contents that is free until needed. Commands stay 5 lines; all
maintainable knowledge lives in SKILL.md files.

Pattern: **commands trigger, skills document.**

## Deploy

```bash
./install.sh          # from this directory; backs up an existing real
                      # ~/.config/opencode directory (symlinks are removed)
```

Manual equivalent (only if `~/.config/opencode` does not already exist):

```bash
ln -s ~/dotfiles/opencode ~/.config/opencode
```

## Prerequisites: what works on a fresh machine

Not everything in this toolkit is self-contained. Two external
dependencies are machine-local:

| Piece | Needs | Without it |
|---|---|---|
| `/bless`, `/new`, `@ask`, `@review` | nothing extra | fully portable |
| `/director-adopt`, `/director-complete`, `/director-handoff` | the [`director`](https://github.com/mlhamel/director) binary (`plugin/director.js` is its managed shim) | commands fail; plugin no-ops harmlessly |
| `/session-handoff` + `plugin/session-logger.js` | an Obsidian vault with `log_session.py` under `.opencode/skills/decision-log/`; the command hardcodes the vault path on this machine | command fails; plugin silently no-ops outside the vault |

### Director setup

`setup-director.sh` installs the Director binary from
[mlhamel/director](https://github.com/mlhamel/director) and wires it
into opencode (`director install --opencode`). Idempotent — an existing
healthy install is detected and skipped. Set `SKIP_DIRECTOR=1` to skip.

```bash
./setup-director.sh
```

The plugins follow a cardinal rule — a broken hook must never break a
session — so a fresh machine degrades gracefully: Director state and
Obsidian logging are simply absent until the prerequisites are installed.

## Custom agents

### `ask` — read-only Q&A (`agents/ask.md`)

Primary agent that answers questions about the codebase without ever
touching it (`edit: deny`, `bash: deny`). Switch to it with **Tab**, or
use it whenever you want explanations instead of changes.

### `review` — cross-model code review (`agents/review.md`)

Subagent that reviews code using a **different model family** than the
one that wrote it. This is the whole point: a reviewer with an
independent perspective catches blind spots the author model shares.

- Pinned to `ollama/gemma4:cloud` (build agent runs `glm-5.3:cloud` —
  different family, so different biases)
- Read-only: `edit` denied; bash limited to `git diff`, `git log`, `git show`
- Severity-tagged findings (`[critical] [major] [minor] [nit]`) with a
  final verdict: APPROVE / REQUEST CHANGES / COMMENT

Usage — after the build agent writes code:

```
@review check the changes
```

The model can also invoke it automatically based on its description.

**To change the reviewer model:** edit the `model:` line in the
frontmatter. Run `opencode models` for cloud/Zen models or `ollama list`
for local ollama models (the opencode listing may not include everything
ollama has pulled). Any provider works. For a *local* model instead of a
cloud one, `ollama/gemma4:26b` fits 30GB RAM but is slow on CPU — only
worth it for offline use.

## How to extend

- New workflow → add `commands/<name>.md` (thin trigger) + a section or
  skill in `skills/`. Keep commands under ~10 lines.
- New language support → edit `skills/scaffolding/SKILL.md`, add the
  official scaffolder + test + lint tooling to the reference table.
- New personal rule → edit `AGENTS.md`. Ask: does this need to be in every
  session's context? If no, put it in a skill.
- Per-project strictness comes from `/bless`, which generates a project-level
  `opencode.json` with `edit: ask` — the global config stays relaxed.

## Interview demo script

1. `git clone <this-repo> ~/dotfiles && ~/dotfiles/opencode/install.sh` —
   10-second deploy
2. `cd /tmp && git clone <some-repo> && opencode` → `/bless` — agent analyzes
   an unknown codebase, codifies its conventions in AGENTS.md, adds safe
   per-project permissions
3. `cd /tmp && opencode` → `/new rust cli-app` — idiomatic official scaffolding,
   tests, then blessed
4. Talking point: "Everything I need to work with AI agents lives in one
   versioned repo — rules, commands, skills. Portable in ten seconds."
   (Demo sticks to `/bless`, `/new`, `@review` — the self-contained parts;
   director/Obsidian features need this machine's prerequisites, see above.)

## Design decisions

- **Split docs:** README = maintenance/rationale for me; AGENTS.md + skills =
   behavior for the agent. One doc for both audiences bloats agent context.
- **Relaxed global, strict per-project:** my own repos stay friction-free;
   unfamiliar/interview repos get blessed with `edit: ask`.
- **Official scaffolders only:** never hand-roll what `uv init`, `cargo new`,
   `npm create`, `go mod init` already provide.