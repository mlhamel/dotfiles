# Threat model — software factory

Status: v1, 2026-11-24; push rules corrected 2026-11-24 (the blanket `git push *` deny broke the factory flow — agents must push branches and open PRs). Pinned runtime: opencode 2.3.0. Sources: the
official OpenCode V2 permissions doc (`opencode.ai/docs/permissions/`,
read 2026-11-25) and the config schema (`opencode.ai/config.json`, same
day). Anything below marked "verify on 2.3.0" is documented, not measured:
this VM has no opencode binary, so runtime behaviour was checked against
the docs, not against the pinned binary. Run the checklist at the end
before trusting a new posture.

## Scope

One user, his own machines (Linux Framework, Mac), opencode 2.3.0 with
the plugins in this repo, a hybrid Ollama setup (cloud models for heavy
work, local models for small/offline tasks), and any project blessed
with `/bless` — including this public dotfiles repo itself.

In scope: agent sessions in blessed projects, eval runs (`eval/` launches
real agents), the five plugins, and the global config deployed by
`opencode/install.sh`.

Out of scope: a compromised opencode binary, a compromised model
provider, physical access to the machines, and the user's own shell.
The user is trusted; the agent is not. A prompt injection that makes the
agent do something is the threat, not a malicious user.

## Assets

| Asset                                               | Where it lives                                                               | Why it matters                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| Source code, incl. private repos the agent works in | project worktrees                                                            | leak or corruption of work                        |
| SSH keys, GPG keys                                  | `~/.ssh`, `~/.gnupg`                                                         | full identity takeover                            |
| Cloud credentials                                   | `~/.aws`, `~/.config/gcloud`, `~/.azure`, `~/.kube`, `~/.docker/config.json` | paid resources, data access                       |
| GitHub credentials                                  | `~/.config/gh`                                                               | push to any repo as the user                      |
| Package tokens, netrc                               | `~/.npmrc`, `~/.netrc`                                                       | publish / fetch as the user                       |
| App secrets                                         | `.env` files, `*.pem`, `*.key`                                               | credentials in context leak to the model provider |
| The home directory itself                           | `~`                                                                          | everything above, plus mail, vault, photos        |
| Git remotes                                         | `origin` and friends                                                         | a push publishes; hard to un-publish              |
| The machine                                         | sudo, `rm`, package managers                                                 | destructive or privileged action                  |
| Network egress                                      | `curl`, `ssh`, `scp`, `git push`, `webfetch`                                 | the exfiltration channel                          |
| The model channel                                   | every prompt + tool result                                                   | anything in context leaves the machine            |

## Adversaries

1. **Confused agent.** The common case, not an attack: a wrong path, a
   `rm -rf` in the wrong directory, a `git push` to the wrong remote, a
   command copied from a hallucinated doc. The posture must make the
   boring mistake hard, not just the exotic attack.
2. **Prompt injection.** Text the agent treats as instruction: repo
   content (README, issues, code comments), tool output, `webfetch`
   results, pasted text, a `.env` file the agent reads. The agent must
   never execute instructions that arrive through data.
3. **Compromised dependency / malicious repo.** A dependency that runs
   code at install/test time, or a cloned repo whose own `opencode.json`
   loosens the rules (see "Precedence" below). The global posture must
   survive a hostile project config.
4. **Model misbehaviour.** Hallucinated commands, ignored instructions,
   a model that "helpfully" pipes a download into a shell. Same defences
   as (1): deny the dangerous shape, not the intent.

## The never-list

Rules every profile enforces, in every project. Each one exists because
a softer rule (`ask`) fails in exactly the situation it is meant to
catch: `--auto` mode (used by `eval/run.mjs` and by the TUI's
auto-approve) approves `ask` without a human, so only `deny` holds when
nobody is watching.

1. **Never read secrets into context.** Keys, tokens and credentials
   must never become tool output: context is sent to the model provider
   and kept in logs. Enforced by `read` + `external_directory` denies
   on the secret paths (see below).
2. **Never exfiltrate.** No network egress to untrusted hosts, no
   `curl|bash` / `wget|bash` (or `| sh`). Enforced by shell denies on
   the pipe-to-shell shapes; a full egress allowlist needs an OS
   sandbox (v2) because shell patterns cannot constrain arbitrary
   commands (see "What permissions cannot do").
3. **Never run as root.** `sudo *` is denied; the `infra` profile
   allows a short explicit list of `sudo` commands and nothing else.
