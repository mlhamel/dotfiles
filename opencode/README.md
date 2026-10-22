# opencode toolkit

Personal, portable opencode configuration. Everything the agent needs to
work the way I want — rules, commands, skills — versioned in one repo.

## Architecture

```text
opencode/
├── README.md                  # You are here. Human-facing docs.
├── AGENTS.md                  # Agent rules. Loaded in EVERY session. Keep lean.
├── opencode.json              # Global permissions (relaxed posture)
├── agents/                    # Custom agents
│   ├── ask.md                 #   read-only Q&A primary agent
│   ├── diagrams.md            #   Mermaid diagram maintainer (see below)
│   └── review.md              #   cross-model code reviewer (see below)
├── commands/                  # Thin triggers, typed in the TUI
│   ├── bless.md               #   /bless  → bootstrap any cloned repo
│   ├── new.md                 #   /new    → scaffold a fresh project
│   ├── grill-me.md            #   /grill-me → stress-test an idea through an interview
│   ├── diagrams.md            #   /diagrams → update/audit architecture diagrams
│   ├── director-*.md          #   /director-* → Director state workflow
│   └── session-handoff.md     #   /session-handoff → Obsidian checkpoint
├── bin/                       # CLI utilities (on-demand, not in every session)
│   └── oc-tokens              #   token-efficiency report from opencode.db
├── skills/                    # Deep docs, loaded ON DEMAND via the skill tool
│   ├── workflow/SKILL.md      #   bless/new playbooks, per-project config template
│   ├── scaffolding/SKILL.md   #   per-language scaffolder reference
│   ├── grill-me/SKILL.md      #   opt-in, stateless interview entry point
│   ├── grilling/SKILL.md      #   round-based interview workflow
│   ├── token-optimization/SKILL.md  #   token-efficiency: ingestion, routing, oc-tokens loop
│   └── dotfiles/SKILL.md      #   maintenance playbook for this repo itself
├── plugin/                    # JS plugins (director state, session logger, review
│   ├── director.js             #   enforcement, session nudger — see the sections)
│   ├── session-logger.js
│   ├── review-enforcer.js
│   └── session-nudger.js
├── install.sh                 # Deploy: symlink into ~/.config/opencode
├── setup-director.sh          # Optional: install Director binary + wire opencode
└── setup-ollama.sh            # Optional: install ollama gateway + pull pinned models
```

## The layering principle

| Layer       | Loaded        | Purpose                                          |
| ----------- | ------------- | ------------------------------------------------ |
| `AGENTS.md` | every session | lean rules + one-line index of commands/skills   |
| `skills/`   | on demand     | the deep knowledge; agent reads it when relevant |
| `commands/` | when typed    | thin triggers: "load skill X, then do Y"         |

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

