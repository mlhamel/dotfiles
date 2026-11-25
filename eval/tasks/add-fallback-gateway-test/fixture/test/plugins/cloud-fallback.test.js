// Tests for plugins/cloud-fallback.js.
//
// The retry hook switches an ollama `:cloud` model to the local fallback
// on a cloud-unavailable error and retries the same step; the prompt hook
// switches back when the gateway answers again and the primary model is
// registered. `globalThis.fetch` is stubbed per test — the plugin only
// calls it from the switch-back probe, never on the retry path — so the
// gateway is a fake HTTP endpoint, never localhost:11434.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import plugin from "../../opencode/plugins/cloud-fallback.js";
import { createMockContext, flush, waitFor } from "./mock-context.js";

const CLOUD = { providerID: "ollama", id: "glm-5.3-flash:cloud" };
const LOCAL = { providerID: "ollama", id: "qwen3:4b" };
const GATEWAY = "http://localhost:11434";

let teardown;
let savedFetch;
let fetchCalls;
let savedFallback;
let savedFallbackModel;
let savedGateway;
let savedTimeout;

afterEach(async () => {
  if (teardown) {
    teardown();
    teardown = undefined;
  }
  if (savedFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = savedFetch;
  for (const [key, saved] of [
    ["CLOUD_FALLBACK", savedFallback],
    ["CLOUD_FALLBACK_MODEL", savedFallbackModel],
    ["CLOUD_FALLBACK_GATEWAY", savedGateway],
    ["CLOUD_FALLBACK_TIMEOUT_MS", savedTimeout],
  ]) {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  await flush(2);
});

function saveEnv() {
  savedFallback = process.env.CLOUD_FALLBACK;
  savedFallbackModel = process.env.CLOUD_FALLBACK_MODEL;
  savedGateway = process.env.CLOUD_FALLBACK_GATEWAY;
  savedTimeout = process.env.CLOUD_FALLBACK_TIMEOUT_MS;
}

// Replace globalThis.fetch with a stub that records calls and answers
// with handler(url, init). Returns the recorded calls.
function stubFetch(handler) {
  savedFetch = globalThis.fetch;
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return handler(url, init);
  };
  return fetchCalls;
}

function tagsResponse(names) {
  return {
    ok: true,
    json: async () => ({ models: names.map((name) => ({ name })) }),
  };
}

async function setupFallback(ctx) {
  teardown = await plugin.setup(ctx);
  return teardown;
}

function retryEvent(overrides = {}) {
  return {
    sessionID: "s1",
    agent: "build",
    model: { ...CLOUD },
    error: { type: "provider.network", message: "fetch failed: ECONNREFUSED" },
    attempt: 1,
    decision: { retry: false },
    ...overrides,
  };
}

async function fallBack(ctx) {
  const event = retryEvent();
  await ctx.hooks.session.get("retry")(event);
  assert.deepEqual(event.decision, { retry: true, delay: 500 });
  return event;
}

describe("retry hook", () => {
  test("switches a cloud model to local on a gateway network error and retries", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const event = await fallBack(ctx);
    assert.deepEqual(ctx.switches, [{ sessionID: "s1", model: { ...LOCAL } }]);
    assert.equal(ctx.prompts.length, 1);
    assert.match(ctx.prompts[0].text, /CLOUD FALLBACK/);
    assert.match(ctx.prompts[0].text, /glm-5\.3-flash:cloud/);
    assert.match(ctx.prompts[0].text, /qwen3:4b/);
    assert.equal(event.decision.retry, true);
  });

  test("falls back on a 404 model-not-found error", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const event = retryEvent({
      error: {
        type: "provider.not-found",
        message: "model 'glm-5.3-flash:cloud' not found",
        status: 404,
      },
    });
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: true, delay: 500 });
    assert.deepEqual(ctx.switches, [{ sessionID: "s1", model: { ...LOCAL } }]);
    assert.equal(ctx.prompts.length, 1);
  });

  test("falls back on a 401 auth error", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const event = retryEvent({
      error: { type: "provider.auth", message: "unauthorized", status: 401 },
    });
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: true, delay: 500 });
    assert.equal(ctx.switches.length, 1);
  });

  test("leaves a 429 rate limit to OpenCode's built-in retry", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const event = retryEvent({
      error: {
        type: "provider.rate-limit",
        message: "rate limit exceeded",
        status: 429,
      },
      decision: { retry: true, delay: 2000 },
    });
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: true, delay: 2000 });
    assert.equal(ctx.switches.length, 0);
    assert.equal(ctx.prompts.length, 0);
  });

  test("leaves invalid-request errors alone", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const event = retryEvent({
      error: { type: "provider.invalid-request", message: "bad request" },
    });
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: false });
    assert.equal(ctx.switches.length, 0);
    assert.equal(ctx.prompts.length, 0);
  });

  test("does nothing when the failing model is already local", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const event = retryEvent({ model: { ...LOCAL } });
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: false });
    assert.equal(ctx.switches.length, 0);
    assert.equal(ctx.prompts.length, 0);
  });

  test("does nothing for a non-ollama provider", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const event = retryEvent({
      model: { providerID: "anthropic", id: "claude-sonnet-5-5" },
    });
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: false });
    assert.equal(ctx.switches.length, 0);
  });

  test("a second failure on the local model does not switch again or re-notify", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    const event = retryEvent({ model: { ...LOCAL }, attempt: 2 });
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: false });
    assert.equal(ctx.switches.length, 1);
    assert.equal(ctx.prompts.length, 1);
  });

  test("a throwing switchModel leaves the decision alone and sends no notice", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    ctx.session.switchModel = async () => {
      throw new Error("switch failed");
    };
    await setupFallback(ctx);
    const event = retryEvent();
    await ctx.hooks.session.get("retry")(event);
    assert.deepEqual(event.decision, { retry: false });
    assert.equal(ctx.prompts.length, 0);
  });

  test("CLOUD_FALLBACK_MODEL overrides the fallback target", async () => {
    saveEnv();
    process.env.CLOUD_FALLBACK_MODEL = "ollama/test-local";
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    assert.deepEqual(ctx.switches, [
      { sessionID: "s1", model: { providerID: "ollama", id: "test-local" } },
    ]);
  });

  test("CLOUD_FALLBACK=0 registers no hooks and subscribes to no events", async () => {
    saveEnv();
    process.env.CLOUD_FALLBACK = "0";
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    assert.equal(ctx.hooks.session.size, 0);
    assert.equal(ctx.subscribeCalls, 0);
  });
});