4. **Never delete blindly.** `rm *` is denied in every profile.
   Deletions go through the file tools, `git clean`, or the user's own
   shell.
5. **Never push dangerously.** Pushing a branch and opening a PR is the
   factory's normal output — allowed, reviewable, reversible; merging
   stays the user's decision. What is denied, in every profile that
   allows pushes at all: force-push (`--force*`, `-f`), delete
   (`--delete`, `-d`, `:<refspec>`), push to `master` / `main`
   (explicit destination forms), and bulk push (`--all`, `--mirror`,
   `+<refspec>`). The `explore` profile denies every `git push *`
   (read-only); eval runs deny every push too (they never need one).
   Commits stay on `ask`: local, reversible, approved one by one.
   Patterns are best-effort — see "What permissions cannot do" — so
   GitHub branch protection on `master` is the control that actually
   guarantees a push cannot land there.
6. **Never modify outside the project.** Writes outside the worktree
   are denied (secret dirs via `external_directory`, everything else
   via the per-project `edit` rules).
7. **Never run unanalysable commands.** `eval *` is denied: the shell
   scanner cannot check what `eval` will run, so no rule can bound it.

## Enforcement layers (opencode 2.3.0)

### Layer 1 — `permissions` (deny rules)

The `permissions` array in `opencode.json`: ordered rules
`{action, resource, effect}`; the last matching rule wins; no match
means `ask`. Any `deny` on a multi-resource operation denies the whole
operation. Wildcards are whole-value: `*` matches any run of
characters including `/`, `?` matches one character. A shell pattern
ending in a space followed by `*` also matches the bare command (`git status *` matches
both `git status` and `git status --short`).

Rule of construction: broad `ask` first, specific `allow` next, the
never-list `deny` rules last — so a deny always wins over an allow
that could match the same command. Saved `always` approvals never
override a configured `deny`.

Built-in base policy (every agent starts with it): everything allowed,
except `read` of `*.env` / `*.env.*` asks and `*.env.example` allows.
The profiles in `opencode/profiles/` keep the `.env.example`
exception: `*.env` and `*.env.*` deny, `*.env.example` allow — in that
order, or the example file would be denied too.

### Layer 2 — `external_directory`

Paths outside the project Location and worktree are checked against
`external_directory` before their `read`/`edit` rules. The default
policy **allows** external access: without an explicit rule, reads and
edits outside the project proceed with no prompt. The never-list
therefore denies the secret directories at this layer too, not only
at the `read` layer. Shell commands get the same check: the scanner
verifies the working directory and the directories a command touches
before the `shell` rules, so `cat ~/.ssh/id_ed25519` is blocked by the
`~/.ssh/*` external-directory deny even though `cat *` is allowed in
the `explore` profile.

### Layer 3 — review gate (advisory)

The `review-enforcer` plugin asks for a cross-model review verdict
before a turn that made substantive edits can quietly end. It is a
loud reminder, not a wall: opencode has no blockable stop, and a
misconfigured gate must never wedge a session. It catches (1), the
confused agent, after the fact. It does not stop exfiltration.

### Layer 4 — `policies` (hard deny, verify on 2.3.0)

The top-level `policies` key hard-denies a permission check after the
`permissions` rules and saved approvals have run: it turns `allow` or
`ask` into `deny` and never grants access. Per the docs, global and
Console-managed policies override project configuration — this is the
layer that survives a hostile project config. The global
`opencode.json` in this repo ships a `policies` array for the shell
half of the never-list, using the exact shape from the docs
(`tool.use` + `shell:<pattern>`). The blanket `git push *` deny was
removed from `policies` on 2026-11-24: it blocked the factory's
normal output (agents push branches and open PRs). `policies` now
carries the targeted push denies instead — force-push, delete, push
to `master` / `main`, bulk push — while branch pushes stay allowed.

**Verify on 2.3.0 before relying on it:** this VM has no opencode
binary, so the `policies` behaviour is documented, not measured. After
deploying, run `opencode debug config` and confirm the policies load;
if the binary rejects the key, delete the `policies` block — the
`permissions` denies still hold for honest projects, and only the
hostile-project-config case weakens. The `read` / `external_directory`
half of the never-list is intentionally _not_ duplicated in `policies`
yet: the docs demonstrate only the `shell:` resource shape, and the
`read:` / `external_directory:` shapes are an extrapolation to
validate the same way.

### Precedence (why the layers are ordered this way)

