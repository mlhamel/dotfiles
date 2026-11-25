// session-classify.js — Shared session classification and server-wide
// event subscription for the plugins that react to session lifecycle
// events (director.js, review-enforcer.js, session-nudger.js).
//
// Before this file, each of the three plugins reimplemented the same
// classify() (child/top/foreign/unknown) and the same ctx.event.subscribe
// loop, and the copies had already diverged. The divergences found while
// extracting it, and the single behaviour kept for each:
//
//   - Turn end is succeeded, interrupted OR failed. review-enforcer
//     already treated a failed turn as a turn end (a turn that died
//     mid-flight must not leave state stuck); director ignored failed
//     turns (no Stop bookkeeping) and session-nudger did not count them
//     toward the spiral bar. The converged rule: a failed turn still
//     ended — it consumed a full context re-send, so it counts toward
//     session length, and fleet bookkeeping records the turn that ran.
//     Behaviour change for director (Stop now fires on failed turns)
//     and session-nudger (failed turns count toward the bar), asserted
//     explicitly by their test suites.
//   - The event loop is guarded twice: a per-event try/catch (a bad
//     event never breaks the loop) AND an outer try/catch around the
//     for-await (a broken event bus never becomes an unhandled
//     rejection). review-enforcer already had both; director and
//     session-nudger only had the inner one.
//   - session.execution.started stays per-plugin: it only re-arms
//     plugin-local dedup state (director's stopSent, the nudger's
//     counted); review-enforcer needs none (its reviewed flag is
//     cleared by new edits). The helper exposes it as an optional
//     started handler.
//   - Cheap local state is checked before classify() everywhere: the
//     async session.get lookup is skipped on duplicate turn-end fires.
//     That ordering lives in each plugin's ended handler, next to the
//     state it guards — the helper cannot own it.
//
// What stays in the plugins: every plugin's own state and action —
// director's injection/fleet sets, the enforcer's dirty/reviewed flags
// and read-only deferral, the nudger's turn counts and bands. The
// helper owns only the classification caches (children/tops) and the
// loop framing. A failed lookup is never cached: a transient error
// costs one skipped beat, not a permanent misclassification. Foreign
// sessions are not cached either (only children and tops are), so a
// session whose location changes is re-checked on its next firing.
//
// Cardinal rule (same as the plugins): a broken helper must NEVER break
// a session. Every handler swallows every error; the worst outcome is
// silently absent coordination, never a blocked turn.
//
// Location: opencode/lib/, not opencode/plugins/ — opencode loads every
// file directly under plugins/ as a plugin, so a helper without a
// default export would log a failed-to-load warning at every startup.
// lib/ is never scanned; plugins import it by relative path, and the
// node:test suites import it the same way.

export function createSessionClassifier(ctx) {
  const children = new Set();
  const tops = new Set();

  // classify resolves a session to "child" | "top" | "foreign" | "unknown",
  // surviving server restarts: the created-event cache first, then one
  // ctx.session.get lookup for an unknown id (cached on success). "foreign"
  // is the V2 addition: the event stream is server-wide, and only the
  // instance whose location matches the session's may act on it. A failed
  // lookup is reported as "unknown", never guessed: every consumer SKIPS
  // its action on unknown and retries on its next firing, because acting
  // on a guess is worse in both directions — injecting the full ground
  // truth into a subagent, or materializing a fleet row for one, pollutes
  // the sibling counts other sessions see. Nothing is cached on failure,
  // so a transient client error costs one skipped beat, not a permanent
  // misclassification.
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

  // noteCreated pre-caches the session.created payload: for children,
  // parentID when present; for top-level sessions, the payload's location
  // against this instance's directory. A foreign location pre-caches
  // nothing — the session is classified on its next firing instead.
  const noteCreated = (data) => {
    const sid = data?.sessionID;
    if (!sid) return;
    if (data.parentID) children.add(sid);
    else if (data.location?.directory === ctx.location.directory) tops.add(sid);
  };

  // forget drops a session's cached classification (session.deleted).
  // The plugin's own state is its own business and is cleaned by its
  // deleted handler, next to the sets it owns.
  const forget = (sid) => {
    children.delete(sid);
    tops.delete(sid);
  };

  // subscribe runs the server-wide event loop and routes each event to
  // the plugin's handlers: started (session.execution.started), ended
  // (session.execution.succeeded, .interrupted or .failed — all three
  // end a turn, see the header), deleted (session.deleted, after the
  // classification cache is dropped). session.created is handled
  // internally: it only maintains the cache, no plugin action runs.
  // Handlers receive (sessionID, eventData); events without a sessionID
  // and unknown event types are skipped. Returns a teardown that aborts
  // the subscription.
  const subscribe = (handlers = {}) => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          try {
            const data = event?.data;
            const sid = data?.sessionID;
            if (!sid) continue;
            switch (event?.type) {
              case "session.created":
                noteCreated(data);
                continue;
              case "session.deleted":
                forget(sid);
                await handlers.deleted?.(sid, data);
                continue;
              case "session.execution.started":
                await handlers.started?.(sid, data);
                continue;
              case "session.execution.succeeded":
              case "session.execution.interrupted":
              case "session.execution.failed":
                await handlers.ended?.(sid, data);
                continue;
            }
          } catch {}
        }
      } catch {}
      // The stream itself (subscribe/iterator/abort) sits outside the
      // per-event catch; a broken event bus must never become an unhandled
      // rejection that takes the server down.
    })();
    return () => controller.abort();
  };

  return { classify, subscribe };
}
