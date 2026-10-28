// review-enforcer.js — Tracks substantive edits per session and enforces a
// cross-model review verdict before the turn can quietly end.
//
// V2 port notes (from the V1 API):
//   - V1's `event` hook (server bus) becomes ctx.event.subscribe(); the
//     subscription is SERVER-WIDE, so every per-location instance of this
//     plugin sees every session. classify() therefore also verifies the
//     session's location before acting, or a second instance loaded for
//     another project would double-fire the gate.
//   - V1's session.idle is gone in V2; turn end is session.execution.succeeded
//     (or .interrupted). session.idle is deliberately NOT handled — if both
//     fired, the gate would send twice.
//   - V1's chat.message part injection has no V2 equivalent; the prompt hook
//     prepends the nudge to the persisted prompt text instead.
//   - ctx.session.get keeps returning Session.Info with parentID, so subagent
//     classification is unchanged.
//
// Mechanism (all injection, no blocking — same cardinal rule as Director:
// a broken hook must NEVER break a session; every handler swallows errors):
//   tool.execute.after  → edit/write/patch marks the session dirty; writes
//                         under ~/.opencode/plan are exempt (the plan
//                         scratchpad, not reviewable work)
//   prompt              → a user message while dirty prepends a nudge
//   execution ended     → end of turn while dirty (and not yet reviewed)
//                         sends the verdict gate as a follow-up prompt;
//                         clears dirty, so it fires once. succeeded,
//                         interrupted AND failed all end a dirty stretch —
//                         a turn that died mid-flight must not leave the
//                         flag stuck, nagging every later message
//   read-only turns     → sessions on an agent whose ruleset carries
//                         edit * → deny (ask, plan) never see the nudge
//                         and never get the gate; the dirty flag survives
//                         their turns and the gate fires at the end of the
//                         first turn an editing agent runs — when a review
//                         demand is actually actionable
//
// Opt-out: set REVIEW_ENFORCER=0 in the environment to disable entirely.
// The gate is advisory by construction — OpenCode has no blockable stop —
// so the "enforcement" is a loud, structured reminder the model must
// answer to, not a hard wall. That is deliberate: a misfiring hard wall
// wedges sessions; a misfiring reminder costs one paragraph of context.

import os from "node:os";

const EDIT_TOOLS = new Set(["edit", "write", "patch", "apply_patch"]);
const PLAN_DIR = `${os.homedir()}/.opencode/plan`;