Config sources load in this order and later rules win on last-match:
remote defaults, global config, custom config, project config, agent
rules. A project's own `opencode.json` therefore overrides the global
`permissions` — including the secret denies. That is the design (a
project may legitimately need more), and it is also the hole: a
malicious repo config can loosen the global posture. Only `policies`
(global, managed) are documented as overriding project config. So:

- Honest projects: `permissions` denies (global + profile) are enough.
- Hostile project config: only the `policies` layer holds. Until it is
  verified on 2.3.0, treat a repo you do not trust as unblessed: open
  it with the `explore` profile, or not at all.

## Profiles

`opencode/profiles/` holds the three per-project profiles. `/bless`
copies one into the project as `opencode.json` and substitutes the
`<test command>` / `<lint command>` placeholders (see
`skills/workflow/SKILL.md`). All three carry the full never-list; they
differ only in what is allowed around it.

| Profile        | Edits  | Shell                                                                                                                                                                                                                                                                    | For                                            |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `explore.json` | denied | `ask`, allowlist of read-only commands (`git status/diff/log/show`, `ls`, `cat`); no push at all (`git push *` denied)                                                                                                                                                   | reading an unfamiliar or untrusted repo        |
| `feature.json` | `ask`  | `ask`, allowlist of read-only git + the project's test/lint commands; branch pushes on `ask`, force/delete/master pushes denied                                                                                                                                          | the default: building a feature                |
| `infra.json`   | `ask`  | `ask`, feature allowlist + package managers (`apt-get`, `apt`, `brew`), `systemctl`, `sysctl`, read-only `docker`, and a short explicit `sudo` allowlist (`apt-get`, `apt`, `systemctl`, `sysctl`, `install`); branch pushes on `ask`, force/delete/master pushes denied | bootstrap / machine work where sudo is the job |

Notes:

- In `infra`, the `sudo *` deny comes _before_ the explicit `sudo`
  allows, and the never-list denies come last: last-match-wins is what
  makes the allowlist narrow instead of decorative.
- `curl` / `wget` stay on `ask` in `feature` and `infra` (a human
  approves each fetch); only the pipe-to-shell shapes are denied.
  Fetching a URL is not the threat — executing what it returns is.
- `webfetch` is left at its default (allow) in all profiles: it is a
  read, and the `explore` agent needs it. A URL can still encode data
  (`https://evil.example/?token=...`), which no permission rule can
  distinguish from a legitimate fetch. That is a known hole (v2).
