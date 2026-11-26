---
name: packaging
description: End-of-task shipping protocol — when a task's work is committed and verified, end with one exact copy-paste command block that pushes the topic branch and opens the PR with a diff-accurate description. Load it whenever the user asks to ship, push, or open the PR, or at the end of any task that produced commits. Skip it for pure Q&A, read-only reports, and work that is not committed yet.
---

# Packaging — end every task with the shipping block

The last artifact of a shipping task is not a summary. It is one exact,
copy-paste-able bash block: push the branch, create the PR, description
included — grounded in what the diff actually contains, not in what the
plan promised.

## When

Produce the block at the end of every task that produced commits, and the
moment the user asks to ship, push, or open the PR. Ship nothing for pure
Q&A, read-only reports, and uncommitted work — a block without a branch
to push is theater.

## The block — one fence, two commands

Emit exactly one bash fence containing:

1. `git push -u origin <branch>` — the dated topic branch
   (`<type>/<slug>-<YYYY-MM-DD>`) the work lives on.
2. `gh pr create --base <base> --head <branch> --title '<title>' --body-file - <<'EOF' … EOF` —
   the full description is piped to stdin. `gh` accepts `--body-file -`,
   so there is no temp file and no separate edit step.

The whole block, in shape (indented, not fenced, so this file itself
stays paste-safe anywhere):

    git push -u origin feat/<slug>-<DATE>

    gh pr create --base master --head feat/<slug>-<DATE> \
      --title '<what shipped, with `code` names in it>' \
      --body-file - <<'EOF'
    ## What & why
    ...
    EOF

- Title in single quotes, always — titles embed backticks, and double
  quotes would try to execute them.
- `--base` and `--head` spelled out explicitly; never let `gh` guess.
- Nothing else rides in the block: no `cd`, no commentary lines, no
  follow-up commands. The user runs it verbatim.

## The description — written against the diff

Read the real changes first (`git diff <base>...<branch> --stat` plus the
interesting hunks). Structure:

- `## What & why` — the problem and the fix, in two sentences.
- One section per changed area: file with (+N/-M), the concrete behavior
  change (four-space-indented code blocks for diagrams or tables).
- `## Tests` — exactly what was run and the results, honest about
  failures and about which failures are pre-existing (verify against the
  base branch, not from memory).
- A trailing commit list of short SHAs.

Hard rule: NO triple backticks inside the heredoc. Fenced code inside the
body collides with every fenced block the command travels inside — chat
renderers, agent transcripts — and breaks markdown escaping on the way
through. Indented code blocks and plain sentences are safe.

## Keeping the block honest

- Ship only after verification passed and the tree is clean.
- If part of the branch already landed (an earlier PR merged the head
  commits, upstream moved), the open PR's diff is only the remainder —
  rewrite the description to the remaining diff and deliver it with
  `gh pr edit <number> --body-file - <<'EOF' … EOF`. A description that
  narrates commits the PR does not contain is wrong history.
- No credentials to push? Say so plainly and hand over the block
  unchanged; the user runs it on a credentialed machine.
