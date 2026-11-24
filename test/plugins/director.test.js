// Tests for plugins/director.js (the OpenCode V2 shim).
//
// runHook() shells out to the Director binary; the tests point
// DIRECTOR_BIN at a stub script that answers with a canned control
// payload, so no real Director install is needed. The hardcoded
// fallback path and the 10s hook timeout are NOT covered here — see
// test/README.md.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import plugin from "../../opencode/plugins/director.js";
import {
  createMockContext,
  topSession,
  flush,
  waitFor,
} from "./mock-context.js";

const DIR = "/proj";
const DIGEST = "DIRECTOR DIGEST";

let teardown;
let stubDir;
let savedDirectorBin;

afterEach(async () => {
  if (teardown) {
    teardown();
    teardown = undefined;
  }
  if (savedDirectorBin === undefined) delete process.env.DIRECTOR_BIN;
  else process.env.DIRECTOR_BIN = savedDirectorBin;
  if (stubDir) {
    fs.rmSync(stubDir, { recursive: true, force: true });
    stubDir = undefined;
  }
  await flush(2);
});

function makeStub(body) {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "dotfiles-director-"));
  const stub = path.join(stubDir, "director");
  fs.writeFileSync(stub, body);
  fs.chmodSync(stub, 0o755);
  savedDirectorBin = process.env.DIRECTOR_BIN;
  process.env.DIRECTOR_BIN = stub;
  return stub;
}

function okStub() {
  return makeStub(
    "#!/bin/sh\n" +
      "cat > /dev/null\n" +
      `printf '%s' '{"hookSpecificOutput":{"additionalContext":"${DIGEST}"}}'\n`,
  );
}

function failingStub() {
  return makeStub("#!/bin/sh\nexit 1\n");
}

async function setupDirector(ctx) {
  teardown = await plugin.setup(ctx);
  return teardown;
}

function created(sid, location = DIR, parentID = undefined) {
  return {
    type: "session.created",
    data: { sessionID: sid, location: { directory: location }, parentID },
  };
}

describe("prompt hook (SessionStart)", () => {
  test("prepends the Director digest to the first prompt of a top session", async () => {
    okStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const event = { sessionID: "s1", prompt: { text: "do the thing" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, `${DIGEST}\n\ndo the thing`);
  });

  test("injects only once per session", async () => {
    okStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const first = { sessionID: "s1", prompt: { text: "one" } };
    await ctx.hooks.session.get("prompt")(first);
    assert.match(first.prompt.text, new RegExp(`^${DIGEST}`));
    const second = { sessionID: "s1", prompt: { text: "two" } };
    await ctx.hooks.session.get("prompt")(second);
    assert.equal(second.prompt.text, "two");
  });

  test("child sessions get no injection", async () => {
    okStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("kid", DIR, "parent-1"));
    await flush();
    const event = { sessionID: "kid", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "hello");
  });

  test("foreign sessions get no injection", async () => {
    okStub();
    const ctx = createMockContext({
      directory: DIR,
      sessions: { other: topSession("other", "/elsewhere") },
    });
    await setupDirector(ctx);
    const event = { sessionID: "other", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "hello");
  });

  test("a failing Director binary degrades silently (no injection, no throw)", async () => {
    failingStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const event = { sessionID: "s1", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "hello");
  });
});

describe("post-tool hook (PostToolUse)", () => {
  test("appends the digest to string tool results", async () => {
    okStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const event = {
      sessionID: "s1",
      tool: "edit",
      status: "completed",
      result: { content: "tool output" },
    };
    await ctx.hooks.tool.get("execute.after")(event);
    assert.equal(event.result.content, `tool output\n\n${DIGEST}`);
  });

  test("appends the digest to array tool results", async () => {
    okStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const event = {
      sessionID: "s1",
      tool: "edit",
      status: "completed",
      result: { content: [{ type: "text", text: "a" }] },
    };
    await ctx.hooks.tool.get("execute.after")(event);
    assert.deepEqual(event.result.content, [
      { type: "text", text: "a" },
      { type: "text", text: DIGEST },
    ]);
  });

  test("non-completed tool results are left alone", async () => {
    okStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const event = {
      sessionID: "s1",
      tool: "edit",
      status: "failed",
      result: { content: "tool output" },
    };
    await ctx.hooks.tool.get("execute.after")(event);
    assert.equal(event.result.content, "tool output");
  });

  test("child sessions get no heartbeat", async () => {
    okStub();
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("kid", DIR, "parent-1"));
    await flush();
    const event = {
      sessionID: "kid",
      tool: "edit",
      status: "completed",
      result: { content: "tool output" },
    };
    await ctx.hooks.tool.get("execute.after")(event);
    assert.equal(event.result.content, "tool output");
  });
});
