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
- [x] **P1 · Tests for plugins + shell scripts** — done 2026-11-24 (PR
      `fix/plugin-tests-2026-11-24`): `test/plugins/` runs 38 node:test
      cases on a mock ctx (review-enforcer classify/dirty/gate/read-only,
      session-nudger bands, session-logger vault fixture, director.js
      with a stub binary) and `test/shell/run.sh` runs 14 bash cases
      (stub binaries + scratch HOME; ollama local/cloud split, setup.sh
      pin/skip/drift/force, setup-director.sh pin/skip/drift); both wired
      into CI (`.github/workflows/lint.yml` `test` job). Deliberately
      plain bash, zero new dependencies — no bats/shunit. Still open:
      the uncovered director.js fallback/timeout paths. (The missing `+x`
      on the three scripts, surfaced by the harness, was fixed on this
      branch by the mode-only commit `4a1eec9d`.)
- [x] **P1 · Honor `SKIP_*` in setup.sh itself** — done 2026-11-24 (PR
      `fix/setup-skip-2026-11-24`): `setup.sh` now tests `SKIP_DIRECTOR`
      and `SKIP_OLLAMA` itself before invoking the sub-scripts (it only
      documented them in its header; the sub-scripts honored them, but
      only if they ran). Harness grows 14 → 17 cases (both-SKIP, no-SKIP
      control, `SKIP_DIRECTOR` only), with marker sub-scripts that fail
      if invoked; the guard cases fail on the old `setup.sh`.
- [x] **P1 · Fallback provider** — done 2026-11-24 (PR
      `fix/cloud-fallback-2026-11-24`): opencode core has no native
      fallback chain — only a catalog default ("falls back to the newest
      available supported model", opencode.ai/docs/models) — so the
      fallback is a new plugin `opencode/plugins/cloud-fallback.js` on
      the V2 `retry` hook + `switchModel` (opencode.ai/docs/build/
      plugins/server, same pattern as the community failover plugins).
      A failed call on an ollama `:cloud` model whose error reads as
      cloud-unavailable (gateway down, model not registered / not signed
      in; 401/402/403/404/502/503/504 or network/not-found/auth text)
      switches the session to local `ollama/qwen3:4b` and retries the
      same step, with a one-shot notice prompt; 429 and other errors are
      left to OpenCode's built-in retry. On the next user message the
      plugin probes `GET /api/tags` (2s timeout) and switches back to
      the primary cloud model when it is listed again; a manual model
      change while fallen back clears the state. Opt out with
      `CLOUD_FALLBACK=0`; tune with `CLOUD_FALLBACK_MODEL`,
      `CLOUD_FALLBACK_GATEWAY`, `CLOUD_FALLBACK_TIMEOUT_MS`.
      `cloud-fallback.test.js` adds 19 cases (44 → 63 plugin cases);
      mock gains a `switchModel` recorder. The "second provider (Z.ai
      direct)" half of this item is NOT done — it stays a follow-up.
- [x] **P1 · director.js portability + overwrite detection** — done 2026-11-24 (PR
      `fix/director-portability-2026-11-24`): the fallback tier is no longer
      the hardcoded `/home/mlhamel/.claude/director/bin/director` — it
      resolves from `DIRECTOR_BIN` / PATH / `~/.local/bin` /
      `~/.claude/director/bin`, all derived from `$HOME`, with a
      `DIRECTOR_FALLBACK_BIN` override for the fallback tier. The
      "overwrite detection" is a CI tripwire test asserting the file still
      carries its `V2 STOPGAP PORT` marker and no hardcoded home path (the
      plugin itself writes no files, so there is nothing to guard at
      runtime). `director.test.js` grows 9 → 15 cases. The 10s hook
      timeout is untouched (a constant, not a portability issue).
- [x] **P1 · macOS bootstrap parity** — `setup.sh` now runs `brew bundle`
      on Darwin (WARN + continue when Homebrew is missing or the bundle
      fails) and `setup-ollama.sh` installs ollama via Homebrew and starts
      the gateway with `brew services start ollama`; the Brewfile gains
      the bootstrap dependencies (`python`, `jq`, `ollama`), the `docker`
      cask is renamed `docker-desktop`, and the 2022 `Brewfile.lock.json`
      is deleted (`brew bundle` regenerates it on first run). Director on
      Darwin needs no change: the fork installer maps `darwin/arm64` and
      upstream v1.23.0 ships `darwin_arm64`/`darwin_amd64` tarballs. Shell
      harness 17 → 24 cases (Darwin simulated with a stub `uname`); a run
      on a real Mac is still untested.
- [ ] **P1 · Evals (reference tasks)** — the old P2 "Evals + cost tracking"
      item covered quality and $ in a single line; split them. A fixed set
      of 5–10 reference tasks (fix a bug, add a feature with tests, small
      refactor — each with a checkable outcome), replayed on every model or
      prompt change, with pass/fail and a quality score. A model swap
      becomes measured instead of felt.
- [ ] **P1 · Sandbox / threat model** — nothing says today what an agent is
      allowed to do: the `/bless` template asks for everything by default,
      and nothing stops a confused or compromised agent from exfiltrating
      data with `curl` or reading secrets from disk. Define the threat
      model (least-privilege per project type, egress rules, secrets never
      in context) and enforce what can be enforced (permissions, sandbox,
      secret scan — see Secrets management).
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
- [ ] **P2 · $ cost tracking** — `oc-tokens` measures tokens, not dollars
      (and cache-read is 0 on the openai-compatible provider path). Add a
      $ cost column to the token loop, per project.
- [ ] **P2 · Factory observability** — `session-logger` and `oc-tokens`
      exist, but nobody reads them systematically. Produce a weekly rollup
      (tasks, failures by cause, $ per project, fallback activations) so
      the measure → fix loop runs on real production data instead of
      impressions.
- [ ] **P2 · Run reproducibility** — the binaries are pinned, but cloud
      models float under the same name and prompts change without
      versioning. Record for each build what actually ran (model + digest,
      skill/prompt version) so it can be replayed and compared.
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

- [x] **P3 · Brewfile refresh** — done as part of the macOS parity work:
      the Brewfile gains the bootstrap dependencies (`python`, `jq`,
      `ollama`), the `docker` cask is renamed `docker-desktop`, and the
      2022 `Brewfile.lock.json` is deleted (`brew bundle` regenerates it
      on first run). Still open: re-run `rake homebrew:update` on the Mac
      to sync the remaining entries with reality.
- [ ] **P3 · Gemfile relevance** — now that prek replaced the rake-driven dev
      flow for linting, decide whether the Rakefile/Gemfile still earn
      their keep or should be folded into a plain script.
