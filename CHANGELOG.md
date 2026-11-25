# Changelog

All notable changes to this repo. Dates are YYYY-MM-DD (local commit date);
entries reference the committing hash. Newest first. When adding an entry,
use today's date and the hash of the change once committed.

## 2026-11-24

- `(hash)` — Shared classify() helper (PR
  `fix/shared-classify-helper-2026-11-24`): `opencode/lib/session-classify.js`
  is the one shared helper for `director.js`, `review-enforcer.js` and
  `session-nudger.js` — session classification (child/top/foreign/unknown)
  plus the server-wide event subscription, which the three plugins each
  reimplemented and had already diverged on. Converged: a turn ends on
  succeeded, interrupted OR failed (director's Stop now fires and the
  nudger now counts on failed turns), and the event loop is guarded twice
  everywhere (per-event catch plus an outer catch around the stream). The
  helper lives in `opencode/lib/`, not `plugins/` — opencode loads every
  file under `plugins/` as a plugin. Tests: new
  `test/plugins/session-classify.test.js` (15 cases); plugin suites grow
  63 → 83, eval 15/15, profiles 12/12, shell harness 24/24.
  `session-logger.js` keeps its own narrower `isChild` (follow-up
  candidate).

- `(hash)` — Git push rules fix (PR
  `fix/git-push-rules-2026-11-24`): the blanket `git push *` deny from
  the threat-model v1 broke the factory flow (agents must push branches
  and open PRs). `policies` and the `feature` / `infra` profiles now
  deny only the dangerous shapes — force-push, delete, push to
  `master` / `main`, bulk push — while branch pushes stay allowed (on
  `ask` in the profiles); `explore` and the eval runner keep the
  blanket deny. Threat model updated: push patterns are best-effort
  (abbreviated long options, `git -c ... push`, bare `git push` on
  `master` all evade them) — GitHub branch protection on `master` is
  the control that actually guarantees nothing lands there, and the PR
  could not verify its status from the VM (check the repo settings).
  Profile tests grow 10 → 12 cases.

- `(hash)` — Sandbox / threat model (PR
  `fix/sandbox-threat-model-2026-11-24`): `docs/threat-model.md`
  (assets, adversaries, the seven-rule never-list, enforcement layers,
  known holes, v2 OS sandbox) and three per-project profiles in
  `opencode/profiles/` (`explore` read-only, `feature` default, `infra`
  with a narrow sudo allowlist), all carrying the never-list and guarded
  by `test/profiles/profiles.test.js` (10 cases). The global
  `opencode.json` gains the secret `read` / `external_directory`
  denies, the `git push *` deny, and a `policies` hard-deny for the
  shell half of the never-list (documented in the official V2
  permissions doc and valid against the live config schema; verify with
  `opencode debug config` on 2.3.0 before relying on it). The eval
  runner's generated config carries the never-list too. Verified
  against the current official docs: a shell pattern ending in a space
  plus `*` also matches the bare command (the PR #2 note that said
  otherwise was wrong), and the default `external_directory` policy is
  allow, not ask. opencode 2.3.0 core has no native OS sandbox — that
  is v2 (`opencode-sandbox` / `universal-opencode-sandbox` plugins,
  bubblewrap / sandbox-exec). CI needs one line from a real clone
  (`node --test test/profiles/*.test.js` in the `test` job): the API
  refuses workflow files (403).

- `(hash)` — Evals v1 — reference tasks harness (PR `fix/evals-v1-2026-11-24`):
  `eval/run.mjs` (node ESM, no deps) runs each reference task in a scratch
  copy through
  `opencode run --standalone --auto --archived --format json -m <model>`,
  scores with deterministic checks only (no LLM-as-judge), and writes
  `eval/results/<date>-<model-slug>.json`. 5 reference tasks (planted
  one-line bugs, missing test cases, docs tree sync, Darwin services
  fail case); discrimination validated without a model (checks fail on
  the fixture as-shipped, pass on a manually-fixed copy). Self-tests
  `test/eval/run.test.js` (15 cases, stub opencode); CI runs the mocked
  mechanics only, real evals are
  manual. `modelDigest` is null in v1 (no reliable digest for ollama
  `:cloud` models — see Run reproducibility). Known limit: the
  `opencode run` flags were verified against current docs, not the
  pinned 2.3.0 binary — re-check with `opencode run --help` before a
  real eval. Note: the API push of the first commit reset all eight
  `.sh` files to mode 644 (same blobs, mode only) — the mode-only
  commit `7273c95` on this branch restores `+x`, and CI went green
  after it.

