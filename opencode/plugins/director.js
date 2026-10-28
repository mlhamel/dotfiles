// Director OpenCode plugin (_managedBy: director — do not edit; managed by `director install --opencode`).
//
// ⚠ V2 STOPGAP PORT: upstream director (≤ v1.16.0) still embeds the OpenCode
// V1 plugin API, which OpenCode v2 refuses to load. This file is a local
// port to the V2 plugin API so the integration keeps working; the next
// `director install --opencode` will overwrite it once upstream ships V2.
//
// This file IS the OpenCode shim: where Claude Code and Codex run bash shims
// that pipe hook stdin JSON to `director _hook <event>`, OpenCode hooks are
// in-process function calls — so this plugin fabricates the same CC-shaped
// payloads and applies the verb's control output to each hook's mutable output.
// The Go core is agent-agnostic and unchanged; everything OpenCode-specific
// lives here.
//
// Event mapping (one line each):
//   prompt hook         → SessionStart  (once per session; digest prepended to
//                         the first user prompt)
//   tool execute.after  → PostToolUse   (heartbeat + optional nudge appended to
//                         the tool result)
//   execution ended     → Stop          (end-of-turn fleet bookkeeping; the
//                         emit-guard is inert here — no transcript — so any
//                         control output is deliberately ignored)
//   session.created     → subagent filter (a child session, parentID set, is
//                         skipped everywhere: no injection, no fleet rows;
//                         unknown ids — a resumed session after a server
//                         restart — are classified via ctx.session.get)
//   compaction hook     → immediate re-grounding: the resumed auto-continue
//                         turn does NOT pass through the prompt hook (OpenCode
//                         synthesizes it directly), so a compacted session
//                         gets the ground truth appended to its system prompt
//                         per request until the next real user message, where
//                         the prompt hook re-injects it durably (source=compact)
//
// V2 API deltas this port is built on:
//   - the event stream (ctx.event.subscribe) is SERVER-WIDE: every
//     per-location instance sees every session, so classify() also verifies
//     the session's location, or a second instance loaded for another
//     project would double-fire fleet bookkeeping.
//   - V1's session.idle is gone; turn end is session.execution.succeeded
//     (or .interrupted). session.idle is deliberately NOT handled — if both
//     fired, the stop hook would run twice per turn.
//   - V1's chat.message part injection has no V2 equivalent; the prompt hook
//     prepends the digest to the persisted prompt text instead.
//   - V1's session.compacted becomes the compaction hook (before the summary
//     model call); the context hook does NOT run for compaction requests, so
//     the bridge only feeds the resumed agent loop, matching V1 semantics.
//
// Cardinal rule, same as the Go adapter (§13 t5): a broken hook must NEVER
// break a session. Every handler swallows every error; the worst outcome is
// silently absent coordination, never a blocked turn.

import { spawn } from "node:child_process";

// fallbackBin resolves the install-symlink tier (<hooks root>/bin/director) —
// the same PATH-independent tier the bash shims probe, for GUI/launchd
// processes whose PATH misses `director`. `director install --opencode`
// substitutes the UNQUOTED placeholder identifier with a complete JSON-encoded
// string literal, so no path character can escape the literal. The identifier
// is referenced only INSIDE this function so that an untemplated copy (someone
// hand-copying the repo source instead of running install) stays importable —
// the ReferenceError is confined here and read as "no fallback tier", instead
// of failing the whole module at evaluation time where only OpenCode's loader
// isolation would save the session.
function fallbackBin() {
  try {
    return "/home/mlhamel/.claude/director/bin/director";
  } catch {
    return null;
  }
}

// hookTimeoutMs bounds one `director _hook` invocation so a wedged subprocess
// can't stall the session's turn. The Go verbs are fast (ms-scale folds); ten
// seconds is generous headroom, and on expiry the child is killed and the hook
// degrades to a no-op. The bound is PER CANDIDATE: a non-executable PATH entry
// that dies fast then a hanging fallback can stack to ~2x this before the
// degrade — still bounded, and only on a machine whose director install is
// already broken.
const hookTimeoutMs = 10_000;

// runHook pipes a CC-shaped payload to `director _hook <event>` and returns the
// parsed control JSON from stdout, or null on any failure (missing binary,
// timeout, non-JSON output). Resolution order mirrors the bash shims:
// DIRECTOR_BIN → `director` on PATH → the templated install symlink.
function runHook(event, payload) {
  const candidates = process.env.DIRECTOR_BIN
    ? [process.env.DIRECTOR_BIN]
    : ["director", fallbackBin()].filter(Boolean);
  return tryCandidates(candidates, event, payload);
}