| Piece                                                        | Needs                                                                                                                                                   | Without it                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `/bless`, `/new`, `@ask`, `@review`                          | nothing extra                                                                                                                                           | fully portable                                          |
| `/diagrams` + `@diagrams`                                    | `mmdc` (mermaid-cli) for the render check; diagrams degrade to syntax-unchecked edits without it                                                        | edits still apply; render verification skipped          |
| `/director-adopt`, `/director-complete`, `/director-handoff` | the [`director`](https://github.com/mlhamel/director) binary (`plugin/director.js` is its managed shim)                                                 | commands fail; plugin no-ops harmlessly                 |
| `/session-handoff` + `plugin/session-logger.js`              | an Obsidian vault with `log_session.py` under `.opencode/skills/decision-log/`; set `OBSIDIAN_VAULT` if the vault isn't at `~/Dropbox/obsidian/general` | command fails; plugin silently no-ops outside the vault |
| every model call (default, `small_model`, agents)            | the ollama gateway at `localhost:11434` with the models pinned in `opencode.json`                                                                       | requests fail — run `setup-ollama.sh`                   |

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

### Ollama gateway setup

`setup-ollama.sh` installs the ollama gateway via the official install
script (if missing) and pulls every model listed under
`provider.ollama.models` in `opencode.json` — the same list that drives
model routing, so the routing table is the single source of truth and the
pulled set cannot drift from it. This is what makes the token-optimization
environment (gateway + routing + oc-tokens loop) reproducible on a fresh
machine. Idempotent. Set `SKIP_OLLAMA=1` to skip.

```bash
./setup-ollama.sh
```

`setup.sh` chains it automatically (after the packages step — the model
list is parsed with `python3`). On macOS, if `ollama` is missing, the
script prints a `brew install ollama` hint and exits; a `brew "ollama"`
entry should ride along on the next Brewfile refresh (P3 TODO).

### Warp notifications (npm plugin)

`opencode.json` loads `@warp-dot-dev/opencode-warp` from npm — native Warp
terminal notifications (task complete with prompt/response summary,
permission requests, tool status) via OSC 777 escape sequences. Works out
of the box inside Warp; other terminals ignore the sequences, so it's
harmless as a global default. Installed automatically by opencode at
startup via bun. Remove by deleting the `plugin` array entry.

## Custom agents

### `ask` — read-only Q&A (`agents/ask.md`)

Primary agent that answers questions about the codebase without ever
touching it (`edit: deny`, `bash: deny`). Switch to it with **Tab**, or
use it whenever you want explanations instead of changes.

### `review` — cross-model code review (`agents/review.md`)

Subagent that reviews code using a **different model family** than the
one that wrote it. This is the whole point: a reviewer with an
independent perspective catches blind spots the author model shares.

- Pinned to `ollama/kimi-k2.7-code:cloud` (build agent runs `glm-5.3:cloud` —
  different family, so different biases)
- Budget-constrained: single `git diff` up front, max 5 tool calls, then write
  the review; `steps: 10` caps the overall turn count as a backstop
- Read-only: `edit` denied; bash limited to `git diff`, `git log`, `git show`
- Severity-tagged findings (`[critical] [major] [minor] [nit]`) with a
  final verdict: APPROVE / REQUEST CHANGES / COMMENT

Usage — after the build agent writes code:

```text
@review check the changes
```

The model can also invoke it automatically based on its description.

### `diagrams` — Mermaid diagram maintainer (`agents/diagrams.md`)

Subagent that keeps architecture diagrams under a project's `docs/diagrams/`
in sync with the code, invoked via `/diagrams` (incremental update for the
current diff) or `/diagrams audit` (full consistency check against the
codebase). A maintainer, not an artist:

- Minimal-diff updates to `.mmd` sources (`containers.mmd`, `context.mmd`;
  sequence diagrams only if they already exist) — never regenerates whole files
- Node IDs stay canonical (real module/class/function names) so drift is
  grep-able; display labels may be human-readable
- Writes only under `docs/diagrams/**`; bash limited to read-only git + `mmdc`
- Render check (`mmdc -i <file> -o /tmp/opencode/<name>.svg`) with max 2
  retries; failing files revert to the last renderable state; skipped with a
  note if `mmdc` is unavailable
- Pinned to `ollama/kimi-k2.7-code:cloud`, `steps: 15` as a spiral backstop
- No-ops on purely internal changes (no structural effect → no edit)

Usage — after structural changes:

```text
/diagrams
/diagrams audit
```

### Review enforcement (`plugin/review-enforcer.js`)

Remembering to ask for review is the weak link; this plugin closes it:

- Sessions that make substantive edits (`edit`/`write`/`apply_patch`) are
  tracked as "dirty"
- A **user message** while dirty injects a nudge: run `@review` on the
  outstanding changes first
- **End of turn** while dirty injects a review gate: report the reviewer's
  verdict (APPROVE / REQUEST CHANGES) or explicitly state why review is
  waived, before claiming the work done
- Subagent sessions are never gated; the gate fires once per dirty stretch
  (new edits reopen it)

It's enforcement by injection, not blocking — a misfire costs a paragraph
of context instead of wedging a session. Opt out with `REVIEW_ENFORCER=0`.

**To change the reviewer model:** edit the `model:` line in the
frontmatter. The ollama models listed in `opencode.json`'s
`provider.ollama.models` appear in `opencode models` and the `/models`
picker; add an entry there (ID must match `ollama list`) to expose more.
`ollama list` shows everything ollama has pulled, including models not
configured in opencode. For a _local_ model instead of a cloud one,
`ollama/gemma4:26b` fits 30GB RAM but is slow on CPU — only worth it
for offline use.

### Session-length nudger (`plugin/session-nudger.js`)

The `oc-tokens` report's biggest finding was session sprawl: the top 4
sessions carried ~89% of all input tokens at 200–1000+ messages, against
a healthy average of ~8. This plugin turns the skill's §3 session
discipline into an enforced rule instead of a habit:

- At end of turn, a top-level session whose message count crossed a new
  multiple of the spiral bar (50 messages) gets a one-shot injected nudge
  via `client.session.prompt`: recommend `/session-handoff` to checkpoint
  the thread, then start a fresh session; the reply is capped at two
  sentences so the nudge turn only adds one short assistant reply on top
  of the usual context re-send
- Re-nudges at every band crossing (50, 100, 150, …); subagent sessions
  are excluded; band state is in-memory — a restart costs at most one
  re-nudge for an already-long session
- Tune: `SESSION_NUDGER_THRESHOLD` (default 50, the `oc-tokens --spiral`
  bar). Opt out: `SESSION_NUDGER=0`

Each nudge is a full turn, so on very long sessions it re-sends the
context once to warn about context re-sends — immediacy over economy,
deliberately. Raise the threshold if the cadence ever feels too chatty.

## How to extend

- New workflow → add `commands/<name>.md` (thin trigger) + a section or
  skill in `skills/`. Keep commands under ~10 lines.
- New language support → edit `skills/scaffolding/SKILL.md`, add the
  official scaffolder + test + lint tooling to the reference table.
- New personal rule → edit `AGENTS.md`. Ask: does this need to be in every
  session's context? If no, put it in a skill.
- Per-project strictness comes from `/bless`, which generates a project-level
  `opencode.json` with `edit: ask` — the global config stays relaxed.

## Idea interviews (`/grill-me`)

Run `/grill-me <idea>` to stress-test a feature, design, business decision,
or writing idea before committing to it. With no argument, the agent asks
what you want to explore. Prefer a fresh conversation with plan mode off.

The command loads `grill-me`, which delegates to `grilling`: questions arrive
in rounds, each with a recommendation, and later rounds build on your answers.
Push back, narrow the scope, or say "I don't know" when evidence is missing.
The interview writes no files and does not start implementation.

Adapted for OpenCode from [Matt Pocock's skills](https://github.com/mattpocock/skills)
([AI Hero guide](https://www.aihero.dev/skills-grill-me)), pinned to commit
`5beb35b040e3de97e54fa9e386d7e42d15c295c2`. Both imported skill directories
include the upstream MIT license. No extra dependency or model override is
required; the existing config symlink deploys the command and skills.

## Token-efficiency auditing (`bin/oc-tokens`)

opencode records per-session token accounting in a SQLite DB
(`~/.local/share/opencode/opencode.db`). `oc-tokens` turns it into a
report for the continuous-improvement loop: **measure → find the outlier
→ fix (steps cap / tighter prompt / model swap / session split) → re-measure.**

```bash
~/.config/opencode/bin/oc-tokens              # full report
~/.config/opencode/bin/oc-tokens --days 7     # last week only
~/.config/opencode/bin/oc-tokens --spiral 30  # lower loop-detection bar
```

Sections: top sessions by input tokens (context-growth suspects), spirals
(sessions above a message threshold — this is what caught the gemma4 review
loops: 877 and 839 messages vs a healthy median of ~8), per-agent/model
efficiency, and health baselines (median tokens of non-spiral sessions).

Read-only (`immutable=1`), safe to run while opencode is live. Needs
`python3` (stdlib only). Run it weekly or after model/agent changes.

The `token-optimization` skill holds the playbook this report feeds:
ingestion boundaries (ripgrep `.gitignore`/`.ignore` semantics, no
`.opencodeignore`), schema-not-dataset payloads, session discipline, and
model routing (`small_model`, per-agent `model:` pinning).

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
