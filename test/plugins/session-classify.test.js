// Tests for opencode/lib/session-classify.js.
//
// The helper is exercised directly through the fake context in
// mock-context.js: classify() against pre-cached, resumed, foreign and
// unknown sessions (with the session.get call count asserting what is
// cached and what is re-looked-up), and subscribe() against a recording
// handler set, plus two hand-built broken-bus contexts — the helper must
// never reject, whatever the event stream does.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { createSessionClassifier } from "../../opencode/lib/session-classify.js";
import {
  createMockContext,
  topSession,
  childSession,
  flush,
  sleep,
} from "./mock-context.js";

const DIR = "/proj";

let stopEvents;

afterEach(async () => {
  if (stopEvents) {
    stopEvents();
    stopEvents = undefined;
  }
  await flush(2);
});

function created(sid, location = DIR, parentID = undefined) {
  return {
    type: "session.created",
    data: { sessionID: sid, location: { directory: location }, parentID },
  };
}

// Wraps ctx.session.get with a counter; returns the reader.
function countGets(ctx) {
  let n = 0;
  const orig = ctx.session.get.bind(ctx.session);
  ctx.session.get = async (args) => {
    n++;
    return orig(args);
  };
  return () => n;
}

function recorder() {
  const seen = { started: [], ended: [], deleted: [] };
  const handlers = {
    started: (sid) => {
      seen.started.push(sid);
    },
    ended: (sid) => {
      seen.ended.push(sid);
    },
    deleted: (sid) => {
      seen.deleted.push(sid);
    },
  };
  return { seen, handlers };
}

describe("classify", () => {
  test("returns top for a pre-cached top without a lookup", async () => {
    const ctx = createMockContext({ directory: DIR });
    const sessions = createSessionClassifier(ctx);
    const gets = countGets(ctx);
    stopEvents = sessions.subscribe({});
    ctx.pushEvent(created("s1"));
    await flush();
    assert.equal(await sessions.classify("s1"), "top");
    assert.equal(gets(), 0);
  });

  test("returns child for a pre-cached child without a lookup", async () => {
    const ctx = createMockContext({ directory: DIR });
    const sessions = createSessionClassifier(ctx);
    const gets = countGets(ctx);
    stopEvents = sessions.subscribe({});
    ctx.pushEvent(created("kid", DIR, "parent-1"));
    await flush();
    assert.equal(await sessions.classify("kid"), "child");
    assert.equal(gets(), 0);
  });

  test("discovers a resumed top via session.get and caches it", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { s1: topSession("s1", DIR) },
    });
    const sessions = createSessionClassifier(ctx);
    const gets = countGets(ctx);
    assert.equal(await sessions.classify("s1"), "top");
    assert.equal(await sessions.classify("s1"), "top");
    assert.equal(gets(), 1);
  });

  test("discovers a resumed child via session.get and caches it", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { kid: childSession("kid", DIR) },
    });
    const sessions = createSessionClassifier(ctx);
    const gets = countGets(ctx);
    assert.equal(await sessions.classify("kid"), "child");
    assert.equal(await sessions.classify("kid"), "child");
    assert.equal(gets(), 1);
  });

  test("returns foreign for another location and does not cache it", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { other: topSession("other", "/elsewhere") },
    });
    const sessions = createSessionClassifier(ctx);
    const gets = countGets(ctx);
    assert.equal(await sessions.classify("other"), "foreign");
    assert.equal(await sessions.classify("other"), "foreign");
    assert.equal(gets(), 2);
  });

  test("returns unknown when session.get throws, and retries next time", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { ghost: new Error("boom") },
    });
    const sessions = createSessionClassifier(ctx);
    const gets = countGets(ctx);
    assert.equal(await sessions.classify("ghost"), "unknown");
    assert.equal(await sessions.classify("ghost"), "unknown");
    assert.equal(gets(), 2);
  });

  test("returns unknown when session.get returns no session or no id", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { weird: { location: { directory: DIR } } },
    });
    const sessions = createSessionClassifier(ctx);
    assert.equal(await sessions.classify("missing"), "unknown");
    assert.equal(await sessions.classify("weird"), "unknown");
  });

  test("session.deleted forgets the cached classification", async () => {
    const ctx = createMockContext({
      directory: DIR,
      sessions: { s1: topSession("s1", DIR) },
    });
    const sessions = createSessionClassifier(ctx);
    const gets = countGets(ctx);
    stopEvents = sessions.subscribe({});
    ctx.pushEvent(created("s1"));
    await flush();
    assert.equal(await sessions.classify("s1"), "top");
    assert.equal(gets(), 0);
    ctx.pushEvent({ type: "session.deleted", data: { sessionID: "s1" } });
    await flush();
    // Re-classified from scratch: one lookup, still a top.
    assert.equal(await sessions.classify("s1"), "top");
    assert.equal(gets(), 1);
  });
});

