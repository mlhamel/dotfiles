---
name: progress
description: Report live progress of every running unit of work on this opencode server — background jobs (shells, subagents, images) and active sessions — as one S4-quantified line per item, with optional filtering and deep-dives. Trigger with /progress [<filter>].
---

# /progress — live progress reporter

You are reporting the live progress of everything running on this opencode
server, across every project and terminal. You are strictly read-only: you
never stop, restart, or write to a running item.

Data comes from the local HTTP API through the official CLI, trimmed with jq:

```bash
opencode api get <path>
```

If the CLI fails (no server, unexpected error), reply with one plain line —
"no opencode server reachable, cannot report progress" — and stop. Never
invent or guess status.

## Inventory

Two calls cover everything:

```bash
opencode api get /api/experimental/job
opencode api get /api/session/active
```

- Jobs: shell / subagent / image background jobs, server-wide. Useful fields:
  `kind`, `status`, `title` / `command`, `time.started` (ms epoch), `shellID`,
  `childSessionID`, `sessionID`.
- Active sessions: every session currently executing (a map of sessionID to
  running-type state) anywhere on this machine.

Trim the inventory immediately:

- Drop the session reporting itself: `$OPENCODE_SESSION_ID`.
- Drop any active session whose ID is a _running_ subagent job's
  `childSessionID` — it is reported once, under that job.
- Keep a running shell job's parent session: its foreground activity is
  distinct from the background job, which already has its own line.

Zero items left → one plain line ("nothing is running") and stop.

## One line per item

Emit one S4-quantified line per item, longest-running first:

```text
shell · cargo test -p sv-mcp … · running · elapsed 4m · log /tmp/opencode/playthrough.log
subagent · explore "find endpoints" · running · elapsed 2m · ses_ab3… · last: assistant 1m
session · "Adding sound effects" (build) · elapsed 14m · last: assistant 2m
```

- elapsed: jobs = `now - .time.started/1000`, sessions =
  `now - .time.busy/1000`. Under 2 min report `Ns`, after that `Nm`.
- Include a log path only when the job's command names one (S4 rule: name the
  path so the human can `tail -f` it); otherwise the plain line
  `<kind> · <cmd> · <status> · elapsed <T>`.
- Add `· <done>/<total> <unit>` when a count is reachable through the
  deep-dive greps below (e.g. `grep -c '^test '` on a named log). If it is
  not derivable, leave it out — never guess or fabricate counts.
- A session with no `time.busy` epoch reports `last: <type> <age>` from the
  message probe instead of elapsed.

## Deep-dive

With a `$ARGUMENTS` filter: deep-dive the matched items, only those. Without:
only items whose command names a log file.

### Shell job

Resolve its session's workspace, then read its output window:

```bash
opencode api get /api/session/<sessionID> | jq -r '.data.location.directory'
opencode api get "/api/shell/<shellID>/output?location[directory]=<dir>&limit=80"
```

If the output is empty, the pipeline is buffering: grep the `.log` paths the
command string itself references (e.g. `tee /tmp/opencode/x.log`) for
countable markers, and name the pattern in the line:
`grep -c '^test ' /tmp/opencode/x.log → 214`. Report a count only when the
log/output actually contains a countable marker; when no marker exists, omit
the count entirely — never invent one.

The jobs endpoint carries in-flight jobs only — verified: a job disappears
from it the moment it completes. If a deep-dived job just finished, its
`/api/shell/<shellID>/output` endpoint still answers: cite that final output
as the job's verdict (`shell · <cmd> · finished · <output excerpt or "no output">`).
Never reconstruct a verdict from memory.

### Subagent job

```bash
opencode api get /api/session/<childSessionID>
opencode api get "/api/session/<childSessionID>/message?order=desc&limit=3"
```

Report: title, agent, token totals from `.tokens` — `.tokens.input` and
`.tokens.output` are verified payload fields (a `cost` field is also
exposed); last activity from the newest message (`.type`, `.agent`,
age = `now - .time.created/1000`); when the newest assistant message exposes
a tool call, name it — if it exposes none, omit.

### Active session

Report title and elapsed from `now - .time.busy/1000`, then the same message
probe as a subagent job, adding at most the last-activity line.
A busy session whose transcript is quiet is still busy — do not call it
stalled while its elapsed keeps growing.

## Filtering (`$ARGUMENTS`)

Match case-insensitively against command / title / agent across
the inventory, then:

1. Deep-dive the matches only.
2. No matches → say `No running work matches <filter>`, then list one-liners
   of what IS running. Do not hunt for finished jobs here: the jobs endpoint
   carries in-flight jobs only, so completed items are already gone — report
   a final verdict only for a job that finished during this report (its
   shell-output endpoint still answers), never from stale state.
