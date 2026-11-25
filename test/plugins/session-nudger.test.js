// Tests for plugins/session-nudger.js.
//
// The spiral bar is lowered to 2 turns via SESSION_NUDGER_THRESHOLD so
// bands are reachable without 25 turns; the threshold is read once at
// setup, so it is set before each setup call and restored after.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import plugin from "../../opencode/plugins/session-nudger.js";
import {
  createMockContext,
  topSession,
  flush,
  sleep,
  waitFor,
} from "./mock-context.js";

const DIR = "/proj";

let teardown;

afterEach(async () => {
  if (teardown) {
    teardown();
    teardown = undefined;
  }
  delete process.env.SESSION_NUDGER;
  delete process.env.SESSION_NUDGER_THRESHOLD;
  await flush(2);
});

async function setupNudger(ctx) {
  process.env.SESSION_NUDGER_THRESHOLD = "2";
  teardown = await plugin.setup(ctx);
  return teardown;
}

function created(sid, location = DIR, parentID = undefined) {
  return {
    type: "session.created",
    data: { sessionID: sid, location: { directory: location }, parentID },
  };
}

// One completed turn: started re-arms the dedup, succeeded counts it.
async function turn(ctx, sid, type = "session.execution.succeeded") {
  ctx.pushEvent({
    type: "session.execution.started",
    data: { sessionID: sid },
  });
  await flush(3);
  ctx.pushEvent({ type, data: { sessionID: sid } });
  await flush(5);
}

async function top(ctx, sid = "s1") {
  ctx.pushEvent(created(sid));
  await flush();
}

describe("setup / opt-out", () => {
  test("SESSION_NUDGER=0 disables the plugin entirely", async () => {
    process.env.SESSION_NUDGER = "0";
    const ctx = createMockContext({ directory: DIR });
    const result = await plugin.setup(ctx);
    assert.equal(result, undefined);
    assert.equal(ctx.subscribeCalls, 0);
  });
});

describe("bands", () => {
  test("no nudge below the bar", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    await top(ctx);
    await turn(ctx, "s1");
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });

  test("nudges once when the first band is crossed", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    await top(ctx);
    await turn(ctx, "s1");
    await turn(ctx, "s1");
    await waitFor(() => ctx.prompts.length === 1);
    assert.match(ctx.prompts[0].text, /SESSION LENGTH CHECK/);
    assert.match(ctx.prompts[0].text, /completed 2 turns \(spiral bar: 2\)/);
    assert.match(ctx.prompts[0].text, /\/session-handoff/);
    assert.match(ctx.prompts[0].text, /one or two sentences/);
  });

  test("no re-nudge inside the same band, re-nudge at the next band", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    await top(ctx);
    await turn(ctx, "s1");
    await turn(ctx, "s1");
    await waitFor(() => ctx.prompts.length === 1);
    await turn(ctx, "s1");
    await sleep(50);
    assert.equal(ctx.prompts.length, 1);
    await turn(ctx, "s1");
    await waitFor(() => ctx.prompts.length === 2);
    assert.match(ctx.prompts[1].text, /completed 4 turns/);
  });

  test("an interrupted turn counts like a succeeded one", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    await top(ctx);
    await turn(ctx, "s1", "session.execution.interrupted");
    await turn(ctx, "s1", "session.execution.interrupted");
    await waitFor(() => ctx.prompts.length === 1);
  });

  test("a failed turn counts like a succeeded one", async () => {
    // Deliberate convergence (see lib/session-classify.js): a failed turn
    // still ran and consumed a full context re-send, so it counts toward
    // the bar — director ignored failed turns and this plugin did too
    // before the shared helper.
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    await top(ctx);
    await turn(ctx, "s1", "session.execution.failed");
    await turn(ctx, "s1", "session.execution.failed");
    await waitFor(() => ctx.prompts.length === 1);
  });

  test("a double turn-end without a new started counts once", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    await top(ctx);
    ctx.pushEvent({
      type: "session.execution.started",
      data: { sessionID: "s1" },
    });
    await flush(3);
    ctx.pushEvent({
      type: "session.execution.succeeded",
      data: { sessionID: "s1" },
    });
    await flush(5);
    ctx.pushEvent({
      type: "session.execution.succeeded",
      data: { sessionID: "s1" },
    });
    await flush(5);
    // One counted turn: still below the bar of 2, so no nudge.
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
    // A real second turn crosses the bar.
    await turn(ctx, "s1");
    await waitFor(() => ctx.prompts.length === 1);
  });
});

describe("session classification", () => {
  test("child sessions are never nudged", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    ctx.pushEvent(created("kid", DIR, "parent-1"));
    await flush();
    await turn(ctx, "kid");
    await turn(ctx, "kid");
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });

  test("foreign sessions (other location) are never nudged", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { other: topSession("other", "/elsewhere") },
    });
    await setupNudger(ctx);
    await turn(ctx, "other");
    await turn(ctx, "other");
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });

  test("session.deleted drops the turn count", async () => {
    const ctx = createMockContext({ directory: DIR });
    await setupNudger(ctx);
    await top(ctx);
    await turn(ctx, "s1");
    ctx.pushEvent({ type: "session.deleted", data: { sessionID: "s1" } });
    await flush();
    await top(ctx);
    await turn(ctx, "s1");
    await sleep(50);
    assert.equal(ctx.prompts.length, 0);
  });
});
