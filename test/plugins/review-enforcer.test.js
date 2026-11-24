// Tests for plugins/review-enforcer.js.
//
// The plugin is driven through the fake context in mock-context.js: the
// event stream is fed by hand, the hooks are invoked directly, and
// ctx.session.prompt records every gate/nudge instead of sending one.
//
// Conventions: one fresh plugin setup per test (state lives in closures);
// the event loop is asynchronous, so tests waitFor() the prompt they
// expect and only assert absence after a short settle.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import plugin from "../../opencode/plugins/review-enforcer.js";
import {
  createMockContext,
  topSession,
  childSession,
  flush,
  sleep,
  waitFor,
} from "./mock-context.js";

const DIR = "/proj";
const PLAN_DIR = path.join(os.homedir(), ".opencode", "plan");

let teardown;

afterEach(async () => {
  if (teardown) {
    teardown();
    teardown = undefined;
  }
  delete process.env.REVIEW_ENFORCER;
  await flush(2);
});

async function setupEnforcer(ctx) {
  teardown = await plugin.setup(ctx);
  return teardown;
}

function created(sid, location = DIR, parentID = undefined) {
  return {
    type: "session.created",
    data: { sessionID: sid, location: { directory: location }, parentID },
  };
}

function ended(sid, type = "session.execution.succeeded") {
  return { type, data: { sessionID: sid } };
}

async function markDirty(ctx, sid, tool = "edit", file = "/proj/src/app.js") {
  const hook = ctx.hooks.tool.get("execute.after");
  hook({ sessionID: sid, tool, input: { path: file } });
  await flush(2);
}

describe("setup / opt-out", () => {
  test("registers the tool and prompt hooks", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    assert.equal(ctx.hooks.tool.has("execute.after"), true);
    assert.equal(ctx.hooks.session.has("prompt"), true);
    assert.equal(ctx.subscribeCalls, 1);
  });

  test("REVIEW_ENFORCER=0 disables the plugin entirely", async () => {
    process.env.REVIEW_ENFORCER = "0";
    const ctx = createMockContext({ directory: DIR });
    const result = await plugin.setup(ctx);
    assert.equal(result, undefined);
    assert.equal(ctx.hooks.tool.size, 0);
    assert.equal(ctx.hooks.session.size, 0);
    assert.equal(ctx.subscribeCalls, 0);
  });
});

describe("dirty tracking", () => {
  test("edit/write/patch mark the session dirty, read does not", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await markDirty(ctx, "s1", "edit");
    await markDirty(ctx, "s1", "read");
    const promptHook = ctx.hooks.session.get("prompt");
    const event = { sessionID: "s1", prompt: { text: "next?" } };
    await promptHook(event);
    assert.match(event.prompt.text, /unreviewed substantive edits/);
    assert.match(event.prompt.text, /next\?$/);
  });

  test("a clean session gets no prompt nudge", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const event = { sessionID: "s1", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "hello");
  });

  test("writes under ~/.opencode/plan are exempt", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await markDirty(ctx, "s1", "write", path.join(PLAN_DIR, "scratch.md"));
    const event = { sessionID: "s1", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "hello");
  });
});

describe("review gate", () => {
  test("fires once at end of turn while dirty, then clears", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await markDirty(ctx, "s1", "edit");
    ctx.pushEvent(ended("s1"));
    await waitFor(() => ctx.prompts.length === 1);
    assert.match(ctx.prompts[0].text, /^REVIEW GATE:/);
    assert.match(ctx.prompts[0].text, /APPROVE \/ REQUEST CHANGES/);
    assert.equal(ctx.prompts[0].sessionID, "s1");

    ctx.pushEvent(ended("s1"));
    await sleep(50);
    assert.equal(ctx.prompts.length, 1);
  });

  test("a failed turn also ends the dirty stretch", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await markDirty(ctx, "s1", "write");
    ctx.pushEvent(ended("s1", "session.execution.failed"));
    await waitFor(() => ctx.prompts.length === 1);
    assert.match(ctx.prompts[0].text, /^REVIEW GATE:/);
  });

  test("new edits reopen the gate", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await markDirty(ctx, "s1", "edit");
    ctx.pushEvent(ended("s1"));
    await waitFor(() => ctx.prompts.length === 1);
    await markDirty(ctx, "s1", "edit");
    ctx.pushEvent(ended("s1"));
    await waitFor(() => ctx.prompts.length === 2);
  });

  test("no gate without edits", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    ctx.pushEvent(ended("s1"));
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });
});

describe("session classification", () => {
  test("child sessions are never gated", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("kid", DIR, "parent-1"));
    await flush();
    await markDirty(ctx, "kid", "edit");
    ctx.pushEvent(ended("kid"));
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });

  test("foreign sessions (other location) are never gated", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { other: topSession("other", "/elsewhere") },
    });
    await setupEnforcer(ctx);
    await markDirty(ctx, "other", "edit");
    ctx.pushEvent(ended("other"));
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });

  test("unknown sessions (session.get throws) are never gated", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { ghost: new Error("boom") },
    });
    await setupEnforcer(ctx);
    await markDirty(ctx, "ghost", "edit");
    ctx.pushEvent(ended("ghost"));
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });

  test("a child discovered via session.get is cached as a child", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { kid: childSession("kid", DIR) },
    });
    await setupEnforcer(ctx);
    // No created event: classify() must look the session up.
    await markDirty(ctx, "kid", "edit");
    ctx.pushEvent(ended("kid"));
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });
});

describe("read-only agents", () => {
  const readOnly = {
    permissions: [{ action: "edit", resource: "*", effect: "deny" }],
  };
  const editable = { permissions: [] };

  test("a read-only turn defers the gate; the dirty flag survives", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: {
        s1: topSession("s1", DIR, { agent: "ask" }),
      },
      agents: { ask: readOnly, build: editable },
    });
    await setupEnforcer(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await markDirty(ctx, "s1", "edit");

    // Read-only turn ends: no gate, dirty survives.
    ctx.pushEvent(ended("s1"));
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);

    // No nudge for the read-only agent either.
    const event = { sessionID: "s1", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "hello");

    // The same session, now on an editing agent: the gate fires.
    ctx.session._set("s1", topSession("s1", DIR, { agent: "build" }));
    ctx.pushEvent(ended("s1"));
    await waitFor(() => ctx.prompts.length === 1);
    assert.match(ctx.prompts[0].text, /^REVIEW GATE:/);
  });
});
