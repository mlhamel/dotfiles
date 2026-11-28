// Tests for plugins/session-logger.js.
//
// The plugin shells out to log_session.py in the Obsidian vault, so the
// tests build a fake vault in a temp dir: a stub log_session.py that
// answers `init` with a canned RESULT line and creates an empty note.
// No real vault, no real python package, nothing is written outside the
// temp dir.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import plugin from "../../opencode/plugins/session-logger.js";
import { createMockContext, flush, sleep, waitFor } from "./mock-context.js";

const FAKE_SCRIPT = `#!/usr/bin/env python3
import json
import os
import sys

vault = sys.argv[sys.argv.index("--vault") + 1]
note_path = os.path.join(vault, "session-note.md")
with open(note_path, "w", encoding="utf-8") as f:
    f.write("")
print("RESULT: " + json.dumps({"session_id": "OBS-TEST-1", "note_path": note_path}))
`;

let vault;
let teardown;
let savedObsidianVault;

afterEach(async () => {
  if (teardown) {
    teardown();
    teardown = undefined;
  }
  if (savedObsidianVault === undefined) delete process.env.OBSIDIAN_VAULT;
  else process.env.OBSIDIAN_VAULT = savedObsidianVault;
  if (vault) {
    fs.rmSync(vault, { recursive: true, force: true });
    vault = undefined;
  }
  await flush(2);
});

function makeVault() {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "factory-logger-"));
  const skillDir = path.join(vault, ".opencode", "skills", "decision-log");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "log_session.py"), FAKE_SCRIPT);
  savedObsidianVault = process.env.OBSIDIAN_VAULT;
  process.env.OBSIDIAN_VAULT = vault;
  return vault;
}

function notePath() {
  return path.join(vault, "session-note.md");
}

async function setupLogger(ctx) {
  teardown = await plugin.setup(ctx);
  return teardown;
}

describe("setup", () => {
  test("outside a vault the plugin is a no-op", async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "factory-novault-"));
    try {
      const ctx = createMockContext({ directory: outside });
      const result = await plugin.setup(ctx);
      assert.equal(result, undefined);
      assert.equal(ctx.hooks.session.size, 0);
      assert.equal(ctx.subscribeCalls, 0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("inside a vault the prompt hook is registered", async () => {
    makeVault();
    const ctx = createMockContext({ directory: vault });
    await setupLogger(ctx);
    assert.equal(ctx.hooks.session.has("prompt"), true);
    assert.equal(ctx.subscribeCalls, 1);
  });
});

describe("session notes", () => {
  test("created auto-creates a note; the prompt hook injects logging instructions", async () => {
    makeVault();
    const ctx = createMockContext({ directory: vault });
    await setupLogger(ctx);
    ctx.pushEvent({
      type: "session.created",
      data: { sessionID: "s1", location: { directory: vault } },
    });
    await waitFor(() => fs.existsSync(notePath()));

    const event = { sessionID: "s1", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.match(event.prompt.text, /Session logging is active/);
    assert.match(event.prompt.text, /OBS-TEST-1/);
    assert.match(event.prompt.text, /hello$/);
  });

  test("the prompt hook injects only once", async () => {
    makeVault();
    const ctx = createMockContext({ directory: vault });
    await setupLogger(ctx);
    ctx.pushEvent({
      type: "session.created",
      data: { sessionID: "s1", location: { directory: vault } },
    });
    await waitFor(() => fs.existsSync(notePath()));
    const first = { sessionID: "s1", prompt: { text: "one" } };
    await ctx.hooks.session.get("prompt")(first);
    assert.match(first.prompt.text, /Session logging is active/);
    const second = { sessionID: "s1", prompt: { text: "two" } };
    await ctx.hooks.session.get("prompt")(second);
    assert.equal(second.prompt.text, "two");
  });

  test("deleted removes an empty note, keeps a note with entries", async () => {
    makeVault();
    const ctx = createMockContext({ directory: vault });
    await setupLogger(ctx);
    ctx.pushEvent({
      type: "session.created",
      data: { sessionID: "s1", location: { directory: vault } },
    });
    await waitFor(() => fs.existsSync(notePath()));

    // Empty note: removed on delete.
    ctx.pushEvent({ type: "session.deleted", data: { sessionID: "s1" } });
    await waitFor(() => !fs.existsSync(notePath()));

    // Note with entries: kept on delete.
    ctx.pushEvent({
      type: "session.created",
      data: { sessionID: "s2", location: { directory: vault } },
    });
    await waitFor(() => fs.existsSync(notePath()));
    fs.writeFileSync(notePath(), "## Decisions\n\n- D-01 decided X\n");
    ctx.pushEvent({ type: "session.deleted", data: { sessionID: "s2" } });
    await sleep(50);
    assert.equal(fs.existsSync(notePath()), true);
  });

  test("child sessions are skipped", async () => {
    makeVault();
    const ctx = createMockContext({ directory: vault });
    await setupLogger(ctx);
    ctx.pushEvent({
      type: "session.created",
      data: {
        sessionID: "kid",
        location: { directory: vault },
        parentID: "p1",
      },
    });
    await sleep(50);
    assert.equal(fs.existsSync(notePath()), false);
    const event = { sessionID: "kid", prompt: { text: "hello" } };
    await ctx.hooks.session.get("prompt")(event);
    assert.equal(event.prompt.text, "hello");
  });
});
