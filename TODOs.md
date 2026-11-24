# dotfiles — TODOs

Ideas and deferred work for this repo. Anything landed gets checked off or
deleted, not left to rot.

Priorities: **P1** do soon · **P2** do eventually · **P3** nice to have.

## Revue software factory (2026-11-24)

Review of the whole repo against the "software factory" goal (opencode +
ollama + Director + GitHub), landed as PR `fix/software-factory-review-2026-11-24`.

Corrections made during verification — two first impressions were overstated:
`ollama pull` of a `:cloud` model only downloads a tiny manifest, it does not
fail as such; the real problem was the missing local/cloud distinction and
the missing `ollama signin` check. And the V1 `permission` map in the `/bless`
template is still normalized by opencode V2, so migrating it is alignment,
not a fix for a broken config.

- [x] **P1 · Split ollama local/cloud pulls** — `opencode/setup-ollama.sh`
      now pulls local weights (hard error on failure) and only registers
      `:cloud` manifests (warning + `ollama signin` hint on failure).
- [x] **P1 · Bless template in native V2** — `skills/workflow/SKILL.md`
      per-project template uses the `permissions` array (`edit`/`shell`,
      last-match-wins) instead of the V1 `permission` map.
- [x] **P1 · Pin opencode + Director** — `OPENCODE_VERSION=2.3.0` in
      `setup.sh` (latest 2026-11-24, `--version` flag) and
      `DIRECTOR_VERSION=v1.23.0` in `opencode/setup-director.sh` (latest
      upstream 2026-10-27); both skip branches report drift from the pin.
- [ ] **P1 · Tests for plugins + shell scripts** — the 4 JS plugins (~900
      lines, classify/dedup/timeout state machines) and the bootstrap
      scripts have no committed tests; only lint (prek/shellcheck) and the
      shadow harnesses cited in CHANGELOG (never committed) cover them.
      Add a node test runner for plugins and bats/shunit for the scripts,
      run them in CI.
- [ ] **P1 · Fallback provider** — everything (default, plan, title,
      review) goes through `localhost:11434` / Ollama Cloud. Add a second
      provider (e.g. Z.ai direct) and a documented offline fallback
      (`build-local` / `qwen3:4b`) so a cloud outage does not stop all work.
- [ ] **P1 · director.js portability + overwrite detection** — the V2 port
      hardcodes `/home/mlhamel/.claude/director/bin/director` as its
      fallback tier, and the next `director install --opencode` will
      overwrite it once upstream ships V2. Resolve the fallback from
      `DIRECTOR_BIN` / PATH / `~/.local/bin` instead, and add a check that
      detects when the managed file has been replaced.
- [ ] **P1 · macOS bootstrap parity** — `setup.sh` on macOS only prints a
      Homebrew hint and `setup-ollama.sh` exits 0 without installing
      Ollama; the Brewfile is stale (see Housekeeping). Make the Mac path
      real or document it as manual.
- [ ] **P2 · Shared classify() helper** — `director.js`,
      `review-enforcer.js` and `session-nudger.js` each reimplement
      session classification (child/top/foreign/unknown) and the
      server-wide event subscription; they already diverge in details
      (e.g. `execution.failed` handling). Extract one shared helper.
- [ ] **P2 · SSSM compaction validation** — the 64k cap + compaction at
      ~49k rests on the NVIDIA paper, not on measured use (see the P3
      observation item below). Confirm with `oc-tokens` that compaction
      actually fires without thrashing before treating it as settled.
- [ ] **P2 · Secrets management** — the 2026-10-01 audit was clean, but
      nothing prevents the next secret from landing. Add a pre-commit
      secret scan and a documented place for credentials (1Password /
      sops / age), instead of relying on the audit.
- [ ] **P2 · Docs drift** — `opencode/README.md` omits `build-mini.md` and
      `ask-local.md` from its tree, and the `token-optimization` routing
      table does not mention Inkling. Fix, and add a CI check or a
      checklist step that keeps the tree/table in sync with `agents/`.
- [ ] **P2 · Evals + cost tracking** — `oc-tokens` measures tokens, not
      quality or dollars (and cache-read is 0 on the openai-compatible
      provider path). Add a small eval set for the agents and a $ cost
      column to the token loop.
- [ ] **P2 · Multi-machine story** — Aptfile (Debian) vs Brewfile (Mac)
      diverge, and `baseURL` is `localhost:11434` while the plan was an
      Ollama server on the Mac + Framework client over Tailscale. Decide
      which machine is the source of truth and how the two converge.
- [ ] **P2 · Director fork vs upstream** — the installer script is fetched
      from the `mlhamel/director` fork, but it downloads its binary from
      `colinsurprenant/director` releases (the fork has no releases). The
      fork is also behind upstream (fork HEAD `0568702` = upstream
      v1.16.0, upstream is at v1.23.0). Decide: tag releases in the fork,
      or switch the install URL to upstream.
- [ ] **P3 · Repo scope / name** — the repo is an opencode toolkit +
      package lists; it holds no shell, git or editor config despite the
      "dotfiles" name. Either grow into the name or rename the scope in
      the README.

## Setup / portability

- [x] **P1 · Unified bootstrap script** — `setup.sh` at the repo root chains
      opencode binary install (official curl script) → symlink deploy
      (`opencode/install.sh`) → Director (`opencode/setup-director.sh`) →
      apt packages (`apt/install.sh`), with per-step SKIP\_\* env overrides.
- [x] **P1 · Secrets audit** — done 2026-10-01: swept all 21 commits in both
      histories for key/token/password patterns (content, deleted files,
      filenames). Clean — no secrets rode along.
