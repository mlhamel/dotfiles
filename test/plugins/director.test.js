// Tests for plugins/director.js (the OpenCode V2 shim).
//
// runHook() shells out to the Director binary; the tests point
// DIRECTOR_BIN at a stub script that answers with a canned control
// payload, so no real Director install is needed. The 10s hook timeout
// is NOT covered here — see test/README.md. The fallback path IS
// covered below: the HOME-derived tiers, the DIRECTOR_FALLBACK_BIN
// override, and the managed-file marker tripwire.

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
  sleep,
  waitFor,
} from "./mock-context.js";

const DIR = "/proj";
const DIGEST = "DIRECTOR DIGEST";

let teardown;
let tempDirs = [];
let savedDirectorBin;
let savedFallbackBin;
let savedHome;
let savedPath;

afterEach(async () => {
  if (teardown) {
    teardown();
    teardown = undefined;
  }
  if (savedDirectorBin === undefined) delete process.env.DIRECTOR_BIN;
  else process.env.DIRECTOR_BIN = savedDirectorBin;
  if (savedFallbackBin === undefined) delete process.env.DIRECTOR_FALLBACK_BIN;
  else process.env.DIRECTOR_FALLBACK_BIN = savedFallbackBin;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
  await flush(2);
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function stubBody(digest) {
  return (
    "#!/bin/sh\n" +
    "cat > /dev/null\n" +
    `printf '%s' '{"hookSpecificOutput":{"additionalContext":"${digest}"}}'\n`
  );
}

function makeStub(body) {
  const dir = tempDir("dotfiles-director-");
  const stub = path.join(dir, "director");
  fs.writeFileSync(stub, body);
  fs.chmodSync(stub, 0o755);
  savedDirectorBin = process.env.DIRECTOR_BIN;
  process.env.DIRECTOR_BIN = stub;
  return stub;
}

// A stub binary that does NOT touch DIRECTOR_BIN — for fallback-tier tests,
// where the stub must be found via PATH / HOME, not via the env override.
function plainStub(digest = DIGEST) {
  const dir = tempDir("dotfiles-director-");
  const stub = path.join(dir, "director");
  fs.writeFileSync(stub, stubBody(digest));
  fs.chmodSync(stub, 0o755);
  return stub;
}

function okStub(digest = DIGEST) {
  return makeStub(stubBody(digest));
}

function failingStub() {
  return makeStub("#!/bin/sh\nexit 1\n");
}

// A stub binary that logs each invocation's hook event to a file, so the
// Stop hook's firings are observable (the hook's control output is ignored
// by design, so there is nothing else to observe).
function loggingStub(logFile) {
  const dir = tempDir("dotfiles-director-");
  const stub = path.join(dir, "director");
  fs.writeFileSync(
    stub,
    "#!/bin/sh\n" +
      "cat > /dev/null\n" +
      `echo "$2" >> "${logFile}"\n` +
      `printf '%s' '{"hookSpecificOutput":{"additionalContext":"${DIGEST}"}}'\n`,
  );
  fs.chmodSync(stub, 0o755);
  savedDirectorBin = process.env.DIRECTOR_BIN;
  process.env.DIRECTOR_BIN = stub;
  return stub;
}

function readLog(logFile) {
  try {
    return fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// Scratch HOME with a stub director at `relPath` (e.g.
// ".local/bin/director"). PATH is left alone unless the test changes it.
function homeStub(relPath, digest = DIGEST) {
  const home = tempDir("dotfiles-director-home-");
  const stub = path.join(home, relPath);
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.writeFileSync(stub, stubBody(digest));
  fs.chmodSync(stub, 0o755);
  savedHome = process.env.HOME;
  process.env.HOME = home;
  return stub;
}

// PATH with no `director` on it, so the PATH tier misses and the fallback
// tiers are exercised. The stub's `#!/bin/sh` shebang is absolute, so the
// child does not need PATH to run.
function pathWithoutDirector() {
  savedPath = process.env.PATH;
  process.env.PATH = tempDir("dotfiles-director-path-");
}

// No DIRECTOR_BIN / DIRECTOR_FALLBACK_BIN: the full candidate chain runs.
function clearDirectorEnv() {
  savedDirectorBin = process.env.DIRECTOR_BIN;
  delete process.env.DIRECTOR_BIN;
  savedFallbackBin = process.env.DIRECTOR_FALLBACK_BIN;
  delete process.env.DIRECTOR_FALLBACK_BIN;
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

describe("fallback resolution", () => {
  async function injectViaPrompt() {
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    const event = { sessionID: "s1", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    return event.prompt.text;
  }

  test("resolves ~/.local/bin/director from HOME when no director is on PATH", async () => {
    clearDirectorEnv();
    pathWithoutDirector();
    homeStub(".local/bin/director");
    assert.equal(await injectViaPrompt(), `${DIGEST}\n\nhello`);
  });

  test("falls through to ~/.claude/director/bin/director when ~/.local/bin has none", async () => {
    clearDirectorEnv();
    pathWithoutDirector();
    homeStub(".claude/director/bin/director");
    assert.equal(await injectViaPrompt(), `${DIGEST}\n\nhello`);
  });

  test("DIRECTOR_FALLBACK_BIN overrides the HOME-derived tiers", async () => {
    clearDirectorEnv();
    pathWithoutDirector();
    homeStub(".local/bin/director", "HOME-DIGEST");
    savedFallbackBin = process.env.DIRECTOR_FALLBACK_BIN;
    process.env.DIRECTOR_FALLBACK_BIN = plainStub("CUSTOM");
    assert.equal(await injectViaPrompt(), `CUSTOM\n\nhello`);
  });

  test("DIRECTOR_BIN still wins over the fallback tiers", async () => {
    pathWithoutDirector();
    homeStub(".local/bin/director", "HOME-DIGEST");
    okStub("BIN");
    assert.equal(await injectViaPrompt(), `BIN\n\nhello`);
  });

  test("no binary anywhere degrades silently (no injection, no throw)", async () => {
    clearDirectorEnv();
    pathWithoutDirector();
    const home = tempDir("dotfiles-director-home-");
    savedHome = process.env.HOME;
    process.env.HOME = home;
    assert.equal(await injectViaPrompt(), "hello");
  });
});

describe("managed file", () => {
  test("the plugin source still carries the V2 stopgap marker and no hardcoded home path", () => {
    const src = fs.readFileSync(
      new URL("../../opencode/plugins/director.js", import.meta.url),
      "utf8",
    );
    assert.match(src, /V2 STOPGAP PORT/);
    assert.doesNotMatch(src, /\/home\/mlhamel/);
  });
});

describe("end-of-turn Stop hook", () => {
  async function endTurn(ctx, sid, type) {
    ctx.pushEvent({
      type: "session.execution.started",
      data: { sessionID: sid },
    });
    await flush(3);
    ctx.pushEvent({ type, data: { sessionID: sid } });
    await flush(5);
  }

  function logPath() {
    return path.join(tempDir("dotfiles-director-log-"), "calls.log");
  }

  test("Stop fires on a succeeded turn", async () => {
    const log = logPath();
    loggingStub(log);
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await endTurn(ctx, "s1", "session.execution.succeeded");
    await waitFor(() => readLog(log).length === 1);
    assert.deepEqual(readLog(log), ["stop"]);
  });

  test("Stop fires on a failed turn", async () => {
    // Deliberate convergence (see lib/session-classify.js): a failed turn
    // still ran, so fleet bookkeeping records it — director ignored failed
    // turns before the shared helper.
    const log = logPath();
    loggingStub(log);
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await endTurn(ctx, "s1", "session.execution.failed");
    await waitFor(() => readLog(log).length === 1);
    assert.deepEqual(readLog(log), ["stop"]);
  });

  test("Stop fires once for a failed then succeeded turn without a new started", async () => {
    const log = logPath();
    loggingStub(log);
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("s1"));
    await flush();
    await endTurn(ctx, "s1", "session.execution.failed");
    await waitFor(() => readLog(log).length === 1);
    ctx.pushEvent({
      type: "session.execution.succeeded",
      data: { sessionID: "s1" },
    });
    await flush(5);
    await sleep(50);
    assert.deepEqual(readLog(log), ["stop"]);
  });

  test("child sessions get no Stop", async () => {
    const log = logPath();
    loggingStub(log);
    const ctx = createMockContext({ directory: DIR });
    await setupDirector(ctx);
    ctx.pushEvent(created("kid", DIR, "parent-1"));
    await flush();
    await endTurn(ctx, "kid", "session.execution.succeeded");
    await sleep(50);
    assert.deepEqual(readLog(log), []);
  });
});