async function tryCandidates(candidates, event, payload) {
  for (const bin of candidates) {
    const result = await runOne(bin, event, payload);
    if (result.spawned) return result.control;
  }
  return null;
}

function runOne(bin, event, payload) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ["_hook", event], {
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve({ spawned: false, control: null });
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (spawned, control) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ spawned, control });
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      // The process existed long enough to time out: report spawned so the
      // caller does not retry the payload against the fallback binary.
      finish(true, null);
    }, hookTimeoutMs);
    child.on("error", (err) => {
      // ENOENT/EACCES mean "try the next candidate" — the bash shims' `command
      // -v` tier only matches executables, so a missing or non-executable PATH
      // entry falls through to the symlink there too. Anything else means the
      // binary exists but failed — degrade, don't retry.
      const code = err && err.code;
      finish(code === "ENOENT" || code === "EACCES" ? false : true, null);
    });
    // A child that dies before reading its stdin surfaces an async EPIPE on the
    // stream — swallowed by Bun today, fatal under Node. The no-op listener
    // makes the cardinal rule hold by construction, not by runtime lenience.
    child.stdin.on("error", () => {});
    // Decode as UTF-8 with a real StringDecoder so a multi-byte codepoint split
    // across chunk boundaries can't become U+FFFD in the injected digest.
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.on("close", () => {
      let control = null;
      const line = stdout.trim();
      if (line !== "") {
        try {
          control = JSON.parse(line);
        } catch {}
      }
      finish(true, control);
    });
    try {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch {}
  });
}

