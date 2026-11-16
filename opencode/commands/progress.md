---
description: Report live progress of every running unit of work on this opencode server — background jobs (shells, subagents, images) and active sessions — as one S4-quantified line per item; an optional argument filters and deep-dives the matches.
---

Load the `progress` skill and follow it exactly. `$ARGUMENTS` is an optional filter: when present, take the inventory first, then deep-dive only the running (or recently finished) items matching it; when absent, keep it to the one-line-per-item inventory plus cheap deep-dives.
