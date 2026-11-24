# Tests

Committed tests for the two things that used to be covered only by lint
and by uncommitted shadow harnesses: the opencode plugins and the
bootstrap shell scripts. Both suites run in CI (`.github/workflows/lint.yml`,
job `test`) and locally with no extra dependencies.

```bash
node --test test/plugins/*.test.js   # plugin suites (node 18+)
bash test/shell/run.sh               # bootstrap scripts (scratch HOME + stubs)
bash test/shell/run.sh ollama        # only cases matching "ollama"
```

Use the explicit `test/plugins/*.test.js` glob: `node --test test/plugins`
fails on Node 24 (the directory is treated as a module to load).

## Plugin tests (`test/plugins/`, node:test + node:assert)

`package.json` at the repo root exists only to mark the repo's JS as
ESM (`"type": "module"`, zero dependencies) so `node --test` can import
the plugins, which use `import`/`export`.

`mock-context.js` fakes the V2 plugin API surface the plugins use:
`ctx.location`, `ctx.event.subscribe` (a server-wide async stream driven
by `pushEvent()`), `ctx.session.{get, prompt, hook}`, `ctx.tool.hook`,
`ctx.agent.get`. The event loop is asynchronous, so tests `waitFor()` the
prompt they expect and only assert absence after a short settle.

| Suite                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-enforcer.test.js` (13) | hook registration, `REVIEW_ENFORCER=0` opt-out, edit/write/patch dirty-tracking, read-tool no-op, `~/.opencode/plan` exemption, gate fires once at end of turn (incl. failed turns), new edits reopen the gate, child/foreign/unknown never gated, read-only agents defer the gate and the dirty flag survives                                                                                                          |
| `session-nudger.test.js` (9)   | `SESSION_NUDGER=0` opt-out, no nudge below the bar, one nudge per band crossing, no re-nudge inside a band, interrupted turns count, double turn-end without `started` counts once, child/foreign never nudged, `session.deleted` drops the count                                                                                                                                                                       |
| `session-logger.test.js` (6)   | no-op outside a vault, prompt-hook registration inside a vault, note auto-creation + one-shot injection, empty-note cleanup on delete, note with entries kept, child sessions skipped                                                                                                                                                                                                                                   |
| `director.test.js` (15)        | prompt injection for top sessions (once only), child/foreign get nothing, failing binary degrades silently, post-tool digest append (string + array results), non-completed results untouched, fallback resolution from `HOME` (`~/.local/bin`, then `~/.claude/director/bin`), `DIRECTOR_FALLBACK_BIN` override, `DIRECTOR_BIN` precedence, no-binary degrade, managed-file marker present with no hardcoded home path |

Not covered, on purpose:

- `director.js`: the 10s hook timeout is not exercised. The fallback
  path IS covered (HOME-derived tiers, env override, managed-file
  marker — see the `director.test.js` row above). The compaction/context
  re-grounding bridge is not covered either.
- `session-logger.js`: the real `log_session.py` is replaced by a stub
  that answers `init` with a canned `RESULT:` line.
- The plugins' behaviour under a real opencode server is not tested;
  the mocks assert the contract the plugins rely on, not the server.

## Shell tests (`test/shell/run.sh`, plain bash)

Each case runs the real script with a scratch HOME and stub binaries on
PATH: no sudo, no apt, no network, no model downloads. Stubs log every
invocation to `$STUB_LOG`. Cases (17):

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

Scripts are invoked via `bash` on purpose: it keeps the harness working
regardless of file modes, and `setup.sh` itself invokes the other two
directly. The harness surfaced a missing `+x` on these three scripts (mode
644 in git, direct execution failed with exit 126 on a fresh clone); that
was fixed on this branch by the mode-only commit `4a1eec9d` — a kind of
commit the GitHub API used for this PR cannot produce, which is also the
probable cause of the original loss (PR #2 was pushed through the API).
