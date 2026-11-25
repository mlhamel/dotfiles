# Evals

A fixed set of reference tasks, replayed on every model or prompt change, so a
model swap is measured instead of felt. The runner executes each task in a
scratch copy of its fixture through `opencode run`, scores it with
deterministic checks, and writes one results file per run.

## What is measured

Each task gets `pass` / `fail` plus a quality `score`: the fraction of its
checks that passed. The run summary also records tokens and cost from the
`step_finish` events `opencode run --format json` emits, the session id, and
the run duration. There is no LLM-as-judge in v1: a task passes only when
every check passes, and every check is a shell command, a file-content
assertion, or a count comparison. The score is the quality signal; the
pass/fail is the gate.

## Layout

```text
eval/
├── run.mjs              # the runner (node, no dependencies)
├── README.md            # you are here
├── results/             # one JSON file per run, committed
│   ├── .gitignore       # transcripts (opt-in) stay out of git
│   └── <date>-<model-slug>.json
└── tasks/<id>/
    ├── prompt.md        # the prompt handed to the agent
    ├── checks.json      # the deterministic checks
    └── fixture/         # files copied into a scratch dir, repo layout preserved
```

The fixture preserves the repo-relative layout because the plugin tests import
via relative paths (`../../opencode/plugins/...`). The runner writes a minimal
`opencode.json` into the scratch dir (model + the never-list from
`docs/threat-model.md` as `deny` rules — see "Sandbox posture" below) and runs
with a scratch `HOME`, so the eval never touches the user's real opencode
config. A `plugins/` directory beside a project-root `opencode.json` is not
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

## Running a real eval

Prerequisites: opencode 2.3.0 on `PATH`, the ollama gateway up with the models
registered (`./opencode/setup-ollama.sh`), and the model you want to evaluate
reachable through it. The runner never calls a model itself except through
`opencode run`; the self-tests use a stub binary instead.

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
-m`) were verified against the current OpenCode docs, not against the
  pinned 2.3.0 binary on this machine — re-check with `opencode run --help`
  before trusting a run on a new opencode version.
- `modelDigest` is `null` in v1: there is no reliable way to get a digest for
  an ollama `:cloud` model from opencode. Pin the model string and the repo
  head in the results file; the run-reproducibility TODO item covers digests.
- The runner kills a run that exceeds its timeout, but a run can still exit 0
  while an `ask` permission was auto-rejected — that is why a task pass
  requires all checks to pass, never the exit code alone.
- Real evals are manual on purpose: CI runs only the mocked mechanics
  (`test/eval/`), never a model, so it needs no credentials and spends
  nothing.