- `(hash)` — macOS bootstrap parity (PR `fix/macos-bootstrap-2026-11-24`):
  `setup.sh` now runs `brew bundle` on Darwin instead of printing a
  manual hint (WARN + continue when Homebrew is missing or the bundle
  fails, so a packages failure never aborts the bootstrap);
  `setup-ollama.sh` installs ollama via Homebrew and starts the gateway
  with `brew services start ollama`, keeping the manual hint + exit 0
  only when Homebrew is absent. The Brewfile gains the bootstrap
  dependencies (`python`, `jq`, `ollama`) and the `docker` cask is
  renamed `docker-desktop` (the bare `docker` token is a deprecated
  alias); the 2022 `Brewfile.lock.json` (Monterey, Homebrew 3.6.7) is
  deleted — `brew bundle` regenerates it on first run. Director needs no
  change: the fork installer maps `darwin/arm64`/`darwin/amd64` and
  upstream v1.23.0 ships both tarballs. Shell harness 17 → 24 cases
  (Darwin simulated with a stub `uname`; `node --test` unchanged at 63).
  Known limit: no run on a real Mac yet — the first macOS bootstrap is
  still to be validated by hand.

- `(hash)` — Automatic cloud fallback (PR `fix/cloud-fallback-2026-11-24`):
  opencode 2.3.0 has no native fallback chain — only a catalog default
  ("falls back to the newest available supported model",
  opencode.ai/docs/models) — so the fallback is a new plugin
  `opencode/plugins/cloud-fallback.js` built on the V2 `retry` hook +
  `switchModel` (opencode.ai/docs/build/plugins/server; same pattern as
  the community failover plugins, implemented locally with zero
  dependencies). A failed call on an ollama `:cloud` model whose error
  reads as cloud-unavailable (gateway down, model not registered / not
  signed in; 401/402/403/404/502/503/504 or network/not-found/auth
  text) switches the session to local `ollama/qwen3:4b` and retries the
  same step, with a one-shot notice prompt; 429 and other errors are
  left to OpenCode's built-in retry. On the next user message the plugin
  probes `GET /api/tags` (2s timeout) and switches back to the primary
  cloud model when it is listed again; a manual model change while
  fallen back clears the state, and `session.deleted` drops it. Opt out
  with `CLOUD_FALLBACK=0`; tune with `CLOUD_FALLBACK_MODEL`,
  `CLOUD_FALLBACK_GATEWAY`, `CLOUD_FALLBACK_TIMEOUT_MS`.
  `cloud-fallback.test.js` adds 19 cases (44 → 63 plugin cases) and the
  mock gains a `switchModel` recorder; the shell harness is unchanged
  (17/17, no shell files touched). Known limits: a slow-but-alive cloud
  is not detected (only failures trigger the hook); a failed title /
  compaction call can trigger a session-level switch; the switch-back
  assumes registered cloud models show up in `/api/tags` (the inventory
  behind `ollama list`) — a wrong "yes" self-corrects on the next failed
  call. The "second provider (Z.ai direct)" half of the TODO item is
  not done.

