// session-nudger.js — Injects a one-shot nudge when a session's turn count
// crosses a new multiple of the spiral bar, steering long threads toward
// /session-handoff + a fresh session (token-optimization skill §3,
// enforced by tooling instead of memory).
//
// V2 port notes (from the V1 API):
//   - V1 counted messages via client.session.messages; V2 has no equivalent,
//     so turns are counted in-memory from session.execution.succeeded /
//     .interrupted events instead. One turn ≈ two messages, so the default
//     bar is 25 turns (the V1 default was 50 messages).
//   - V1's session.idle is gone in V2; the execution events above are the
//     turn-end signal. session.idle is deliberately NOT handled, and a
//     counted-per-turn guard (re-armed on execution.started) keeps a
//     succeeded+interrupted double-fire from counting one turn twice.
//   - ctx.event.subscribe() is SERVER-WIDE: every per-location instance sees
//     every session, so classify() also verifies the session's location
//     before nudging, or each loaded instance would send its own nudge.
//
// Mechanism (all injection, no blocking — same cardinal rule as Director:
// a broken hook must NEVER break a session; every handler swallows errors):
//   execution ended   → end of turn: bump the session's turn count, compute
//                       band floor(turns / threshold); a newly crossed band
//                       injects a nudge prompt once (state updated BEFORE
//                       sending, so a misfiring hook can't loop)
//   session.created   → subagent sessions are tracked and never nudged
//   session.deleted   → drop tracking state
//
// Band state is in-memory; a restart loses it (benign — an already-long
// session gets at most one re-nudge on its next turn). Each nudge is a
// full turn, so it re-sends the session context once; the nudge text caps
// the reply at two sentences to keep the added cost to the input re-send.
// Opt out: SESSION_NUDGER=0. Tune the bar: SESSION_NUDGER_THRESHOLD (turns).

function threshold() {
  const raw = Number(process.env.SESSION_NUDGER_THRESHOLD);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return 25;
}

export default {
  id: "session-nudger",
  async setup(ctx) {
    if (process.env.SESSION_NUDGER === "0") return;

    const bar = threshold();
    const children = new Set(); // subagent session ids (never nudged)
    const tops = new Set(); // confirmed top-level sessions in this location
    const turns = new Map(); // session id → completed turn count
    const band = new Map(); // session id → highest band already nudged
    const counted = new Set(); // turn-end dedup (succeeded/interrupted), cleared on execution.started

    // classify resolves a session to "child" | "top" | "foreign" | "unknown".
    // "foreign" covers sessions from other locations sharing the server-wide
    // event stream; only this instance's own location may nudge. Nothing is
    // cached on failure, so a transient client error costs one skipped beat.
    const classify = async (sid) => {
      if (children.has(sid)) return "child";
      if (tops.has(sid)) return "top";
      try {
        const res = await ctx.session.get({ path: { id: sid } });
        const info = res?.data ?? res;
        if (info && typeof info === "object" && "id" in info) {
          if (info.parentID) {
            children.add(sid);
            return "child";
          }
          if (info.location?.directory !== ctx.location.directory)
            return "foreign";
          tops.add(sid);
          return "top";
        }
      } catch {}
      return "unknown";
    };

    const sendNudge = async (sid, count) => {
      try {
        await ctx.session.prompt({
          path: { id: sid },
          body: {
            text:
              `SESSION LENGTH CHECK: this session has completed ${count} turns (spiral bar: ${bar}). ` +
              "Long sessions re-send their full history on every turn, so cost grows per turn; healthy sessions stay well below the bar. " +
              "Recommend to the user: run /session-handoff to checkpoint this thread, then start a fresh session for the next unit of work. " +
              "Continue here only if the task genuinely needs this context. " +
              "Answer in one or two sentences — do not start new work from this message.",
          },
        });
      } catch {}
    };

    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({
        signal: controller.signal,
      })) {
        try {
          const data = event?.data;
          const sid = data?.sessionID;
          if (!sid) continue;
          switch (event?.type) {
            case "session.created": {
              if (data.parentID) children.add(sid);
              else if (data.location?.directory === ctx.location.directory)
                tops.add(sid);
              continue;
            }
            case "session.deleted":
              children.delete(sid);
              tops.delete(sid);
              turns.delete(sid);
              band.delete(sid);
              counted.delete(sid);
              continue;
            case "session.execution.started":
              // A new turn opens: re-arm the turn-end dedup for it.
              counted.delete(sid);
              continue;
            case "session.execution.succeeded":
            case "session.execution.interrupted": {
              if (counted.has(sid)) continue;
              if ((await classify(sid)) !== "top") continue;
              counted.add(sid);
              const count = (turns.get(sid) ?? 0) + 1;
              turns.set(sid, count);
              const current = Math.floor(count / bar);
              const last = band.get(sid) ?? 0;
              if (current <= last) continue;
              band.set(sid, current);
              await sendNudge(sid, count);
              continue;
            }
          }
        } catch {}
      }
    })();

    return () => controller.abort();
  },
};