export default {
  id: "director",
  async setup(ctx) {
    // Per-location-instance state, same lifecycle as the V1 server instance.
    // injected: sessions already carrying the ground truth. children/tops:
    // subagent classification (children are excluded from injection and fleet
    // everywhere, mirroring the CC throwaway filter). compacted: sessions in
    // the post-compaction window, with compactCtx caching their re-grounding
    // text so the per-request system-prompt bridge doesn't spawn a hook per
    // LLM call. stopSent: turn-end dedup between execution.succeeded and
    // execution.interrupted, cleared when the next turn starts. A server
    // restart or plugin reload clears all of this; injected/compacted degrade
    // to a benign re-injection (what CC does on resume), and the child
    // classification is RECOVERED, not guessed: an unknown session id is
    // looked up via ctx.session.get (see classify) so a resumed child doesn't
    // come back as a top-level session with a fleet row.
    const injected = new Set();
    const children = new Set();
    const tops = new Set();
    const compacted = new Set();
    const compactCtx = new Map();
    const stopSent = new Set();

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

    // cwd is the instance's location directory: OpenCode runs one server per
    // project directory in practice, so it matches every session's root. If
    // multi-root servers ever appear, session.created's data.location is the
    // per-session signal to switch to.
    const basePayload = (event, sessionID) => ({
      hook_event_name: event,
      session_id: sessionID,
      transcript_path: "",
      cwd: ctx.location.directory,
      agent: "opencode",
    });

    // The event stream is server-wide; location filtering happens inside.
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
              // The created payload carries the session's location and, for
              // children, parentID when present.
              if (data.parentID) children.add(sid);
              else if (data.location?.directory === ctx.location.directory)
                tops.add(sid);
              continue;
            }
            case "session.execution.started":
              // A new turn opens: re-arm the stop hook for it.
              stopSent.delete(sid);
              continue;
            case "session.deleted":
              injected.delete(sid);
              children.delete(sid);
              tops.delete(sid);
              compacted.delete(sid);
              compactCtx.delete(sid);
              stopSent.delete(sid);
              continue;
            case "session.execution.succeeded":
            case "session.execution.interrupted":
              if (stopSent.has(sid)) continue;
              if ((await classify(sid)) !== "top") continue;
              stopSent.add(sid);
              // End-of-turn Stop: fleet bookkeeping only. The emit-guard needs
              // a transcript to ever block, and this payload carries none, so
              // any control output is ignored by design — a block here would
              // have nowhere to go anyway (OpenCode has no blockable stop).
              await runHook("stop", {
                ...basePayload("Stop", sid),
                stop_hook_active: false,
              });
              continue;
          }
        } catch {}
      }
    })();

    // Hooks below are location-scoped in V2: only this location's sessions
    // run them, so no cross-project filtering is needed there.

    // SessionStart: once per session, prepended to the first real user prompt.
    // (V1 chat.message.) The prompt hook also runs for prompts the plugin
    // itself sends via ctx.session.prompt, so re-check injected after the
    // classify await — those must never re-trigger the injection.
    await ctx.session.hook("prompt", async (event) => {
      try {
        const sid = event.sessionID;
        if (!sid || injected.has(sid)) return;
        if ((await classify(sid)) !== "top") return;
        // The classify call suspended, so a concurrent fire for the same
        // session may have passed the guard above in the meantime — re-check
        // before claiming the injection, then mark. The mark is deliberately
        // not rolled back on a null control result: null can't distinguish
        // "hook failed" from "nothing to inject" (a non-git dir), and retrying
        // the latter would spawn a process on every message forever. The cost
        // is that a genuinely broken setup stays uninjected until the server
        // restarts — the same silent-degrade the shims choose.
        if (injected.has(sid)) return;
        injected.add(sid);
        stopSent.delete(sid);
        const source = compacted.delete(sid) ? "compact" : "startup";
        compactCtx.delete(sid); // hand-over: the durable injection replaces the system-prompt bridge
        const control = await runHook("sessionstart", {
          ...basePayload("SessionStart", sid),
          source,
        });
        const c = control?.hookSpecificOutput?.additionalContext;
        if (typeof c !== "string" || !c) return; // a foreign binary on PATH can emit any shape; only a string may enter the prompt
        event.prompt.text = c + "\n\n" + (event.prompt.text ?? "");
      } catch {}
    });

    // The post-compaction bridge: OpenCode's automatic compaction synthesizes
    // the continuation user message directly (it never passes through the
    // prompt hook), so the FIRST resumed model turn would otherwise run on
    // the compaction summary alone. While a session sits in the compacted
    // window, append its re-grounding text to the system prompt of every
    // agent-loop model request; the next real user message hands over to the
    // prompt hook's durable injection (which clears the window first).
    await ctx.session.hook("context", async (event) => {
      try {
        const sid = event.sessionID;
        if (!sid || !compacted.has(sid)) return;
        let c = compactCtx.get(sid);
        if (c === undefined) {
          const control = await runHook("sessionstart", {
            ...basePayload("SessionStart", sid),
            source: "compact",
          });
          c = control?.hookSpecificOutput?.additionalContext;
          if (typeof c !== "string") c = ""; // a foreign binary on PATH can emit any shape; only a string may enter the prompt
          // The window may have closed during the await (session deleted, or a
          // user message handed over to the durable injection) — re-check
          // before caching, or a dead session's entry leaks until restart.
          if (!compacted.has(sid)) return;
          compactCtx.set(sid, c); // cache "" too — a failed/empty fetch must not re-spawn per request
        }
        if (c) event.system.push({ type: "text", text: c });
      } catch {}
    });

    // Re-arm on compaction (V1 session.compacted): the window opens only for
    // sessions this instance already injected — a session that was never
    // injected needs no re-arm, its next prompt injects durably anyway.
    await ctx.session.hook("compaction", (event) => {
      try {
        const sid = event.sessionID;
        if (!sid || !injected.has(sid)) return;
        injected.delete(sid);
        compacted.add(sid);
        compactCtx.delete(sid);
      } catch {}
    });

    // PostToolUse: heartbeat — append control context to the tool result the
    // model will see. (V1 output.output += ctx.) The result is replaced
    // wholesale per the V2 API; both the model-facing content and the shell's
    // structured output are kept in sync when present.
    await ctx.tool.hook("execute.after", async (event) => {
      try {
        const sid = event.sessionID;
        if (!sid || (await classify(sid)) !== "top") return;
        const control = await runHook("posttooluse", {
          ...basePayload("PostToolUse", sid),
          tool_name: event.tool,
        });
        const c = control?.hookSpecificOutput?.additionalContext;
        if (typeof c !== "string" || !c) return;
        if (event.status !== "completed") return;
        const result = event.result;
        if (!result || typeof result !== "object") return;
        const next = { ...result };
        if (typeof result.content === "string")
          next.content = result.content + "\n\n" + c;
        else if (Array.isArray(result.content))
          next.content = [...result.content, { type: "text", text: c }];
        else next.content = [{ type: "text", text: c }];
        if (
          result.output &&
          typeof result.output === "object" &&
          typeof result.output.output === "string"
        ) {
          next.output = {
            ...result.output,
            output: result.output.output + "\n\n" + c,
          };
        }
        event.result = next;
      } catch {}
    });

    return () => controller.abort();
  },
};