- [x] **P2 · Install opencode itself** — covered by `setup.sh` (P1 bootstrap,
      step 1): detects an existing binary, otherwise installs via the
      official curl script; SKIP_OPENCODE=1 opt-out.
- [x] **P2 · Aptfile `--check` in CI** — `.github/workflows/lint.yml` runs
      `prek run --all-files` on push/PR via `j178/prek-action`. The Aptfile
      drift check is deliberately local-only (it diffs against the machine's
      package set — always-fail on a runner); documented in the workflow
      and apt/README.md.
- [x] **P3 · Test `install.sh` idempotency** — done 2026-11-10: 3 consecutive
      runs on a scratch HOME all exit 0 with an identical `readlink` target
      (repeat runs take the remove-symlink branch, no backup spam); backup
      branch probed separately — an existing real dir is renamed to
      `.config/opencode.backup.<timestamp>` with contents intact before
      relinking.

## apt section

- [x] **P2 · Third-party sources bootstrap** — `apt/sources.sh` configures
      the 7 vendor repos in the Aptfile (docker, chrome, brave, code,
      spotify, gh, gcloud); deb822 format, idempotent guards, --dry-run,
      keyrings fetched at runtime.
- [x] **P2 · Aptfile review pass** — generate.sh now also filters dpkg
      essential packages and runtime lib\* deps (keeps lib\*-dev);
      exclude.txt curated with firmware/bootloader/task-\*/GPU entries;
      242 → 114 packages.
- [ ] **P3 · Flatpak/\_snap inventory** — several desktop apps ship via
      flatpak/snap, not apt; decide whether to version those too
      (`flatpak list --app`, `snap list`) or leave them manual.

## opencode toolkit

- [x] **P2 · Session-handoff vault path** — `/session-handoff` and the
      session-logger plugin now resolve the vault from `OBSIDIAN_VAULT`
      (default `~/Dropbox/obsidian/general`) instead of a hardcoded
      absolute path; documented in the command, AGENTS.md, and README.
- [x] **P2 · Skill for dotfiles itself** — `skills/dotfiles/SKILL.md`:
      repo map, change flow (prek → commit → changelog → TODO checkoff),
      Aptfile/Brewfile regeneration, hook-rev bumps, CI notes, conventions.
- [x] **P3 · Reviewer verdict enforcement** — `plugins/review-enforcer.js`:
      tracks sessions with substantive edits, nudges on the next user
      message, and injects a review-gate prompt at end of turn (verdict or
      explicit waiver required before claiming done). Injection, not
      blocking — degrades to a reminder; REVIEW_ENFORCER=0 opt-out.
- [x] **P2 · Token-optimization skill** — `skills/token-optimization/SKILL.md`:
      generalized from the Rust game-engine session findings; corrected the
      ingestion mechanism (ripgrep `.gitignore`/`.ignore` — opencode has no
      `.opencodeignore`), schema-not-dataset payloads, session discipline,
      model routing (`small_model: glm-5.2:cloud`, per-agent models),
      `tool_output` caps (400 lines / 20 KB); oc-tokens stays the measure arm.
- [ ] **P3 · More cross-model agents** — the `review` pattern (different model
      family for independent opinion) could extend to a `security` auditor
      agent or an `architecture` second-opinion agent.
- [ ] **P2 · Token-efficiency cadence** — run `opencode/bin/oc-tokens` weekly
      and after any agent/model change; findings feed back as steps caps,
      prompt budgets, or model swaps. First report: two gemma4 review spirals
      (877/839 msgs, 145M cache-read combined) already fixed via steps cap +
      Kimi swap; next suspect is long-lived build sessions (400+ msgs).
- [x] **P2 · Session-length nudge plugin** — done: `plugins/session-nudger.js`
      injects a one-shot `/session-handoff` + fresh-session nudge at end of
      turn each time a session crosses a new multiple of the spiral bar
      (50 msgs, `SESSION_NUDGER_THRESHOLD`; `SESSION_NUDGER=0` opt-out);
      subagents excluded, band state in-memory, reply capped at two
      sentences. Anchored in the report: top 4 sessions carried ~143M of
      160M input (89%) at 507/1059/252/231 msgs vs the ~8 healthy target.
- [x] **P2 · oc-tokens cache-hit ratio** — done 2026-11-11: top-burners
      table gains a `cr/in` ratio column and a "Zero-cache burn" section
      auto-flags cache-read = 0 sessions with input >= 100k. Identified:
      a 8/31–9/3 window of glm-5.3:cloud/flash sessions (9 sessions,
      94.6M input, ~45% of lifetime input burn) where the openai-compatible
      provider path recorded cache as 0; later sessions on the same models
      record 5–16x. Zeros stay framed "unknown, not no-cache" per the
      provider caveat.
- [ ] **P3 · SSSM compaction observation** — with the 65536 window cap and the
      49152 trigger live, run `opencode/bin/oc-tokens` after a few days of
      real use: confirm auto-compaction actually fires (~49k; none did under
      the old posture) without thrashing on the wider window, and feed the
      numbers into the cadence loop above.

## Housekeeping

- [ ] **P3 · Brewfile refresh** — `homebrew/Brewfile` predates the apt work; run
      `rake homebrew:update` on the Mac next time to sync it with reality.
- [ ] **P3 · Gemfile relevance** — now that prek replaced the rake-driven dev
      flow for linting, decide whether the Rakefile/Gemfile still earn
      their keep or should be folded into a plain script.
