---
description: Checkpoint the current agent conversation into an Obsidian session note — flush any un-recorded decisions and open-items, then write a handoff with concrete next steps. Use when PAUSING a session you will resume, or when wrapping up a conversation. If no session was started, this will create one first.
---

You are checkpointing THIS conversation into a durable Obsidian session note so that a future session — you after a context reset, or another agent — can pick up exactly where you left off. Everything not in the session note is lost.

**If no session has been started yet** (no session_id was returned by an earlier `init` call), start one now:

```bash
python3 "/home/mlhamel/Dropbox/obsidian/general/.opencode/skills/decision-log/log_session.py" init \
  --vault "/home/mlhamel/Dropbox/obsidian/general" \
  --project "<infer a short project name from the conversation>" \
  --topic "<infer a short topic from the conversation>" \
  --links "<comma-separated vault note titles this session relates to, if any>"
```

Parse the `RESULT:` line for the `session_id`.

**Then, flush this session's durable items** — emit each as its own entry, capturing everything important from the conversation that has NOT already been logged:

1. Every decision made → `--type decision`
2. Every open loop / deferred follow-up → `--type open-item` (use `--risk escalate` only when it needs the human)
3. Every important observation or context note → `--type note`

```bash
python3 "/home/mlhamel/Dropbox/obsidian/general/.opencode/skills/decision-log/log_session.py" emit \
  --vault "/home/mlhamel/Dropbox/obsidian/general" \
  --session-id "<session_id>" \
  --type <decision|open-item|note> \
  --area "<short area tag, e.g. architecture, benchmarking>" \
  --body "<the full text of the decision/open-item/note — include the WHY, not just the WHAT>" \
  [--risk escalate] \
  [--refs "D-01,O-02"]
```

Do this for every item. Be thorough — a decision not logged is a decision a future session will re-litigate.

**Finally, write the handoff:**

```bash
python3 "/home/mlhamel/Dropbox/obsidian/general/.opencode/skills/decision-log/log_session.py" handoff \
  --vault "/home/mlhamel/Dropbox/obsidian/general" \
  --session-id "<session_id>" \
  --status <paused|complete> \
  --next-steps "<the 3-5 concrete next steps, in order, that a fresh session should take — include any gotchas, dead ends (tried X, failed because Y), and in-flight state>"
```

Use `--status paused` if the work is incomplete and you will resume. Use `--status complete` if the task is finished.

**After running, confirm to the user:**

1. The session ID and note path
2. Which decisions, open-items, and notes were logged (list the entry IDs)
3. The handoff status and next steps
4. Whether anything important from the conversation could NOT be reliably captured — so the user can fill the gap before context is lost
