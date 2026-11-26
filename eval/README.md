# Evals

A fixed set of reference tasks, replayed on every model or prompt change, so a
model swap is measured instead of felt. The runner executes each task in a
scratch copy of its fixture through `opencode run`, scores it with
deterministic checks, and writes one results file per run.

## What is measured

Each task gets `pass` / `fail` plus a quality `score`: the fraction of its
checks that passed. The run summary also records tokens and cost from the
`step_finish` events `opencode run --format json` emits (read from
`event.part` on opencode 2.4.1, with a fallback to the top-level fields
older binaries emit — never both), the session id, and
the run duration. There is no LLM-as-judge in v1: a task passes only when
every check passes, and every check is a shell command, a file-content
assertion, or a count comparison. The score is the quality signal; the
pass/fail is the gate.

## Layout

```text
eval/
├── run.mjs              # the runner (node, no dependencies)
├── measure.mjs          # run + record: run the tasks, append to the history
├── record.mjs           # record a hand-run (e.g. OpenHands) into the history
├── history.mjs          # entry schema, append-only log, SUMMARY.md renderer
├── README.md            # you are here
├── results/             # run results + the trend log, all committed
│   ├── .gitignore       # transcripts (opt-in) stay out of git
│   ├── history.jsonl    # append-only: one JSON object per recorded run
│   ├── SUMMARY.md       # rendered view of the log: runs + trends
│   └── <date>-<model-slug>.json
└── tasks/<id>/
    ├── prompt.md        # the prompt handed to the agent
    ├── checks.json      # the deterministic checks
    └── fixture/         # files copied into a scratch dir, repo layout preserved
```

The fixture preserves the repo-relative layout because the plugin tests import
via relative paths (`../../opencode/plugins/...`). The runner writes a minimal
`opencode.json` into the scratch dir (model + a pinned `providers.ollama`
model list — the gateway does not resolve `:cloud` models from discovery
alone under a scratch HOME — + the never-list from
`docs/threat-model.md` as `deny` rules — see "Sandbox posture" below) and
runs with a scratch `HOME` and a scrubbed environment (`OLDPWD` removed,
`PWD` set to the scratch dir, so the agent never sees a live-repo path),
so the eval never touches the user's real opencode config. A `plugins/`
directory beside a project-root `opencode.json` is not
auto-discovered by opencode, so a plugin fixture is never loaded as a plugin
during its own eval — it is only a file to edit.

Check kinds in `checks.json`:

| kind        | meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `cmd`       | shell command run in the scratch dir, must exit 0                       |
| `contains`  | a fixture file must contain the given text                              |
| `count-gt`  | a regex match count in a fixture file must grow vs the fixture baseline |
| `unchanged` | listed fixture files must be byte-identical after the run               |

## Sandbox posture

Eval runs launch real agents with `--auto`, so `ask` is no protection:
the runner's generated `opencode.json` carries the never-list from
`docs/threat-model.md` as `deny` rules (no `sudo`, `rm`, pipe-to-shell,
`git push`, or `eval`; no reads of secrets or secret directories). Shell
stays broadly allowed — eval tasks run arbitrary test commands — so the
containment comes from the scratch workdir and scratch `HOME`, which
hold no secrets to leak. Eval tasks never need sudo, pushes, secrets,
or pipe-to-shell, so the restrictions cost nothing. The one gap this
leaves open is network egress to arbitrary hosts (shell `curl` is
allowed); a v2 OS sandbox would close it, but there is nothing
valuable to exfiltrate from a scratch dir with an empty HOME.

A guard snapshots the live repo (HEAD + `git status
--untracked-files=all`) around each task run: if the live repo moved
while the agent ran, the task fails, even if every check passed — an
agent that edits the live repo instead of its scratch dir must never
score a pass. The harness's own transcript writes (under
`eval/results/`) are excluded from the snapshot. When the repo state
cannot be read (not a git repo), the guard skips instead of failing
the task; the result records the guard outcome either way.

## Running a real eval

Prerequisites: opencode 2.3.0 on `PATH` and the model you want to evaluate
reachable. Ollama models (`ollama/<model>:cloud`) additionally need the
gateway up with the models registered (`./opencode/setup-ollama.sh`). Models
served by opencode's own providers — the default `opencode/big-pickle` among
them — need no gateway and no key; `docs-tree-sync` measured pass 1.00 with
big-pickle, no gateway, and a scratch `HOME` (2026-11-26). The runner never
calls a model itself except through `opencode run`; the self-tests use a
stub binary instead.

```bash
node eval/run.mjs                                  # all tasks, repo default model
node eval/run.mjs --tasks fix-nudger-band         # one task
EVAL_MODEL=ollama/kimi-k2.7-code:cloud node eval/run.mjs
EVAL_TIMEOUT_S=900 node eval/run.mjs               # per-task timeout, default 600
EVAL_KEEP=1 node eval/run.mjs                      # keep scratch workdirs
EVAL_KEEP_TRANSCRIPTS=1 node eval/run.mjs          # also save raw JSONL transcripts
```

Results land in `eval/results/<date>-<model-slug>.json` (model, opencode
version, repo head, per-task pass/score/checks, tokens, cost). The runner
exits 0 only when every selected task passes. A run takes up to
`tasks × timeout` in the worst case; the default budget is 5 × 10 minutes.

