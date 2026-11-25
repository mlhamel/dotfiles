# Tests

Committed tests for the things that used to be covered only by lint and
by uncommitted shadow harnesses: the opencode plugins and the shell
scripts under `opencode/` (the bootstrap scripts and `bin/oc-tokens`).
Both suites run in CI (`.github/workflows/lint.yml`,
job `test`) and locally with no extra dependencies.

```bash
node --test test/plugins/*.test.js   # plugin suites (node 18+)
node --test test/eval/*.test.js      # eval harness suites (stub opencode)
node --test test/profiles/*.test.js  # permission profiles + threat-model never-list
bash test/shell/run.sh               # shell scripts (scratch HOME + stubs)
bash test/shell/run.sh ollama        # only cases matching "ollama"
bash test/shell/run.sh oc-tokens     # only oc-tokens cases (real SQLite fixture)
```

Use the explicit `test/plugins/*.test.js` glob: `node --test test/plugins`
fails on Node 24 (the directory is treated as a module to load).

## Plugin tests (`test/plugins/`, node:test + node:assert)

`package.json` at the repo root exists only to mark the repo's JS as
ESM (`"type": "module"`, zero dependencies) so `node --test` can import
the plugins, which use `import`/`export`.

`mock-context.js` fakes the V2 plugin API surface the plugins use:
`ctx.location`, `ctx.event.subscribe` (a server-wide async stream driven
by `pushEvent()`), `ctx.session.{get, prompt, hook, switchModel}`
(switches recorded in `ctx.switches`), `ctx.tool.hook`, `ctx.agent.get`. The event loop is asynchronous, so tests `waitFor()` the
prompt they expect and only assert absence after a short settle.

| Suite                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-enforcer.test.js` (13)  | hook registration, `REVIEW_ENFORCER=0` opt-out, edit/write/patch dirty-tracking, read-tool no-op, `~/.opencode/plan` exemption, gate fires once at end of turn (incl. failed turns), new edits reopen the gate, child/foreign/unknown never gated, read-only agents defer the gate and the dirty flag survives                                                                                                                                                                                                                                                                   |
| `session-nudger.test.js` (10)   | `SESSION_NUDGER=0` opt-out, no nudge below the bar, one nudge per band crossing, no re-nudge inside a band, interrupted and failed turns count, double turn-end without `started` counts once, child/foreign never nudged, `session.deleted` drops the count                                                                                                                                                                                                                                                                                                                     |
| `session-logger.test.js` (6)    | no-op outside a vault, prompt-hook registration inside a vault, note auto-creation + one-shot injection, empty-note cleanup on delete, note with entries kept, child sessions skipped                                                                                                                                                                                                                                                                                                                                                                                            |
| `director.test.js` (19)         | prompt injection for top sessions (once only), child/foreign get nothing, failing binary degrades silently, post-tool digest append (string + array results), non-completed results untouched, end-of-turn Stop hook (succeeded + failed, dedup, child excluded), fallback resolution from `HOME` (`~/.local/bin`, then `~/.claude/director/bin`), `DIRECTOR_FALLBACK_BIN` override, `DIRECTOR_BIN` precedence, no-binary degrade, managed-file marker present with no hardcoded home path                                                                                       |
| `cloud-fallback.test.js` (19)   | `CLOUD_FALLBACK=0` opt-out, retry hook switches a cloud model to local on network/404/401 errors and retries (decision + one-shot notice), 429 and invalid-request left alone, already-local and non-ollama untouched, no second switch or re-notify, throwing switchModel degrades, `CLOUD_FALLBACK_MODEL` override, switch-back on the next prompt when the gateway answers and the primary is listed (once only, no probe when never fallen back), stays local when the gateway is down or the primary is unlisted, `session.deleted` and manual model change clear the state |
| `session-classify.test.js` (15) | classify child/top/foreign/unknown (pre-cached, resumed via session.get, cached vs re-looked-up, unknown on failure or no id, deleted forgets), subscribe routing (succeeded/interrupted/failed all end a turn, started/deleted, skips events without a sessionID and unknown types), a throwing handler and a throwing event bus never break the loop, teardown stops it                                                                                                                                                                                                        |

Not covered, on purpose:

- `cloud-fallback.js`: the gateway is a stubbed `fetch` — a slow-but-alive
  cloud is not detected (only failures reach the retry hook), and the
  switch-back assumes registered cloud models show up in `/api/tags`.
  Title/compaction failures are not exercised as a separate kind.
- `director.js`: the 10s hook timeout is not exercised. The fallback
  path IS covered (HOME-derived tiers, env override, managed-file
  marker — see the `director.test.js` row above). The compaction/context
  re-grounding bridge is not covered either.
- `session-logger.js`: the real `log_session.py` is replaced by a stub
  that answers `init` with a canned `RESULT:` line.
- The plugins' behaviour under a real opencode server is not tested;
  the mocks assert the contract the plugins rely on, not the server.

## Eval harness tests (`test/eval/`, node:test + node:assert)

`run.test.js` (14) covers `eval/run.mjs` without ever calling a real
model: a stub `opencode` binary is written to a temp dir by the tests
themselves (so no committed executable is needed) and answers `--version`
plus the JSONL events a real `opencode run --format json` emits. Cases:
task loading and validation, model slug + default-model resolution,
JSONL parsing (tokens, cost, session id), the exact `run` argv
(`--standalone --auto --archived --format json -m <model> -- <prompt>`)
and scratch cwd/HOME, failure / timeout / empty-output runs, the four
check kinds (`cmd`, `contains`, `count-gt`, `unchanged`), end-to-end
pass and fail runs, results-file shape, and the `main()` exit code.
Synthetic tasks live in `test/eval/fixtures/tasks/`; they are test-only
and never run against a real model.

## Profile tests (`test/profiles/`, node:test + node:assert)

`profiles.test.js` (12) guards the threat model (`docs/threat-model.md`)
against drift: it loads the three profiles in `opencode/profiles/`,
the global `opencode.json`, and the eval runner's generated config,
and asserts the never-list is present in each (secret `read` /
`external_directory` denies, shell denies for `sudo`, `rm`,
pipe-to-shell, `git push`, `eval`), that the denies come after the
broad rules they override (last-match-wins), that `*.env.example`
stays allowed after the `*.env` denies, that no profile allows shell
broadly, that `explore` is read-only, that only `infra` has a sudo
allowlist (and that it is exactly the five listed commands, after the
`sudo *` deny), and that the global config carries the `policies`
hard-deny for the shell half of the never-list. The never-list is
encoded in the test independently of the profiles, so editing a profile
without updating the test fails the suite. The workflow skill must
reference the profiles (checked too).

## Shell tests (`test/shell/run.sh`, plain bash)

Each case runs the real script with a scratch HOME and stub binaries on
PATH: no sudo, no apt, no network, no model downloads. Stubs log every
invocation to `$STUB_LOG`. Cases (36):

- `setup-ollama.sh`: happy path (local pull + cloud manifest), local
  pull failure aborts, cloud failure is a warning with the `ollama signin`
  hint, `SKIP_OLLAMA=1`, dead gateway aborts. The gateway-down case takes
  ~30s: the script retries the gateway for 30 x 1s by design.
- `setup.sh`: skip when opencode 2.3.0 is installed (config symlink
  deployed), drift note for 2.2.0, `FORCE_OPENCODE=1` passes `--version
