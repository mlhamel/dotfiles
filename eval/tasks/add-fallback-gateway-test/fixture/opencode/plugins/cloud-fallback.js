// cloud-fallback.js — Automatic fallback to a local model when the Ollama
// cloud tier is unreachable, and switch-back when it recovers.
//
// Why a plugin, not config: opencode 2.3.0 has no native fallback chain.
// The only built-in fallback is the catalog default ("the configured model
// becomes the catalog default when it is enabled and its provider is
// available. Otherwise, OpenCode falls back to the newest available
// supported model" — opencode.ai/docs/models), which says nothing about
// per-failure behaviour. The V2 plugin API provides the pieces instead
// (opencode.ai/docs/build/plugins/server):
//   - ctx.session.hook("retry", …) runs after OpenCode classifies a
//     provider failure and proposes its policy, before any retry is
//     scheduled; the hook may make a terminal failure retryable by
//     setting event.decision = { retry: true, delay }.
//   - ctx.session.switchModel({ sessionID, model }) changes the model
//     used by subsequent requests.
// This plugin wires the two together, following the same pattern as the
// community failover plugins (opencode-model-failover,
// opencode-auto-fallback) — implemented locally, zero dependencies,
// instead of taking an npm dependency for one behaviour.
//
// Mechanism (all injection, no blocking — same cardinal rule as Director
// and the other plugins: a broken hook must NEVER break a session; every
// handler swallows errors):
//   retry               → a failed call on an ollama `:cloud` model whose
//                         error reads as cloud-unavailable (gateway down,
//                         model not registered / not signed in) switches
//                         the session to the local fallback model and
//                         retries the same step; a one-shot notice prompt
//                         tells the user. Rate limits (429) and other
//                         non-cloud errors are left to OpenCode's built-in
//                         retry — this plugin does not touch them.
//   prompt              → on the next user message, a fallen-back session
//                         probes the gateway (GET /api/tags, 2s timeout):
//                         if the primary cloud model is listed again, the
//                         session switches back and a note is prepended to
//                         the prompt. Otherwise it stays local, silently.
//   session.model.selected → a manual model change while fallen back
//                         clears the fallback state, so the plugin never
//                         yanks a session back against the user's choice.
//   session.deleted     → drop tracking state.
//
// State is in-memory; a restart loses it (benign — a session that was on
// the fallback restarts on the configured cloud default anyway, and the
// retry hook re-falls-back if the cloud is still down).
//
// Opt out: CLOUD_FALLBACK=0. Tune: CLOUD_FALLBACK_MODEL (default
// ollama/qwen3:4b), CLOUD_FALLBACK_GATEWAY (default http://localhost:11434),
// CLOUD_FALLBACK_TIMEOUT_MS (default 2000).

const FALLBACK_MODEL_DEFAULT = "ollama/qwen3:4b";
const GATEWAY_DEFAULT = "http://localhost:11434";
const TIMEOUT_MS_DEFAULT = 2000;
const RETRY_DELAY_MS = 500;

// "provider/id" → { providerID, id }; a bare id defaults to the ollama provider.
function parseModelRef(raw, fallback) {
  const value = (raw ?? "").trim() || fallback;
  const slash = value.indexOf("/");
  if (slash <= 0) return { providerID: "ollama", id: value };
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) };
}

function parseTimeoutMs(raw, fallback) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const isCloudModel = (model) =>
  model?.providerID === "ollama" &&
  typeof model?.id === "string" &&
  model.id.endsWith(":cloud");

// Statuses that mean "the cloud cannot serve this model right now":
// auth / not-registered / quota on the cloud side, or a gateway error.
// 429 is deliberately absent — a rate limit is transient, and OpenCode's
// built-in retry already handles it; switching models on a 429 would
// burn the local model for a failure the cloud would absorb on retry.
const CLOUD_UNAVAILABLE_STATUSES = new Set([401, 402, 403, 404, 502, 503, 504]);

const CLOUD_UNAVAILABLE_TEXT =
  /econnrefused|econnreset|econnaborted|enotfound|etimedout|fetch failed|network|socket hang up|connection (refused|reset|aborted|closed)|timed? ?out|model .* not found|not found|unauthori[sz]ed|unauthenticated|signin|sign-in|sign in|no such model|does not exist|service unavailable|bad gateway|gateway timeout/i;

function isCloudUnavailable(error) {
  if (!error || typeof error !== "object") return false;
  if (CLOUD_UNAVAILABLE_STATUSES.has(error.status)) return true;
  const text = `${error.type ?? ""} ${error.message ?? ""}`.toLowerCase();
  return CLOUD_UNAVAILABLE_TEXT.test(text);
}