describe("subscribe", () => {
  test("routes succeeded, interrupted and failed to ended", async () => {
    const ctx = createMockContext({ directory: DIR });
    const sessions = createSessionClassifier(ctx);
    const { seen, handlers } = recorder();
    stopEvents = sessions.subscribe(handlers);
    for (const type of [
      "session.execution.succeeded",
      "session.execution.interrupted",
      "session.execution.failed",
    ]) {
      ctx.pushEvent({ type, data: { sessionID: "s1" } });
      await flush(3);
    }
    assert.deepEqual(seen.ended, ["s1", "s1", "s1"]);
  });

  test("routes started to started and deleted to deleted", async () => {
    const ctx = createMockContext({ directory: DIR });
    const sessions = createSessionClassifier(ctx);
    const { seen, handlers } = recorder();
    stopEvents = sessions.subscribe(handlers);
    ctx.pushEvent({
      type: "session.execution.started",
      data: { sessionID: "s1" },
    });
    await flush(3);
    ctx.pushEvent({ type: "session.deleted", data: { sessionID: "s1" } });
    await flush(3);
    assert.deepEqual(seen.started, ["s1"]);
    assert.deepEqual(seen.deleted, ["s1"]);
  });

  test("skips events without a sessionID and unknown event types", async () => {
    const ctx = createMockContext({ directory: DIR });
    const sessions = createSessionClassifier(ctx);
    const { seen, handlers } = recorder();
    stopEvents = sessions.subscribe(handlers);
    ctx.pushEvent({ type: "session.execution.succeeded", data: {} });
    ctx.pushEvent({ type: "session.renamed", data: { sessionID: "s1" } });
    await flush(3);
    assert.deepEqual(seen, { started: [], ended: [], deleted: [] });
  });

  test("a throwing ended handler does not break the loop", async () => {
    const ctx = createMockContext({ directory: DIR });
    const sessions = createSessionClassifier(ctx);
    let calls = 0;
    const recorded = [];
    stopEvents = sessions.subscribe({
      ended: async (sid) => {
        calls++;
        if (calls === 1) throw new Error("boom");
        recorded.push(sid);
      },
    });
    ctx.pushEvent({
      type: "session.execution.succeeded",
      data: { sessionID: "s1" },
    });
    await flush(3);
    ctx.pushEvent({
      type: "session.execution.succeeded",
      data: { sessionID: "s1" },
    });
    await flush(3);
    assert.equal(calls, 2);
    assert.deepEqual(recorded, ["s1"]);
  });

  test("a subscribe that throws does not reject", async () => {
    const ctx = {
      location: { directory: DIR },
      event: {
        subscribe() {
          throw new Error("bus down");
        },
      },
      session: {
        async get() {
          return { data: null };
        },
      },
    };
    const sessions = createSessionClassifier(ctx);
    // Passing this test without crashing the runner IS the assertion:
    // the outer catch must swallow the broken bus.
    assert.equal(typeof sessions.subscribe({}), "function");
    await sleep(50);
    assert.equal(await sessions.classify("s1"), "unknown");
  });

  test("an iterator that throws mid-stream does not reject", async () => {
    const ctx = {
      location: { directory: DIR },
      event: {
        subscribe() {
          return (async function* () {
            yield {
              type: "session.execution.succeeded",
              data: { sessionID: "s1" },
            };
            throw new Error("stream broke");
          })();
        },
      },
      session: {
        async get() {
          return { data: null };
        },
      },
    };
    const sessions = createSessionClassifier(ctx);
    const { seen, handlers } = recorder();
    sessions.subscribe(handlers);
    await sleep(50);
    assert.deepEqual(seen.ended, ["s1"]);
  });

  test("teardown stops the loop", async () => {
    const ctx = createMockContext({ directory: DIR });
    const sessions = createSessionClassifier(ctx);
    const { seen, handlers } = recorder();
    const stop = sessions.subscribe(handlers);
    ctx.pushEvent({
      type: "session.execution.succeeded",
      data: { sessionID: "s1" },
    });
    await flush(3);
    assert.deepEqual(seen.ended, ["s1"]);
    stop();
    await sleep(20);
    ctx.pushEvent({
      type: "session.execution.succeeded",
      data: { sessionID: "s1" },
    });
    await flush(3);
    assert.deepEqual(seen.ended, ["s1"]);
  });
});
