---
description: Update or audit architecture diagrams after code changes
agent: diagrams
---

Maintain the architecture diagrams in docs/diagrams/ so they reflect the current state of this codebase.

$ARGUMENTS

If no arguments were given, update the diagrams for the current uncommitted changes (git diff) and the most recent commits. If the sole argument is "audit", do a full consistency check of the diagrams against the codebase instead of an incremental update: verify every node ID matches a real module/class/function, every edge reflects a real dependency, and nothing in the diagrams is missing from the code.
