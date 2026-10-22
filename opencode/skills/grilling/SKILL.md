---
name: grilling
description: Interview the user about an idea, plan, or decision when loaded by grill-me or when the user explicitly asks to be grilled or interviewed to stress-test their thinking.
license: MIT
---

# Grilling

Interview the user until you reach a shared understanding. Map this as a
**design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose
prerequisites are already settled: the questions you can ask now without
guessing at answers you haven't heard yet. Ask the whole frontier in one round:
number each question and give your recommended answer. Then wait for the user's
answers before the next round.

Format a round like so:

```text
**Q1 — <question title>**: <question body, including choices where useful>

Recommended answer: <your recommendation and its reasoning>

---

**Q2 — <question title>**: <question body, including choices where useful>

Recommended answer: <your recommendation and its reasoning>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the
frontier outward and unblock questions that depended on them. Recompute the
frontier and ask the next round. A question whose answer depends on another
question still open in this round belongs to a later round, not this one.

Finding facts is your job, never the user's. When a frontier question needs a
fact from the environment (filesystem, tools, etc.), look it up with read-only
tools or delegate read-only exploration to a subagent if available. A running
exploration is an unsettled prerequisite: only questions downstream of it need
to wait; ask the rest of the frontier now. If the fact cannot be verified,
state the uncertainty rather than guessing. The decisions are the user's:
put each to them and wait.

Treat "I don't know" as a real answer. If a question needs evidence from a
prototype or experiment, explain what would resolve it rather than repeatedly
rephrasing it. Ask whether to pause or narrow the scope; do not build anything
without permission.

Keep the interview in the conversation. Do not write files, create a workspace,
or generate plan documents. The session is done when the frontier is empty:
every branch of the agreed scope visited, nothing left silently assumed.
Summarize the decisions and remaining uncertainties in chat, then ask the user
to confirm you have reached a shared understanding. Do not implement anything
unless the user separately asks you to.

Adapted from [Matt Pocock's grilling skill](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/grilling/SKILL.md)
at commit `5beb35b040e3de97e54fa9e386d7e42d15c295c2`.
See [LICENSE](LICENSE) for the upstream MIT license.