function fallbackNotice(primary, fallback, error) {
  const reason = error?.status
    ? `HTTP ${error.status}`
    : String(error?.message ?? "unreachable")
        .split("\n")[0]
        .slice(0, 120);
  return (
    `CLOUD FALLBACK: the cloud model ${primary.providerID}/${primary.id} is unreachable (${reason}), ` +
    `so this session switched to the local model ${fallback.providerID}/${fallback.id}. ` +
    `Work continues locally; the cloud model will be retried on the next user message. ` +
    `Answer in one sentence and continue the interrupted work.`
  );
}

// True when the gateway answers and the primary model is registered there
// again. /api/tags is the inventory behind `ollama list`, which shows
// registered cloud manifests — so a missing name means "not signed in"
// or "not registered", not just "gateway down". Any failure (no fetch,
// timeout, non-2xx, unparsable body) means "stay local": this is a
// probe, never a gate, and a wrong "yes" self-corrects — the next failed
// call re-triggers the retry hook and falls back again.
async function cloudModelAvailable(gateway, timeoutMs, primary) {
  try {
    if (typeof globalThis.fetch !== "function") return false;
    const res = await globalThis.fetch(`${gateway}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res?.ok) return false;
    const data = await res.json();
    const names = (data?.models ?? [])
      .map((m) => m?.name)
      .filter((n) => typeof n === "string");
    return names.includes(primary.id);
  } catch {
    return false;
  }
}

export default {
  id: "cloud-fallback",
  async setup(ctx) {
    if (process.env.CLOUD_FALLBACK === "0") return;

    const fallback = parseModelRef(
      process.env.CLOUD_FALLBACK_MODEL,
      FALLBACK_MODEL_DEFAULT,
    );
    const gateway = (
      process.env.CLOUD_FALLBACK_GATEWAY ?? GATEWAY_DEFAULT
    ).replace(/\/+$/, "");
    const timeoutMs = parseTimeoutMs(
      process.env.CLOUD_FALLBACK_TIMEOUT_MS,
      TIMEOUT_MS_DEFAULT,
    );

    // session id → { primary: { providerID, id } } for sessions currently
    // running on the fallback model. In-memory only; a restart loses it.
    const fallenBack = new Map();

    const sendNotice = async (sid, text) => {
      try {
        await ctx.session.prompt({
          path: { id: sid },
          body: { text },
        });
      } catch {}
    };

    const onRetry = async (event) => {
      try {
        const sid = event?.sessionID;
        const model = event?.model;
        if (!sid || !model) return;
        if (fallenBack.has(sid)) return; // already on the fallback
        if (!isCloudModel(model)) return;
        if (!isCloudUnavailable(event?.error)) return;
        await ctx.session.switchModel({ sessionID: sid, model: fallback });
        // Record BEFORE notifying: a misfiring notice can't re-trigger a switch.
        fallenBack.set(sid, {
          primary: { providerID: model.providerID, id: model.id },
        });
        event.decision = { retry: true, delay: RETRY_DELAY_MS };
        await sendNotice(sid, fallbackNotice(model, fallback, event?.error));
      } catch {}
    };

    const onPrompt = async (event) => {
      try {
        const sid = event?.sessionID;
        const state = sid && fallenBack.get(sid);
        if (!state) return; // normal case: no probe, no cost
        if (!(await cloudModelAvailable(gateway, timeoutMs, state.primary)))
          return;
        await ctx.session.switchModel({ sessionID: sid, model: state.primary });
        fallenBack.delete(sid);
        event.prompt.text =
          `NOTE: the Ollama cloud gateway is reachable again and ${state.primary.providerID}/${state.primary.id} is registered — ` +
          `this session switched back from the local fallback ${fallback.providerID}/${fallback.id} to ${state.primary.providerID}/${state.primary.id}. ` +
          `Continue the work; no action needed.\n\n` +
          (event.prompt.text ?? "");
      } catch {}
    };

    const hookRegistrations = []; // disposed on unload (hot reloads re-run setup)
    hookRegistrations.push(
      await ctx.session.hook("retry", onRetry, { providerID: "ollama" }),
    );
    hookRegistrations.push(await ctx.session.hook("prompt", onPrompt));

    // The event stream is server-wide, but the map only ever holds
    // sessions that fell back through this instance's (location-scoped)
    // retry hook, so membership is the filter — no location check needed.
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
              case "session.deleted":
                fallenBack.delete(sid);
                continue;
              case "session.model.selected": {
                const state = fallenBack.get(sid);
                if (!state) continue;
                const selected = data?.model?.id;
                if (
                  selected &&
                  selected !== fallback.id &&
                  selected !== state.primary.id
                ) {
                  // The user (or something else) picked a third model:
                  // don't yank the session back against that choice.
                  fallenBack.delete(sid);
                }
                continue;
              }
            }
          } catch {}
        }
      } catch {}
      // The stream itself sits outside the per-event catch; a broken event
      // bus must never become an unhandled rejection that takes the server down.
    })();

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