- `(hash)` — director.js portability + overwrite detection (PR
  `fix/director-portability-2026-11-24`): the fallback binary tier no
  longer hardcodes a personal home path — it resolves from `DIRECTOR_BIN`
  / PATH / `~/.local/bin` / `~/.claude/director/bin`, all derived from
  `$HOME` (`process.env.HOME` with an `os.homedir()` fallback), with a
  `DIRECTOR_FALLBACK_BIN` override for the fallback tier; the stale comment
  about an installer placeholder substitution (which the committed code
  never used) is replaced by the real resolution. Overwrite detection is a
  CI tripwire: a test asserts the plugin source still carries its `V2
STOPGAP PORT` marker and no hardcoded home path, so a silent replacement
  of the managed file by `director install --opencode` fails CI (the plugin
  itself writes no files, so there is nothing to guard at runtime).
  `director.test.js` grows 9 → 15 cases (HOME tiers, override precedence,
  no-binary degrade, marker); the 10s hook timeout is untouched.

- `(hash)` — Honor `SKIP_DIRECTOR`/`SKIP_OLLAMA` in setup.sh itself (PR
  `fix/setup-skip-2026-11-24`): `setup.sh` documented both skips in its
  header but never tested them — it invoked `setup-director.sh` and
  `setup-ollama.sh` directly and unconditionally, so the skips only
  worked if the sub-scripts ran. Both steps now guard on their `SKIP_*`
  with the same skip messages as the sub-scripts. `test/shell/run.sh`
  grows 14 → 17 cases (both-SKIP, no-SKIP control, `SKIP_DIRECTOR`
  only) using marker sub-scripts that fail if invoked; the guard cases
  fail on the old `setup.sh`. Note: the API push of this commit reset
  `setup.sh` to mode 644 again — the mode-only commit `6111e80` on
  this branch restores `+x`.

- `(hash)` — Committed tests for plugins + shell scripts (PR `fix/plugin-tests-2026-11-24`):
  `test/plugins/` adds 38 node:test cases on a mock opencode ctx
  (review-enforcer classification/dirty-tracking/review gate/read-only
  deferral, session-nudger bands, session-logger vault fixture,
  director.js against a stub binary) and `test/shell/run.sh` adds 14
  bash cases with stub binaries + scratch HOME (ollama local/cloud split,
  setup.sh pin/skip/drift/force, setup-director.sh pin/skip/drift); both
  wired into CI as a `test` job in `.github/workflows/lint.yml`
  (setup-node v7.1.0, node 24). A root `package.json` (`type: module`,
  zero dependencies) lets node:test import the ESM plugins. The harness
  surfaced a real bug: `setup.sh`, `opencode/setup-ollama.sh` and
  `opencode/setup-director.sh` were mode 644 in git, so direct execution
  failed 126 on a fresh clone — scripts are invoked via `bash` in the
  harness; the mode-only commit `4a1eec9d` on this branch restores `+x`.

- `(hash)` — Software-factory review fixes (PR `fix/software-factory-review-2026-11-24`):
  `setup-ollama.sh` splits the routing table — local models are pulled
  (hard error on failure), `:cloud` models only register their manifest
  (warning + `ollama signin` hint on failure, since a cloud pull downloads
  no weights); `skills/workflow/SKILL.md` `/bless` template moves to the
  native V2 `permissions` array (`edit`/`shell`, last-match-wins); `setup.sh`
  pins `OPENCODE_VERSION=2.3.0` (latest 2026-11-24, `--version` flag) and
  `opencode/setup-director.sh` pins `DIRECTOR_VERSION=v1.23.0` (latest
  upstream 2026-10-27), with drift-from-pin notes in both skip branches;
  `TODOs.md` gains the full review backlog. Two first impressions were
  corrected during verification: a `:cloud` pull is manifest-only and does
  not fail as such, and the V1 `/bless` template is still normalized by
  opencode V2 — both are alignment work, not broken-config fixes.

## 2026-11-17

- `d15677e` — setup.sh step 2 stops re-downloading opencode on every bootstrap: script-managed installs now print `SKIP … already installed` and leave the binary alone unless `FORCE_OPENCODE=1` (which reinstalls the latest release), winding down the always-curl self-heal from 0bbbcd4 that the V1→V2 migration made unnecessary — setup.sh was re-fetching opencode on every run, which the owner flagged as noise (`SKIP_OPENCODE=1` full-step skip and the dpkg/brew/npm hard-fail hints unchanged); verified by a 5-case PATH-sandboxed shadow harness (fresh installs once, idempotent skip zero curl calls, FORCE curls once, deb-owned exits 1 with removal hints, SKIP_OPENCODE skips) + `prek` (shellcheck/prettier), `@review` APPROVE

