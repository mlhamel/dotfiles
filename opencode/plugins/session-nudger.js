// session-nudger.js — Injects a one-shot nudge when a session's message
// count crosses a new multiple of the spiral bar, steering long threads
// toward /session-handoff + a fresh session (token-optimization skill §3,
// enforced by tooling instead of memory).
//
// Mechanism (all injection, no blocking — same cardinal rule as Director:
// a broken hook must NEVER break a session; every handler swallows errors):
//   session.idle    → end of turn: fetch the session's message count, compute
//                     band floor(count / threshold); a newly crossed band
//                     injects a nudge prompt once (state updated BEFORE
//                     injecting, so a misfiring hook can't loop)
//   session.created → subagent sessions are tracked and never nudged
//   session.deleted → drop tracking state
//
// Band state is in-memory; a restart loses it (benign — an already-long
// session gets at most one re-nudge on its next turn). Each nudge is a
// full turn, so it re-sends the session context once; the nudge text caps
// the reply at two sentences to keep the added cost to the input re-send.
// Opt out: SESSION_NUDGER=0. Tune the bar: SESSION_NUDGER_THRESHOLD.

function threshold() {
  const raw = Number(process.env.SESSION_NUDGER_THRESHOLD)
  if (Number.isInteger(raw) && raw > 0) return raw
  return 50
}

function messageCount(res) {
  const data = res?.data ?? res
  if (Array.isArray(data)) return data.length
  if (data && typeof data === "object") {
    for (const key of ["messages", "items", "data"]) {
      if (Array.isArray(data[key])) return data[key].length
    }
    return Object.keys(data).length
  }
  return 0
}

export const SessionNudgerPlugin = async ({ client }) => {
  if (process.env.SESSION_NUDGER === "0") return {}

  const bar = threshold()
  const children = new Set() // subagent session ids (never nudged)
  const band = new Map() // session id → highest band already nudged

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

  const countMessages = async (sid) => {
    try {
      const res = await client.session.messages({ path: { id: sid } })
      return messageCount(res)
    } catch {
      return 0
    }
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
            children.delete(sid)
            band.delete(sid)
            return
          case "session.idle": {
            if ((await classify(sid)) !== "top") return
            const count = await countMessages(sid)
            const current = Math.floor(count / bar)
            const last = band.get(sid) ?? 0
            if (current <= last) return
            band.set(sid, current)
            try {
              await client.session.prompt({
                path: { id: sid },
                body: {
                  parts: [
                    {
                      type: "text",
                      text:
                        `SESSION LENGTH CHECK: this session has reached ${count} messages (spiral bar: ${bar}). ` +
                        "Long sessions re-send their full history on every turn, so cost grows per turn; healthy sessions average around 8. " +
                        "Recommend to the user: run /session-handoff to checkpoint this thread, then start a fresh session for the next unit of work. " +
                        "Continue here only if the task genuinely needs this context. " +
                        "Answer in one or two sentences — do not start new work from this message.",
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
  }
}
