---
name: workflow
description: Playbooks for blessing existing repos and scaffolding new projects, including the per-project opencode.json template
---

# Workflow playbooks

## Bless playbook

Bootstrap a repository for agent-driven development. Use when `/bless` is invoked or when starting work in an unblessed repo.

1. **Detect** — identify language, framework, package manager, test runner, linter/formatter. Read manifests (`pyproject.toml`, `package.json`, `Cargo.toml`, `go.mod`, etc.) and CI configs. Don't guess; read.
2. **Plan** — show me what you found and what you intend to create. Wait for approval.
3. **Create** — generate or improve, in this order:
   - `AGENTS.md` (see template below)
   - `opencode.json` with per-project permissions (pick a profile, see below)
   - `.gitignore` if missing (use the language's standard template)
   - `git init` + initial commit only if the directory isn't a repo yet
4. **Verify** — confirm every command documented in AGENTS.md actually runs (build, test, lint). Fix AGENTS.md if anything is wrong.
5. **Report** — summarize what was created and what I should review.

### AGENTS.md template

Adapt to what was detected; drop sections that don't apply:

```markdown
# <project>

One-paragraph description of what this project does.

## Commands

- build: <command>
- test: <command> (single test: <command>)
- lint: <command>
- format: <command>

## Structure

- brief map of the important directories

## Conventions

- language/framework-specific patterns actually observed in this codebase
- gotchas an agent would miss from filenames alone
```

Rules for the template:

- Only document commands you have verified run.
- Conventions must be observed in the actual code, not generic best practices.
- Keep it under ~60 lines; reference other docs instead of duplicating.

### Per-project opencode.json profiles

Pick one profile from `opencode/profiles/` and copy it into the project
as `opencode.json` (never hand-write the permissions array). All three
are strict V2 `permissions` arrays (ordered, last match wins) and all
three carry the same never-list from `docs/threat-model.md` — secrets
(`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.config/gcloud`,
`~/.azure`, `~/.kube`, `~/.docker`, `~/.npmrc`, `~/.netrc`, `*.pem`,
`*.key`, `*.env`) are denied for `read`, `edit` and
`external_directory`; shell denies `sudo *`, `rm *`,
`curl|wget * | bash|sh`, `git push *`, `eval *`. They differ only in
what is allowed around that list:

| Profile | Edits | Shell | Use when |
| ------- | ----- | ----- | -------- |
| `explore.json` | denied | `ask`, read-only allowlist (`git status/diff/log/show`, `ls`, `cat`) | reading an unfamiliar or untrusted repo |
| `feature.json` | `ask` | `ask`, read-only git + the project's test/lint commands | the default: building a feature |
| `infra.json` | `ask` | `ask`, feature allowlist + package managers, `systemctl`, `sysctl`, read-only `docker`, and a short explicit `sudo` allowlist | bootstrap / machine work where sudo is the job |

After copying, replace the `<test command> *` and `<lint command> *`
placeholders with the detected tooling (e.g. `pytest *`, `npm test*`,
`cargo test*`, `ruff *`, `golangci-lint *`). Leave `git commit` on
`ask` and `git push` on `deny`: commits are local and approved one by
one, pushes publish. Verify the generated file with
`opencode debug config`.

Rules for the template:

- `edit` covers write/patch, `shell` replaces the V1 `bash` name, and
  no matching rule defaults to `ask` — so `git commit` / `git push`
  stay on `ask` even without an explicit rule. The old V1 `permission`
  map is still normalized by opencode V2, but new projects should use
  this shape.
- A shell pattern ending in ` *` also matches the bare command
  (`git status *` covers `git status`), per the official V2 docs.
- Do not loosen a never-list rule for a project without saying so in
  the report: the profiles are the enforcement of the threat model,
  not a starting suggestion. If a project genuinely needs one of the
  denied shapes (e.g. `sudo` outside `infra`), say which rule, why,
  and what bounds it.

## New-project playbook

Use when `/new <language> <name>` is invoked, together with the `scaffolding` skill.

1. **Confirm** — restate language, project name, and any constraints back to me.
2. **Scaffold** — use the official scaffolder from the `scaffolding` skill. Never hand-roll project structure.
3. **Baseline** — add `.gitignore`, README, one example test, lint config if the scaffolder doesn't.
4. **Bless** — run the bless playbook above on the fresh project.
5. **Verify** — build and tests pass; commit only if I ask.
