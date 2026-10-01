# opencode toolkit

Personal, portable opencode configuration. Everything the agent needs to
work the way I want — rules, commands, skills — versioned in one repo.

## Architecture

```
opencode/
├── README.md                  # You are here. Human-facing docs.
├── AGENTS.md                  # Agent rules. Loaded in EVERY session. Keep lean.
├── opencode.json              # Global permissions (relaxed posture)
├── commands/                  # Thin triggers, typed in the TUI
│   ├── bless.md               #   /bless  → bootstrap any cloned repo
│   ├── new.md                 #   /new    → scaffold a fresh project
│   ├── director-*.md          #   session/handoff workflow commands
│   └── session-handoff.md
├── skills/                    # Deep docs, loaded ON DEMAND via the skill tool
│   ├── workflow/SKILL.md      #   bless/new playbooks, per-project config template
│   └── scaffolding/SKILL.md   #   per-language scaffolder reference
├── plugin/                    # JS plugins (director state, Obsidian session logger)
│   ├── director.js
│   └── session-logger.js
└── install.sh                 # Deploy: symlink into ~/.config/opencode
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
./install.sh          # backs up ~/.config/opencode if present, then symlinks
```

Manual equivalent:

```bash
ln -s ~/src/github.com/mlhamel/dotfiles/opencode ~/.config/opencode
```

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

1. `git clone <this-repo> && cd opencode && ./install.sh` — 10-second deploy
2. `cd /tmp && git clone <some-repo> && opencode` → `/bless` — agent analyzes
   an unknown codebase, codifies its conventions in AGENTS.md, adds safe
   per-project permissions
3. `cd /tmp && opencode` → `/new rust cli-app` — idiomatic official scaffolding,
   tests, then blessed
4. Talking point: "Everything I need to work with AI agents lives in one
   versioned repo — rules, commands, skills. Portable in ten seconds."

## Design decisions

- **Split docs:** README = maintenance/rationale for me; AGENTS.md + skills =
   behavior for the agent. One doc for both audiences bloats agent context.
- **Relaxed global, strict per-project:** my own repos stay friction-free;
   unfamiliar/interview repos get blessed with `edit: ask`.
- **Official scaffolders only:** never hand-roll what `uv init`, `cargo new`,
   `npm create`, `go mod init` already provide.