- `ce14c1a` — opencode.json: drop the `git push *` shell deny so agent-shell push falls under the existing `shell * → allow` base rule (owner hit `Permission denied: shell` on `git push -u origin feat/00-pr-workflow`; V2 rules are last-match-wins with configured denies absolute, so no saved approval could have overridden the deny; `rm`/`sudo`/`curl | bash`/`wget | bash` denies untouched); verified live — `opencode debug config` serves permissions without the push deny and `git push --dry-run` executes, picked up by the running service's config watcher (no reload/restart needed)

- `035cf79` — setup.sh hardens opencode config staleness end-to-end: new step 1 raises `fs.inotify.max_user_watches` to `1048576` via an idempotent sysctl guard (SKIP when runtime ≥ target AND `/etc/sysctl.d/99-dotfiles-inotify.conf` already matches; Linux-only; WARN-not-fail with rc 0 on sudo failure; mktemp → `sudo install -m 0644` → `sudo sysctl -p`, deliberately no pipe into sudo), and the config-deploy step (now 3/6) ends with `command -v opencode && opencode reload` so the running service re-parses after every deploy instead of silently serving a stale watch — the durable fix for the 2026-11-16 ENOSPC root cause (358 `failed to subscribe` watcher failures left `~/.config/opencode` unwatched and the service serving a pre-rebalance parse); steps renumbered 1–6, `OS` hoisted; verified by a 6-case sudo-shadow harness (Darwin SKIP, persisted SKIP, raise→done, warn→rc 0, idem SKIP, live reload) + `prek` (shellcheck/prettier), `@review` APPROVE with 2 accepted minors (mktemp abort edge, /proc TOCTOU)

## 2026-11-16

- `(hash)` — Agent roster rebalance: the default Build agent drops to the fast/cheap tier — top-level `model` in `opencode.json` switches to `ollama/glm-5.3-flash:cloud` and `agents.plan` pins Plan to it too (Plan rode the default and had been burning the heavy `glm-5.3:cloud` on planning turns); the heavy tier becomes a named opt-in — `agents/build-flash.md` renamed to `agents/build-no-flash.md` re-pinned to `glm-5.3:cloud`, README tree/build/review sections and the token-optimization §5 routing table synced (whose titles row was stale on `glm-5.2:cloud` since 5221be2)

- `0fc6b67` — /progress command ships live progress reporting server-wide: thin `commands/progress.md` trigger + `skills/progress/SKILL.md` procedure — inventory via `opencode api get /api/experimental/job` (background shells/subagents/images) and `/api/session/active` (executing sessions anywhere on the machine), self-exclusion via `$OPENCODE_SESSION_ID`, running-subagent child-session dedup, one S4-quantified line per item (kind · cmd · status · elapsed, log path / counts only when a countable marker exists), deep-dives via the shell-output window with a `/tmp/opencode` log fallback for buffered pipelines and a newest-messages probe (title, agent, `.tokens`, last activity) for subagents/sessions; `$ARGUMENTS` filters and deep-dives only the matches, zero matches fall back to what-is-running (the jobs endpoint carries in-flight jobs only, so finished items are never reconstructed); indexed in AGENTS.md toolkit + README dependency table

- `0118940` — apt/Aptfile: `jq` enters the regen now that it is marked manual (`/progress` dependency — `opencode api` output trimming); the regen also captured 4 machine-drift packages (libasound2-dev libudev-dev openssh-server pwgen) — regen output, machine truth

- `5221be2` — agents: add explicit `model: ollama/glm-5.3-flash:cloud` to the `ask` agent and bump the `title` agent from glm-5.2 → glm-5.3-flash:cloud