## Measuring over time

`measure.mjs` is the runner plus bookkeeping: it runs `run.mjs`, then
appends one entry per task to the append-only history
(`eval/results/history.jsonl`) and regenerates `eval/results/SUMMARY.md` —
a per-run table plus per agent × model × task trend means — from the whole
log. It takes the same flags and env as `run.mjs` (`--tasks`, `--model`,
`--timeout`, `--bin`, `--keep`, `--keep-transcripts`, `EVAL_*`):

```bash
node eval/measure.mjs                              # run all, record, render
node eval/measure.mjs --tasks docs-tree-sync       # one task
EVAL_MODEL=ollama/kimi-k2.7-code:cloud node eval/measure.mjs
```

The log is history, not state: entries are appended, never rewritten or
deduped, so a failed run is still recorded (failures are data) and
re-running the same task adds another row the trends average over.
`SUMMARY.md` is a rendered view, not a data source — anything that wants
to chart or query the history consumes `history.jsonl` directly.

Runs that a human does outside the harness (OpenHands, a one-off setup)
are recorded by hand with `record.mjs`, which validates the same schema —
agent, model, task and score are required, tokens, duration and a note
are optional and left null when unknown:

```bash
node eval/record.mjs --agent openhands --model <model> --task docs-tree-sync \
  --score 3/3 [--tokens-in <n>] [--tokens-out <n>] [--duration-s <s>] \
  [--note "<what and where>"]
```

Commit the updated `history.jsonl` and `SUMMARY.md` together after a run.

## Scheduled measurement

`.github/workflows/measure.yml` runs `measure.mjs` on a GitHub Actions runner
every Monday 06:00 UTC (`0 6 * * 1`) and commits the results back, so the
history gains a weekly point even when nobody runs the eval by hand. The
runner needs no secret for the default model, opencode's free
`opencode/big-pickle`, which reaches opencode's own provider directly. To
measure ollama's cloud models instead, add the `OLLAMA_API_KEY` repository
secret — the Measure step forwards it into the job environment.

The model is picked in a fixed precedence — `workflow_dispatch` input >
repo **variable** `EVAL_MODEL` (Settings → Variables → Actions) > the
`opencode/big-pickle` default — so switching the scheduled model is a
variable change, never a workflow edit. How an ollama model resolves
depends on that secret: set, `evalConfig` points the pinned
`providers.ollama` block at `https://ollama.com/v1` and wires the key as a
`{env:OLLAMA_API_KEY}` reference that opencode expands at runtime, so the
literal key never lands in the config file; unset, the block stays
unchanged and still points at `127.0.0.1:11434`, which only works if the
host actually runs a gateway.

Runner-vs-laptop details:

- The workflow installs opencode via the **V2** installer —
  `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version 2.3.0`,
  the same pin `setup.sh` uses. The plain `opencode.ai/install` URL is
  V1-only and rejects v2.x, and V1 chokes on the harness's
  `--standalone --auto --archived` flags.
- The job logs `opencode --version` before measuring, cross-checkable
  against the version recorded in the results file.

The commit-back step runs `if: always()` so a failed measurement is still
recorded (failures are data); it skips silently when nothing changed and
pushes `HEAD:refs/heads/<ref>`, which works from schedule and dispatch
alike. A `measure` concurrency group prevents two overlapping runs from
interleaving commits.

## Adding a task

1. Create `eval/tasks/<id>/` with `prompt.md`, `checks.json`, `fixture/`.
2. Write the prompt the way you would ask a colleague: goal, scope, what not
   to touch, and the command to self-verify before finishing.
3. Validate discrimination before committing: the checks must **fail** on the
   fixture as-shipped and **pass** on a manually-fixed copy. A check that
   passes on the fixture proves nothing — the two vacuous checks this rule
   caught during v1 were a `contains` on text already present in the fixture
   and a harness invocation that exits 0 when no case matches.
4. Add the task id to the real-tasks test in `test/eval/run.test.js` and run
   the suites (`node --test test/eval/*.test.js`, `node --test
test/plugins/*.test.js`, `bash test/shell/run.sh`).

## Known limits

- The `opencode run` flags (`--standalone --auto --archived --format json
-m`) are verified against the pinned 2.3.0 binary (2026-11-26 dry run:
  `docs-tree-sync` pass 1.00 on `opencode/big-pickle`, 41 s); re-check with
  `opencode run --help` before trusting a run on a new opencode version.
- `modelDigest` is `null` in v1: there is no reliable way to get a digest for
  an ollama `:cloud` model from opencode. Pin the model string and the repo
  head in the results file; the run-reproducibility TODO item covers digests.
- The runner kills a run that exceeds its timeout, but a run can still exit 0
  while an `ask` permission was auto-rejected — that is why a task pass
  requires all checks to pass, never the exit code alone.
- Real evals are manual or scheduled, never on the lint path: CI runs the
  mocked mechanics (`test/eval/`) on every PR — needs no credentials and
  spends nothing — and the weekly `measure` workflow spends only the free
  `opencode/big-pickle` quota unless someone dispatches it with a paid model
  or adds the `OLLAMA_API_KEY` secret to measure ollama's cloud models.