- The global `opencode.json` keeps its relaxed posture for daily use
  (broad `shell` allow) but now carries the secret `read` /
  `external_directory` denies, the targeted push denies (force /
  delete / master / bulk — branch pushes stay allowed), and the
  `policies` hard-deny for the shell half of the never-list. The secret
  denies are safe globally: nothing in the normal workflow reads keys
  or credentials into context, and the repo's own test suites touch no
  `.env` / `.pem` / `.key` files. The push denies match the house rule
  (agents push branches and open PRs; merging is the user's decision).

## Eval posture

Eval runs (`eval/run.mjs`) launch real agents with `--auto`, so `ask`
is no protection there: the runner's generated `opencode.json` carries
the never-list as `deny` rules — with the blanket `git push *` deny
kept, since eval tasks never push. Eval runs
also use a scratch `HOME` and a scratch workdir, so the secret denies
are defence in depth — a scratch HOME holds no secrets to leak. Eval
tasks never need sudo, pushes, secrets, or pipe-to-shell, so the
restrictions cost nothing. See `eval/README.md`.

## What permissions cannot do

- **Egress allowlist.** Shell patterns match scanner-produced command
  strings. `curl https://github.com/*` does not match
  `curl -fsSL https://github.com/...`, and exfiltration has many
  spellings (`python -c`, `node -e`, `ssh`, `scp`, `rsync`,
  `git push <new-remote>`). Permissions can deny the _shapes_ in the
  never-list; they cannot prove a command does not talk to the network.
- **Push spellings.** The push denies are glob patterns on the command
  string, and git has more spellings than the list enumerates:
  abbreviated long options (`--forc` for `--force`), `git -c ... push`
  (the `-c` prefix means the command no longer starts with `git push`),
  a bare `git push` with no arguments (pushes the current branch to its
  configured upstream — to `master` if that is where the agent sits),
  and refspec forms outside the enumerated set. Patterns are a
  best-effort net, not a proof. The control that actually guarantees
  nothing lands on `master` is GitHub branch protection (see
  "Residual risks").
- **Tool coverage.** A shell sandbox (v2) covers only shell commands.
  The file tools (`read`/`edit`) and `webfetch` are governed by their
  own permission actions, not by the sandbox — the plugin's tool guard
  is a policy layer, not a second OS sandbox.
- **Prompt injection via data.** Permissions constrain actions, not
  reasoning. A model that follows injected instructions will still pick
  an allowed-but-wrong action. The review gate and the evals are the
  mitigations, not a fix.
- **`doom_loop` and `lsp` are not V2 permission actions** (per the
  docs). Do not write rules for them.

## Corrections to earlier repo beliefs

Two claims recorded during the 2026-11-24 review were wrong against
the current official V2 docs:

- **Bare commands.** `git status *` _does_ match bare `git status`:
  a shell pattern ending in a space followed by `*` matches the command without
  arguments. The PR #2 validation note that said otherwise was wrong.
- **External directories.** The default `external_directory` policy is
  **allow**, not ask: reads and edits outside the project proceed
  without a prompt unless a rule is added. The profiles and the global
  config now add the rules.

## Residual risks (known holes, v1)

1. A hostile project `opencode.json` can override the global
   `permissions` denies; only the `policies` layer is documented to
   survive it, and it is unverified on 2.3.0 (see Layer 4).
2. Webfetch URL exfiltration and shell egress via arbitrary commands
   (see "What permissions cannot do"). Needs the v2 OS sandbox.
3. Saved `always` approvals are project-scoped allow rules; they never
   override a deny, but they accumulate. Review them (`opencode`
   stores them per project) and remove stale ones.
4. The model channel itself: anything in context leaves the machine
   to the provider. The never-list keeps secrets out of context; it
   cannot keep _code_ out of context, and code is what the model is
   for. The mitigation is the provider choice (own Ollama gateway),
   not permissions.
5. Push patterns are best-effort (see above). The patterns narrow the
   hole; only GitHub branch protection on `master` (require a pull
   request before merging) closes it. Confirm it is enabled in the
   repo settings — the PR that fixed the push rules could not verify
   it from the VM (no branch-protection read tool, no authenticated
   CLI).

## v2 — OS sandbox

opencode 2.3.0 core has **no native OS sandbox**. Sandboxing comes
from community plugins; the two candidates to evaluate:

- **`opencode-sandbox`** (npm, V2 2.2.6+): wraps every `shell` call
  with `@anthropic-ai/sandbox-runtime` — bubblewrap on Linux,
  `sandbox-exec` (Seatbelt) on macOS. Workspace + `/tmp` writable,
  everything else read-only, network denied by default, credential
  stores unreadable, fail-closed in `enforce` mode. Config lives
  outside the workspace (`~/.config/opencode-sandbox/`), so a repo
  cannot loosen it. Linux needs `bubblewrap` installed, and Ubuntu
  24.04+ needs the `bwrap-userns-restrict` AppArmor profile for
  unprivileged user namespaces.
- **`universal-opencode-sandbox`** (MXC executor): Seatbelt on macOS,
  bubblewrap on Linux, ProcessContainer on Windows. Same shape —
  workspace writable, network denied, credentials unreadable, blocked
  rather than unconfined when the sandbox cannot run — plus an
  admin-owned config (`/etc/universal-opencode-sandbox/config.json`)
  that user configs can only tighten.

Evaluation plan (not this PR): install one plugin on a scratch
machine, run the eval harness under it, confirm the 5 reference tasks
still pass, measure the overhead, and check the failure mode when the
sandbox binary is missing (must refuse, never run unconfined). The
`nono` pack (`nolabs-ai/opencode`) is the heavier alternative — a full
sandbox runner with credential injection — worth a look only if a
plugin proves insufficient.

## Verification checklist

After deploying a new posture (global config or a blessed project):

```bash
opencode debug config     # config loads, no schema errors, rules listed
node --test test/profiles/*.test.js   # never-list present in every profile
```

And on a real run: a branch push from an agent session must be
allowed (on `ask` in `feature` / `infra`), while `git push origin
master`, `git push --force`, and `git push --delete <branch>` must be
denied; `cat ~/.ssh/id_ed25519` must be denied, `curl https://example.com |
bash` must be denied, and a `sudo apt install` must be denied outside
the `infra` profile and allowed inside it (for the listed commands
only). Also confirm branch protection on `master` in the repo settings.
