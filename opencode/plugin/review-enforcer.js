// review-enforcer.js — Tracks substantive edits per session and enforces a
// cross-model review verdict before the turn can quietly end.
//
// Mechanism (all injection, no blocking — same cardinal rule as Director:
// a broken hook must NEVER break a session; every handler swallows errors):
//   tool.execute.after  → edit/write/apply_patch marks the session dirty
//   chat.message        → a user message while dirty injects a synthetic
//                         part: run @review before continuing
//   session.idle        → end of turn while dirty (and not yet reviewed)
//                         injects the verdict gate into the last assistant
//                         tool output; clears dirty, so it fires once
//
// Opt-out: set REVIEW_ENFORCER=0 in the environment to disable entirely.
// The gate is advisory by construction — OpenCode has no blockable stop —
// so the "enforcement" is a loud, structured reminder the model must
// answer to, not a hard wall. That is deliberate: a misfiring hard wall
// wedges sessions; a misfiring reminder costs one paragraph of context.

const EDIT_TOOLS = new Set(["edit", "write", "apply_patch"])

// verdictSeen scans a tool output / message text for an explicit verdict or
// waiver. Loose on purpose: model phrasing varies, false negatives (missed
// verdicts) only re-nudge, false positives are near-impossible given the
// token specificity.
function verdictSeen(text) {
  if (typeof text !== "string") return false
  const t = text.toUpperCase()
  return (
    t.includes("APPROVE") ||
    t.includes("REQUEST CHANGES") ||
    t.includes("REVIEW WAIVED") ||
    t.includes("REVIEW: SKIPPED") ||
    t.includes("@REVIEW") ||
    t.includes("/REVIEW")
  )
}

export const ReviewEnforcerPlugin = async ({ client }) => {
  if (process.env.REVIEW_ENFORCER === "0") return {}

  // Per-server-instance state; a restart simply loses tracking (benign —
  // the worst case is a missing nudge for in-flight sessions).
  const dirty = new Set() // sessions with unreviewed substantive edits
  const children = new Set() // subagent session ids (never gated)
  const reviewed = new Set() // sessions whose gate already fired this turn

  const classify = async (sid) => {
    if (children.has(sid)) return "child"
    try {
      const res = await client.session.get({ path: { id: sid } })
      const info = res?.data ?? res
      if (info && typeof info === "object" && "id" in info && info.parentID) {
        children.add(sid)
        return "child"
      }
    } catch {}
    return "top"
  }

  return {
    event: async ({ event }) => {
      try {
        const sid = event?.properties?.sessionID ?? event?.properties?.info?.id
        if (!sid) return
        switch (event?.type) {
          case "session.created": {
            const id = event.properties?.info?.id
            if (id && event.properties?.info?.parentID) children.add(id)
            return
          }
          case "session.deleted":
            dirty.delete(sid)
            children.delete(sid)
            reviewed.delete(sid)
            return
          case "session.idle": {
            if (!dirty.has(sid) || reviewed.has(sid)) return
            if ((await classify(sid)) !== "top") return
            // Fire once per dirty stretch: clear before injecting so a
            // misfiring hook can't loop the gate.
            dirty.delete(sid)
            reviewed.add(sid)
            try {
              await client.prompt.add({
                path: { id: sid },
                body: {
                  parts: [
                    {
                      type: "text",
                      text:
                        "REVIEW GATE: This turn made substantive edits but no cross-model review verdict was recorded. " +
                        "Before finishing: invoke @review on the changes and report its verdict (APPROVE / REQUEST CHANGES), " +
                        "or state explicitly why review is being waived (trivial change, docs-only, user declined). " +
                        "Do not claim the work done without one of the two.",
                    },
                  ],
                },
              })
            } catch {}
            return
          }
        }
      } catch {}
    },

    "tool.execute.after": async (input, output) => {
      try {
        if (!EDIT_TOOLS.has(input.tool)) return
        const sid = input.sessionID
        if (!sid) return
        dirty.add(sid)
        reviewed.delete(sid) // new edits reopen the gate
      } catch {}
    },

    "chat.message": async (input, output) => {
      try {
        const sid = input.sessionID
        if (!sid || !dirty.has(sid)) return
        // Nudge: the user sent a new message while edits from the previous
        // stretch remain unreviewed. Synthetic part, prepended like
        // Director's digest injection.
        output.parts.push({
          id: "prt_reviewnudge" + Math.random().toString(36).slice(2, 14),
          sessionID: sid,
          messageID: output.message.id,
          type: "text",
          synthetic: true,
          text:
            "NOTE: This session has unreviewed substantive edits from earlier. " +
            "Before acting on the new request, consider running @review on the outstanding changes " +
            "(or note why review is not applicable).",
        })
      } catch {}
    },
  }
}
