---
name: planning
description: Plan-first protocol for non-trivial work — build a visible task-tracker plan before touching code, then execute it step by step with live status updates. Load this skill at the start of every feature, bugfix, refactor, or migration, even when the user did not ask for a plan. Skip it only for trivial one-liners, pure Q&A, and read-only reports.
---

# Planning — plan first, then build

You plan before you act. For any non-trivial task, the first thing you
create is not code — it is a plan in the task tracker, visible to the user.

## When to plan

Plan when the work has more than one step or touches more than one file —
features, bugfixes, refactors, migrations, CI changes, dependency bumps.
Skip planning for trivia (a rename, a one-line formatting fix), pure
questions, and read-only reports; just do or answer those.

## The plan

Before editing anything, verify your understanding with the read tools
(search, read, ls, package manifests) so the plan rests on facts, not
assumptions. Then create the plan in the task tracker:

1. One item per concrete, verifiable step. "Implement payment retry" is
   vague; "add retry with backoff to `payments.create`, covered by
   `test_retry`" is a step.
2. Order items by dependency: understand → change → verify. Verification
   (run the project's tests and linter) is always an explicit item, never
   implied.
3. Surface unknowns as their own items (confirm assumption X, ask the
   user about Y) instead of burying guesses inside steps.

Present the plan and wait for approval when the project rules require it
(this repo's global rules do: anything non-trivial waits for a go-ahead).

## Executing

- Work strictly in plan order; exactly one `in_progress` item at a time.
- Update statuses in real time — mark `in_progress` when you start a step,
  `completed` only when that step is done and verified. Never batch status
  updates at the end.
- New information that changes the plan (a different bug, a blocked step,
  extra needed work)? Revise the tracker immediately and say why. A plan
  that drifted from reality without being updated is worse than no plan.
- Never mark a step complete while its verification failed or was skipped;
  either finish the verification or split the remainder into a new
  `pending` item.

## Wrapping up

When the tracker is complete, report concisely: what shipped, what was
verified and how, and every deviation from the approved plan.