## 2026-11-15

- `0bbbcd4` — setup.sh installs OpenCode **V2**: step 1 always runs the official V2 curl installer (`https://opencode.ai/v2/install` — per docs/migrate-v1 it replaces a curl-installed V1 binary and installs the latest release; the old `opencode.ai/install` URL is V1-only and rejects v2.x, and the old skip-if-installed guard kept a V1 binary forever, surfacing as "V2 permissions are not supported by OpenCode V1"), aborts step 1 with removal hints when opencode is dpkg/brew/npm-managed (the installer replaces only curl-installed binaries), and no longer skips on re-runs so every bootstrap self-heals a stale install; `@review` REQUEST CHANGES ([major] managed-install regression, [minor] failure-tolerant version probe) → fixed → APPROVE

## 2026-11-13

- `ff4e32a` — SSSM §4 progress-discipline rewrite: live-run status must be one quantified line (`<cmd> · <log> · <done>/<total> · elapsed`, counts from a fresh grep of the log in the same turn — "on the final suites" is not a count) with the log path always named so the human can `tail -f` it, uncountable runner output made countable first (verbose/list option or stage markers), notification-turn replies poll ALL live background jobs before writing, `/dev/null` redirects replaced by `/tmp/opencode/` logs, and polling instead of waiting blind on the completion notification — after an opaque "still running — on the final suites" reply on a cargo workspace re-test buried 216-passed/0-failed progress three greps away in the live log; passed `@review` (APPROVE)

## 2026-11-11

- `6ab705a` — SSSM cap raised in two steps (2026-11-10: double to 32768, 2026-11-11: again to 65536): `limit.context: 65536` on every model under `providers.ollama.models` (uniform, incl. local `qwen3:4b` by owner call despite its ≈32k native window, since `ask-local` rarely runs), `compaction` fires at 49152 (buffer 25% of the capped window, recent tail `keep.tokens: 16384`); narrative numbers synced in `agent_sssm_instructions.md`, the README posture note, and TODOs P3

## 2026-11-10

- `06139a0` — New `ask-local` agent: read-only Q&A run entirely on-box through `ollama/qwen3:4b`; `edit` and `bash` denied so it cannot modify anything, and change requests are redirected to the Build agent.

## 2026-11-09

- `414ed82` — SSSM short-context posture: `limit.context: 16384` on every model under `providers.ollama.models`; `compaction` retuned to fire at 12288 (buffer 25% of the capped window, recent tail `keep.tokens: 4096` — the old keep-15k tail exceeded the entire new threshold); a forward-looking state-brief prompt pinned onto the hidden `compaction` agent; new `agent_sssm_instructions.md` (persistent `.opencode/STATE.md` logbook, single-file reads capped at 80 lines via ripgrep plus targeted slices, verbose terminal output to `/tmp/opencode/` inspected by `grep`/`head`/`tail`, action-observation-state loops) loaded every session via `instructions[]` — after NVIDIA's "You don't need long context" (arXiv:2611.05306: later tokens up to 7× costlier to generate, frequent compaction around a carried state holds accuracy), deliberately inverting the "pinned, not tuned" stance under which auto-compaction never fired on the 1M-window default models
- `84194bf` — Restore the agent todo checklist after the V2 upgrade: `"experimental": { "todo": true }` in `opencode.json` re-adds the `todowrite` tool and renders task steps in the session, the active-todo pill, and the TUI right sidebar — default-on in V1 but experimental/opt-in in V2 (changelog v2.1.0, 2026-10-20), so the steps panel silently vanished on the v2.2.x upgrade; no permission rule needed (base policy allows all actions, shell deny list untouched); desktop Todo view is behind the same flag

## 2026-11-03