2.3.0` to the installer, fresh install, `SKIP_OPENCODE=1`. Director,
  packages and ollama steps are skipped via `SKIP_*` to isolate step 2;
  the inotify step runs against the real `/proc` value with a stub `sudo`
  that fails, so it takes the WARN path and continues. Three more cases
  prove `setup.sh` honors `SKIP_DIRECTOR`/`SKIP_OLLAMA` itself (the
  header documents them, and the guards used to live only in the
  sub-scripts): with both set, the bootstrap completes and neither
  sub-script is invoked; without either, the director marker is invoked
  and its failure aborts the bootstrap before ollama; with only
  `SKIP_DIRECTOR=1`, the director marker is skipped and the ollama marker
  is invoked. The markers replace the sub-scripts in a scratch repo tree
  and fail if called, so a missing guard fails the case instead of
  silently falling through to the sub-script's own guard.
- `setup-director.sh`: skip when healthy on v1.23.0, drift note for
  v1.20.0, fresh install (the fake installer creates a stub binary and
  the script wires opencode), `SKIP_DIRECTOR=1`.
- Darwin (simulated with a stub `uname`, since the CI runners are Linux):
  `setup.sh` runs `brew bundle` on the repo Brewfile, warns and continues
  when Homebrew is missing or when the bundle fails, and honors
  `SKIP_PACKAGES=1`; `setup-ollama.sh` installs ollama via Homebrew and
  starts the gateway with `brew services start ollama`, or exits 0 with
  the manual hint when Homebrew is absent; `setup-director.sh` runs the
  installer with `Darwin`/`arm64` visible to it (upstream v1.23.0 ships
  `darwin_arm64` and `darwin_amd64` tarballs, verified against the release
  download URLs). A run on a real Mac is still untested — see the macOS
  item in `TODOs.md`.
- `opencode/bin/oc-tokens`: report cases against real SQLite fixtures
  built with python3's sqlite3 module (v2 and legacy v1 schemas), so the
  reporting SQL runs end to end: happy totals, `--spiral` threshold
  boundary, `--days` cutoff, v1/v2 reconciliation (the v1/v2 max wins),
  half-migrated and pre-v2 schemas, missing and malformed DBs, argument
  validation, and the `OPENCODE_DB` env var. Fixtures embed `NOW_MS`
  tokens that a builder rewrites to the current epoch millis, so the
  `--days` cases never rot; `--days 0` is pinned as a real cutoff because
  the parser accepts `0` but must not treat it as "no filter".

Scripts are invoked via `bash` on purpose: it keeps the harness working
regardless of file modes, and `setup.sh` itself invokes the other two
directly. The harness surfaced a missing `+x` on these three scripts (mode
644 in git, direct execution failed with exit 126 on a fresh clone); that
was fixed on this branch by the mode-only commit `4a1eec9d` — a kind of
commit the GitHub API used for this PR cannot produce, which is also the
probable cause of the original loss (PR #2 was pushed through the API).
`opencode/bin/oc-tokens` is still mode 644 in git, so its cases invoke it
the same way.