export default {
  id: "review-enforcer",
  async setup(ctx) {
    if (process.env.REVIEW_ENFORCER === "0") return;

    // Per-location-instance state; a server restart or reload simply loses
    // tracking (benign — the worst case is a missing nudge for in-flight
    // sessions).
    const dirty = new Set(); // sessions with unreviewed substantive edits
    const children = new Set(); // subagent session ids (never gated)
    const tops = new Set(); // confirmed top-level sessions in this location
    const reviewed = new Set(); // sessions whose gate already fired this turn

    // classify resolves a session to "child" | "top" | "foreign" | "unknown".
    // "foreign" is new in V2: the server-wide event stream delivers sessions
    // from every project this shared server hosts, and only the instance
    // whose location matches the session's may act. Nothing is cached on
    // failure, so a transient client error costs one skipped beat, not a
    // permanent misclassification.
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

    // Read-only agents — any agent whose ruleset carries edit * → deny —
    // cannot act on a review demand. Their sessions get no nudge and no
    // gate; the dirty flag survives and the gate fires at the end of the
    // first turn an editing agent runs. Lookups fail open (treated as
    // editable), and the verdict is cached per agent id.
    const readOnlyAgents = new Map();

    const activeAgent = async (sid) => {
      try {
        const res = await ctx.session.get({ path: { id: sid } });
        const info = res?.data ?? res;
        if (info && typeof info === "object" && "id" in info)
          return info.agent ?? null;
      } catch {}
      return null;
    };

    const isReadOnly = async (agentID) => {
      if (!agentID) return false;
      if (readOnlyAgents.has(agentID)) return readOnlyAgents.get(agentID);
      try {
        const res = await ctx.agent.get({ agentID });
        const info = res?.data ?? res;
        const ro =
          Array.isArray(info?.permissions) &&
          info.permissions.some(
            (p) =>
              p?.action === "edit" &&
              p?.resource === "*" &&
              p?.effect === "deny",
          );
        readOnlyAgents.set(agentID, ro);
        return ro;
      } catch {}
      // Fail open, uncached: a transient lookup error is retried next
      // time instead of freezing the verdict.
      return false;
    };

    const sendGate = async (sid) => {
      try {
        await ctx.session.prompt({
          path: { id: sid },
          body: {
            text:
              "REVIEW GATE: This turn made substantive edits but no cross-model review verdict was recorded. " +
              "Before finishing: invoke @review on the changes and report its verdict (APPROVE / REQUEST CHANGES), " +
              "or state explicitly why review is being waived (trivial change, docs-only, user declined). " +
              "Do not claim the work done without one of the two.",
          },
        });
      } catch {}
    };

    // The event stream is server-wide; location filtering happens inside.
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
              case "session.created": {
                // The created payload carries the session's location, so
                // same-location top-level sessions pre-cache without a
                // lookup; child events carry parentID when present.
                if (data.parentID) children.add(sid);
                else if (data.location?.directory === ctx.location.directory)
                  tops.add(sid);
                continue;
              }
              case "session.deleted":
                dirty.delete(sid);
                children.delete(sid);
                tops.delete(sid);
                reviewed.delete(sid);
                continue;
              case "session.execution.succeeded":
              case "session.execution.interrupted":
              case "session.execution.failed": {
                if (!dirty.has(sid) || reviewed.has(sid)) continue;
                if ((await classify(sid)) !== "top") continue;
                // Read-only turns defer: keep the flag, and the gate fires
                // when a turn run by an editing agent ends.
                if (await isReadOnly(await activeAgent(sid))) continue;
                // Fire once per dirty stretch: clear before sending so a
                // misfiring hook can't loop the gate.
                dirty.delete(sid);
                reviewed.add(sid);
                await sendGate(sid);
                continue;
              }
            }
          } catch {}
        }
      } catch {}
      // The stream itself (subscribe/iterator/abort) sits outside the
      // per-event catch; a broken event bus must never become an unhandled
      // rejection that takes the server down.
    })();

    // Hooks are location-scoped in V2: only this location's sessions run
    // them, so no cross-project filtering is needed here.

    const hookRegistrations = []; // disposed on unload (hot reloads re-run setup)

    hookRegistrations.push(
      await ctx.tool.hook("execute.after", (event) => {
        try {
          if (!EDIT_TOOLS.has(event?.tool)) return;
          const sid = event?.sessionID;
          if (!sid) return;
          const path =
            event?.input?.path ?? event?.input?.file_path ?? event?.input?.filename;
          if (typeof path === "string" && path.startsWith(`${PLAN_DIR}/`))
            return;
          dirty.add(sid);
          reviewed.delete(sid); // new edits reopen the gate
        } catch {}
      }),
    );

    hookRegistrations.push(
      await ctx.session.hook("prompt", async (event) => {
        try {
          const sid = event?.sessionID;
          if (!sid || !dirty.has(sid)) return;
          // Read-only sessions are exempt: a question is not work, and the
          // gate is deferred until an editing turn ends.
          if (await isReadOnly(await activeAgent(sid))) return;
          // Nudge: the user sent a new message while edits from the previous
          // stretch remain unreviewed. Prepended to the prompt text (V2's
          // prompt hook edits become the canonical user input).
          event.prompt.text =
            "NOTE: This session has unreviewed substantive edits from earlier. " +
            "Before acting on the new request, consider running @review on the outstanding changes " +
            "(or note why review is not applicable).\n\n" +
            (event.prompt.text ?? "");
        } catch {}
      }),
    );

    return () => {
      controller.abort();
      for (const reg of hookRegistrations) {
        try {
          Promise.resolve(reg?.dispose?.()).catch(() => {});
        } catch {}
      }
    };
  },
};