- `1a5745c` — Add `build-flash` agent (`agents/build-flash.md`, primary, `ollama/glm-5.3-flash:cloud`): a fast/cheap build tier alongside the heavy default — glm-5.3-flash is Z.ai's 18B-active flash model (~10× cheaper than glm-5.3, 1M context, multimodal, only ships as `:cloud`); model registered under `providers.ollama.models` so `setup-ollama.sh` pulls it on fresh machines and the routing table stays the single source of truth, routing-table row added to token-optimization SKILL.md §5, README tree now lists the build agents (`build-local.md` was missing from it) plus a budget-build section; pulled on this machine already, end-to-end smoke test passed (`build-flash · glm-5.3-flash:cloud`)

## 2026-11-02

- `e895663` — Pin `compaction` block in `opencode.json` to upstream defaults (auto, `keep.tokens` 15000, `buffer` "15%"), measured before tuning per the token-optimization loop: model windows are 1M (glm-5.3/5.2) and 256k (kimi-k2.7-code/qwen3:4b) so the default 15% buffer triggers at ~890k/~218k, oc-tokens shows top sessions peak a few hundred k of live context, and the DB holds exactly one compaction part ever (manual, `auto:false`) — any buffer value is inert for this model set, so the block documents posture and buys immunity to upstream default drift (the 16k floor is drift-prone); declined `agents.compaction.model`→glm-5.2 (a compaction summary is session memory, load-bearing for Director sessions) and `experimental.background_compaction` (experimental, held summaries lost on restart)

## 2026-10-28