describe("prompt hook (switch-back)", () => {
  test("switches back when the gateway is up and the primary is listed", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    const calls = stubFetch(() =>
      tagsResponse(["glm-5.3-flash:cloud", "qwen3:4b"]),
    );
    const event = { sessionID: "s1", prompt: { text: "continue" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${GATEWAY}/api/tags`);
    assert.deepEqual(ctx.switches[1], { sessionID: "s1", model: { ...CLOUD } });
    assert.match(
      event.prompt.text,
      /^NOTE: the Ollama cloud gateway is reachable again/,
    );
    assert.match(event.prompt.text, /continue$/);
  });

  test("a second prompt after switch-back does not probe again", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    const calls = stubFetch(() =>
      tagsResponse(["glm-5.3-flash:cloud", "qwen3:4b"]),
    );
    const first = { sessionID: "s1", prompt: { text: "continue" } };
    await ctx.hooks.session.get("prompt")(first);
    const second = { sessionID: "s1", prompt: { text: "and more" } };
    await ctx.hooks.session.get("prompt")(second);
    assert.equal(calls.length, 1);
    assert.equal(ctx.switches.length, 2);
    assert.equal(second.prompt.text, "and more");
  });

  test("stays local when the gateway is down, and re-probes on the next message", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    const calls = stubFetch(() => {
      throw new Error("fetch failed");
    });
    const first = { sessionID: "s1", prompt: { text: "continue" } };
    await ctx.hooks.session.get("prompt")(first);
    assert.equal(first.prompt.text, "continue");
    assert.equal(ctx.switches.length, 1);
    const second = { sessionID: "s1", prompt: { text: "and more" } };
    await ctx.hooks.session.get("prompt")(second);
    assert.equal(calls.length, 2);
    assert.equal(ctx.switches.length, 1);
  });

  test("stays local when the gateway is up but the primary is not listed", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    stubFetch(() => tagsResponse(["qwen3:4b"]));
    const event = { sessionID: "s1", prompt: { text: "continue" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "continue");
    assert.equal(ctx.switches.length, 1);
  });

  test("does not probe when the session never fell back", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    const calls = stubFetch(() =>
      tagsResponse(["glm-5.3-flash:cloud", "qwen3:4b"]),
    );
    const event = { sessionID: "s1", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(calls.length, 0);
    assert.equal(event.prompt.text, "hello");
    assert.equal(ctx.switches.length, 0);
  });
});

describe("event stream", () => {
  test("session.deleted drops the fallback state", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    ctx.pushEvent({ type: "session.deleted", data: { sessionID: "s1" } });
    await flush();
    const calls = stubFetch(() =>
      tagsResponse(["glm-5.3-flash:cloud", "qwen3:4b"]),
    );
    const event = { sessionID: "s1", prompt: { text: "continue" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(calls.length, 0);
    assert.equal(event.prompt.text, "continue");
  });

  test("a manual model change clears the fallback state", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    ctx.pushEvent({
      type: "session.model.selected",
      data: {
        sessionID: "s1",
        model: { providerID: "ollama", id: "kimi-k2.7-code:cloud" },
      },
    });
    await flush();
    const calls = stubFetch(() =>
      tagsResponse(["glm-5.3-flash:cloud", "qwen3:4b"]),
    );
    const event = { sessionID: "s1", prompt: { text: "continue" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(calls.length, 0);
    assert.equal(event.prompt.text, "continue");
  });

  test("a model.selected for the fallback model itself keeps the state", async () => {
    saveEnv();
    const ctx = createMockContext({ directory: "/proj" });
    await setupFallback(ctx);
    await fallBack(ctx);
    ctx.pushEvent({
      type: "session.model.selected",
      data: { sessionID: "s1", model: { ...LOCAL } },
    });
    await flush();
    const calls = stubFetch(() =>
      tagsResponse(["glm-5.3-flash:cloud", "qwen3:4b"]),
    );
    const event = { sessionID: "s1", prompt: { text: "continue" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(calls.length, 1);
    assert.deepEqual(ctx.switches[1], { sessionID: "s1", model: { ...CLOUD } });
  });
});