- `e7ace1f` — Rename `opencode/plugin/` → `opencode/plugins/` (the v2 plugin dir), pure rename; prek/prettier excludes and README/TODOs path references updated to match
- `86bb8e7` — Migrate `opencode.json` to the v2 config schema: `small_model` → `agents.title.model`, `provider` → `providers` (`package`/`settings` instead of `npm`/`options`), `permission.bash` map → flat `permissions` array; drop `@warp-dot-dev/opencode-warp` (V1 plugin API only — v2 refuses to load it, every startup logged a warning); `setup-ollama.sh` reads `providers` (with `provider` fallback); gitignore machine-local v2 artifacts `cli.json`/`service.json` (the latter holds the opencode service password); token-optimization SKILL.md routing row updated
- `e15bc33` — Port the four plugins to the opencode v2 plugin API: `ctx.event.subscribe` (server-wide stream — every per-location instance verifies the session's location to avoid double-firing), prompt-hook text prepends replace V1 `chat.message` part injection, `session.execution.*` events replace the removed `session.idle`; `session-nudger` counts turns in-memory (bar 25 turns ≈ the old 50-message spiral bar); `review-enforcer` exempts `~/.opencode/plan` writes and read-only agents, clears dirty on failed executions; `director.js` is a stopgap port (upstream ≤ v1.16.0 embeds the V1 API — the next `director install --opencode` overwrites it once upstream ships V2); README migrated to the v2 reality (Warp notifications → removal note, plugin sections document turn counting)
- `9132e32` — Port `bin/oc-tokens` to the v2 DB schema: the v1 `session`/`message` tables froze at the 10-27 v2 switch and `immutable=1` skipped the WAL, so the weekly audit had been reading a museum — blind to every v2 session; now reads `session_v2`/`session_message` (msg counts filter to user+assistant; v2 also stores idle/synthetic/system/compaction marker rows), opens `mode=ro` WAL-aware with a pre-checkpoint immutable fallback, and reconciles the frozen v1 tables via a per-session max view — a stale v2 row from the 10-24 trial run had silently erased 3.22M input / 439 msgs ("Committing changes to repos" dropped out of the all-time top-10) and five never-migrated v1-only @review sessions would have vanished; footer caveat: v2's openai-compatible provider path records cacheRead/cost as 0 even when prefix caching works; verified live (146 sessions / 174.5M input restored, `--days` windows include current sessions); @review verdict APPROVE

## 2026-10-19

- `TBD` — Fix broken end-of-turn injections in `review-enforcer.js`: `client.prompt.add` no longer exists on the opencode SDK client (it is `session.prompt` now) — every verdict-gate call silently threw into the plugin's error swallow, so the @review gate had degraded to a silent no-op after some past opencode upgrade. Caught by the session-nudger smoke test (A/B against a live `opencode serve`: baseline showed no injection; after the call fix the gate path works)
- `TBD` — Add `plugin/session-nudger.js`: end-of-turn one-shot nudge (via `client.session.prompt`) each time a top-level session crosses a new multiple of the 50-msg spiral bar — recommends `/session-handoff` + fresh session, reply capped at two sentences; subagents excluded, band state in-memory, `SESSION_NUDGER_THRESHOLD` tunes the bar, `SESSION_NUDGER=0` opt-out; enforces token-optimization skill §3 (top 4 sessions = ~89% of input burn at 200–1000+ msgs); verified live against `opencode serve` (silent below band, fires once per band, re-fires at next band); README section + SKILL.md §3 note, TODOs checked off
- `TBD` — Make the token-optimization environment reproducible on a fresh machine: `opencode/setup-ollama.sh` installs the ollama gateway (official script) and pulls every model from `provider.ollama.models` in opencode.json (single source of truth with the routing table), chained into `setup.sh` step 5 (after packages) with `SKIP_OLLAMA=1`; track `opencode/.gitignore` (drop self-ignore line) so the fresh clone keeps the ingestion boundary instead of surfacing node_modules/package junk; README gateway section + fresh-machine prereq row
- `cde66b6` — Integrate `token-optimization` skill from the Rust game-engine session findings: renamed + frontmatter so the loader surfaces it, corrected ingestion to ripgrep `.gitignore`/`.ignore` semantics (opencode has no `.opencodeignore`), generalized game-specific data paths, tied to the oc-tokens loop; apply routing via `small_model: glm-5.2:cloud` + `tool_output` caps (400 lines / 20480 bytes) in opencode.json; wired into AGENTS.md/README/TODOs

## 2026-10-04

- `298771c` — Fix diagrams agent review findings: render output to pre-existing `/tmp/opencode/` (no mkdir), basename `<name>` mapping, skip render check when `mmdc` missing, `audit` as exact sole argument, report permission failure on `docs/diagrams/` creation
- `7d71d16` — Add diagrams agent + `/diagrams` command (Mermaid maintainer: minimal-diff updates to `docs/diagrams/*.mmd`, canonical node IDs, mandatory render check, `kimi-k2.7-code:cloud`, `steps: 15`); document in README/AGENTS.md; gitignore local `.director/` state
- `d1640e5` — Switch review agent to Kimi (`ollama/kimi-k2.7-code:cloud`, registered in opencode.json) and add tool-call budget: single `git diff` up front, max 5 tool calls, `steps: 10` backstop; README updated
- `48aa04f` — Add `opencode/bin/oc-tokens`: token-efficiency report from the opencode SQLite DB — top sessions by input tokens, spiral detection (message-count threshold), per-agent/model efficiency, health baselines; read-only, `--days`/`--spiral`/`--db` flags; born from the gemma4 review-loop investigation (877/839-msg spirals vs ~8 healthy)

## 2026-10-02

- `35e73e3` — Add @warp-dot-dev/opencode-warp npm plugin to global opencode.json: native Warp notifications (task complete, permission requests, tool status) via OSC 777; no-op outside Warp
- `d79a54a` — Add review enforcement (P3): plugin/review-enforcer.js tracks sessions with substantive edits, nudges on the next user message, and gates end-of-turn on a @review verdict or explicit waiver; injection-based, REVIEW_ENFORCER=0 opt-out; AGENTS.md working-style rule added
- `d2e3114` — Fix CI: pin actions/checkout to real v7.0.1 commit SHA
- `1b07651` — Complete all six P2 TODOs: CI lint workflow (j178/prek-action); apt/sources.sh vendor repo bootstrap (7 repos, deb822, idempotent, --dry-run); Aptfile curation 242→114 (dpkg-essential + runtime-lib\* filters, curated exclude.txt); OBSIDIAN_VAULT parameterization for /session-handoff + session-logger plugin; skills/dotfiles maintenance playbook; "install opencode" verified covered by setup.sh
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
