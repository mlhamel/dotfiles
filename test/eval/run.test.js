import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  agentEnv,
  loadTasks,
  slugifyModel,
  defaultModel,
  evalConfig,
  countMatches,
  runAgent,
  runChecks,
  runTask,
  runAll,
  main,
  hashFile,
  snapshotRepo,
  diffSnapshots,
} from "../../eval/run.mjs";

const STUB_SOURCE = [
  "#!/usr/bin/env node",
  "import fs from 'node:fs';",
  "const log = process.env.STUB_LOG;",
  "if (process.argv[2] === '--version') { console.log('opencode version 2.3.0'); process.exit(0); }",
  "if (log) fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), home: process.env.HOME, pwd: process.env.PWD ?? null, oldpwd: process.env.OLDPWD ?? null }) + '\\n');",
  "const mode = process.env.STUB_EVAL_MODE || 'ok';",
  "const jsonl = (obj) => console.log(JSON.stringify(obj));",
  "if (mode === 'part-tokens') { jsonl({ type: 'step_start', sessionID: 'ses_test' }); jsonl({ type: 'text', sessionID: 'ses_test', text: 'done' }); jsonl({ type: 'step_finish', sessionID: 'ses_test', part: { tokens: { input: 200, output: 75 }, cost: 0.002 } }); process.exit(0); }",
  "if (mode === 'both-tokens') { jsonl({ type: 'step_start', sessionID: 'ses_test' }); jsonl({ type: 'text', sessionID: 'ses_test', text: 'done' }); jsonl({ type: 'step_finish', sessionID: 'ses_test', tokens: { input: 100, output: 50 }, cost: 0.001, part: { tokens: { input: 200, output: 75 }, cost: 0.002 } }); process.exit(0); }",
  "if (mode === 'guard-trip') { const p = 'target.txt'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('before', 'after')); if (process.env.STUB_GUARD_TARGET) fs.appendFileSync(process.env.STUB_GUARD_TARGET, 'tripped\\n'); jsonl({ type: 'step_start', sessionID: 'ses_test' }); jsonl({ type: 'text', sessionID: 'ses_test', text: 'done' }); jsonl({ type: 'step_finish', sessionID: 'ses_test', tokens: { input: 100, output: 50 }, cost: 0.001 }); process.exit(0); }",
  "if (mode === 'fail') { jsonl({ type: 'error', sessionID: 'ses_test', error: 'boom' }); process.exit(1); }",
  "if (mode === 'timeout') { setTimeout(() => {}, 60000); }",
  "else if (mode === 'empty') { process.exit(0); }",
  "else {",
  "  if (mode === 'mutate') { const p = 'target.txt'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('before', 'after')); }",
  "  jsonl({ type: 'step_start', sessionID: 'ses_test' });",
  "  jsonl({ type: 'text', sessionID: 'ses_test', text: 'done' });",
  "  jsonl({ type: 'step_finish', sessionID: 'ses_test', tokens: { input: 100, output: 50 }, cost: 0.001 });",
  "  process.exit(0);",
  "}",
  "",
].join("\n");

let tmp;
let stub;
let logFile;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-test-"));
  stub = path.join(tmp, "stub-opencode");
  fs.writeFileSync(stub, STUB_SOURCE);
  fs.chmodSync(stub, 0o755);
  logFile = path.join(tmp, "stub.log");
  fs.writeFileSync(logFile, "");
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function syntheticTasksDir() {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "fixtures",
    "tasks",
  );
}

test("the real eval tasks load and validate", () => {
  const tasksDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "eval",
    "tasks",
  );
  const tasks = loadTasks(tasksDir);
  assert.deepEqual(
    tasks.map((t) => t.id),
    [
      "add-darwin-services-fail-case",
      "add-fallback-gateway-test",
      "docs-tree-sync",
      "fix-nudger-band",
      "fix-plan-exemption",
    ],
  );
  for (const task of tasks) {
    assert.ok(task.prompt.length > 0, `${task.id} has a prompt`);
    assert.ok(task.checks.length >= 2, `${task.id} has checks`);
    assert.ok(task.files.length > 0, `${task.id} has a fixture`);
  }
});

test("loadTasks finds the synthetic tasks with prompt, checks and fixture", () => {
  const tasks = loadTasks(syntheticTasksDir());
  assert.deepEqual(
    tasks.map((t) => t.id),
    ["task-broken", "task-ok"],
  );
  const ok = tasks.find((t) => t.id === "task-ok");
  assert.equal(ok.prompt, "Change target.txt: replace before with after.");
  assert.equal(ok.checks.length, 3);
  assert.deepEqual(ok.files, ["other.txt", "target.txt"]);
});

test("loadTasks rejects a task without checks.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-bad-task-"));
  const taskDir = path.join(dir, "nope");
  fs.mkdirSync(path.join(taskDir, "fixture"), { recursive: true });
  fs.writeFileSync(path.join(taskDir, "prompt.md"), "hi");
  assert.throws(() => loadTasks(dir), /missing checks\.json/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("slugifyModel turns provider/model:tag into a filename stem", () => {
  assert.equal(
    slugifyModel("ollama/glm-5.3-flash:cloud"),
    "ollama-glm-5-3-flash-cloud",
  );
  assert.equal(slugifyModel("ollama/qwen3:4b"), "ollama-qwen3-4b");
});

test("defaultModel reads opencode.json and falls back without one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-root-"));
  fs.mkdirSync(path.join(dir, "opencode"));
  fs.writeFileSync(
    path.join(dir, "opencode", "opencode.json"),
    JSON.stringify({ model: "ollama/kimi-k2.7-code:cloud" }),
  );
  assert.equal(defaultModel(dir), "ollama/kimi-k2.7-code:cloud");
  fs.rmSync(path.join(dir, "opencode"), { recursive: true, force: true });
  assert.equal(defaultModel(dir), "ollama/glm-5.3-flash:cloud");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("evalConfig pins the gateway models with a context limit", () => {
  const config = evalConfig("ollama/glm-5.3-flash:cloud");
  assert.equal(config.model, "ollama/glm-5.3-flash:cloud");
  assert.deepEqual(Object.keys(config.providers.ollama.models).sort(), [
    "gemma4:26b",
    "gemma4:cloud",
    "glm-5.2:cloud",
    "glm-5.3-flash:cloud",
    "glm-5.3:cloud",
    "inkling-2-small:cloud",
    "kimi-k2.7-code:cloud",
    "llama3:latest",
    "qwen3:4b",
  ]);
  for (const m of Object.values(config.providers.ollama.models))
    assert.deepEqual(m, { limit: { context: 65536 } });
});

test("evalConfig points the ollama provider at the cloud endpoint when the key is set", () => {
  const config = evalConfig("ollama/glm-5.3-flash:cloud", {
    OLLAMA_API_KEY: "secret-value",
  });
  assert.deepEqual(config.providers.ollama.options, {
    baseURL: "https://ollama.com/v1",
    apiKey: "{env:OLLAMA_API_KEY}",
  });
  assert.ok(!JSON.stringify(config).includes("secret-value"));
});

test("evalConfig keeps the local gateway config when the key is absent or empty", () => {
  for (const env of [{}, { OLLAMA_API_KEY: "" }]) {
    const config = evalConfig("ollama/glm-5.3-flash:cloud", env);
    assert.equal(config.providers.ollama.options, undefined);
  }
});

test("countMatches counts non-overlapping regex matches", () => {
  assert.equal(countMatches("test( a test( b", "test\\("), 2);
  assert.equal(countMatches("nothing here", "test\\("), 0);
});

test("runAgent ok parses tokens, cost and session id and passes the eval flags", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-work-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "eval-home-"));
  fs.writeFileSync(logFile, "");
  const prevLog = process.env.STUB_LOG;
  process.env.STUB_LOG = logFile;
  const res = await runAgent({
    bin: stub,
    model: "ollama/glm-5.3-flash:cloud",
    prompt: "do the thing",
    cwd: workdir,
    home,
    timeoutMs: 10000,
    transcriptPath: null,
  });
  if (prevLog === undefined) delete process.env.STUB_LOG;
  else process.env.STUB_LOG = prevLog;
  assert.equal(res.ok, true);
  assert.equal(res.exitCode, 0);
  assert.deepEqual(res.tokens, { input: 100, output: 50 });
  assert.equal(res.cost, 0.001);
  assert.equal(res.sessionId, "ses_test");
  assert.equal(res.eventCount, 3);
  const call = JSON.parse(fs.readFileSync(logFile, "utf8").trim());
  assert.equal(call.cwd, workdir);
  assert.equal(call.home, home);
  assert.deepEqual(call.argv.slice(0, 9), [
    "run",
    "--standalone",
    "--auto",
    "--archived",
    "--format",
    "json",
    "-m",
    "ollama/glm-5.3-flash:cloud",
    "--",
  ]);
  assert.equal(call.argv[9], "do the thing");
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test("runAgent reads tokens and cost from event.part, preferring it over top-level", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-work-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "eval-home-"));
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "part-tokens";
  const part = await runAgent({
    bin: stub,
    model: "x/y",
    prompt: "p",
    cwd: workdir,
    home,
    timeoutMs: 10000,
    transcriptPath: null,
  });
  assert.equal(part.ok, true);
  assert.deepEqual(part.tokens, { input: 200, output: 75 });
  assert.equal(part.cost, 0.002);
  process.env.STUB_EVAL_MODE = "both-tokens";
  const both = await runAgent({
    bin: stub,
    model: "x/y",
    prompt: "p",
    cwd: workdir,
    home,
    timeoutMs: 10000,
    transcriptPath: null,
  });
  assert.deepEqual(both.tokens, { input: 200, output: 75 });
  assert.equal(both.cost, 0.002);
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test("agentEnv purges OLDPWD and points PWD at the workdir", () => {
  const env = agentEnv("/tmp/home", "/tmp/work", {
    HOME: "/real/home",
    PWD: "/live/repo",
    OLDPWD: "/live/old",
    FOO: "bar",
  });
  assert.equal(env.HOME, "/tmp/home");
  assert.equal(env.PWD, "/tmp/work");
  assert.equal(env.FOO, "bar");
  assert.equal("OLDPWD" in env, false);
});

test("runAgent runs the agent without OLDPWD and with PWD set to the workdir", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-work-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "eval-home-"));
  fs.writeFileSync(logFile, "");
  const prevLog = process.env.STUB_LOG;
  const prevPwd = process.env.PWD;
  const prevOld = process.env.OLDPWD;
  process.env.STUB_LOG = logFile;
  process.env.PWD = "/live/repo";
  process.env.OLDPWD = "/live/old";
  const res = await runAgent({
    bin: stub,
    model: "x/y",
    prompt: "p",
    cwd: workdir,
    home,
    timeoutMs: 10000,
    transcriptPath: null,
  });
  if (prevLog === undefined) delete process.env.STUB_LOG;
  else process.env.STUB_LOG = prevLog;
  if (prevPwd === undefined) delete process.env.PWD;
  else process.env.PWD = prevPwd;
  if (prevOld === undefined) delete process.env.OLDPWD;
  else process.env.OLDPWD = prevOld;
  assert.equal(res.ok, true);
  const call = JSON.parse(fs.readFileSync(logFile, "utf8").trim());
  assert.equal(call.pwd, workdir);
  assert.equal(call.oldpwd, null);
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test("runAgent fail reports the error event and a non-zero exit", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-work-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "eval-home-"));
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "fail";
  const res = await runAgent({
    bin: stub,
    model: "x/y",
    prompt: "p",
    cwd: workdir,
    home,
    timeoutMs: 10000,
    transcriptPath: null,
  });
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(res.ok, false);
  assert.equal(res.exitCode, 1);
  assert.equal(res.errorEvents, 1);
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test("runAgent timeout kills a stuck run", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-work-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "eval-home-"));
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "timeout";
  const res = await runAgent({
    bin: stub,
    model: "x/y",
    prompt: "p",
    cwd: workdir,
    home,
    timeoutMs: 300,
    transcriptPath: null,
  });
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(res.timedOut, true);
  assert.equal(res.ok, false);
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test("runAgent empty output is not success", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-work-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "eval-home-"));
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "empty";
  const res = await runAgent({
    bin: stub,
    model: "x/y",
    prompt: "p",
    cwd: workdir,
    home,
    timeoutMs: 10000,
    transcriptPath: null,
  });
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(res.exitCode, 0);
  assert.equal(res.ok, false);
  assert.equal(res.eventCount, 0);
  fs.rmSync(workdir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test("runChecks covers cmd, contains, count-gt and unchanged", async () => {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-checks-"));
  fs.writeFileSync(path.join(workdir, "a.txt"), "hello test( world test(\n");
  fs.writeFileSync(path.join(workdir, "b.txt"), "same\n");
  const baseline = {
    hashes: new Map([["b.txt", hashFile(path.join(workdir, "b.txt"))]]),
    counts: new Map([["a.txt:test\\(", 1]]),
  };
  const results = await runChecks(
    [
      { kind: "cmd", name: "true passes", cmd: "true" },
      { kind: "cmd", name: "false fails", cmd: "false" },
      { kind: "contains", name: "finds hello", file: "a.txt", text: "hello" },
      { kind: "contains", name: "misses nope", file: "a.txt", text: "nope" },
      {
        kind: "count-gt",
        name: "one more test(",
        file: "a.txt",
        pattern: "test\\(",
      },
      { kind: "unchanged", name: "b untouched", files: ["b.txt"] },
    ],
    workdir,
    baseline,
  );
  assert.deepEqual(
    results.map((r) => r.pass),
    [true, false, true, false, true, true],
  );
  fs.writeFileSync(path.join(workdir, "b.txt"), "changed\n");
  const again = await runChecks(
    [{ kind: "unchanged", name: "b touched", files: ["b.txt"] }],
    workdir,
    baseline,
  );
  assert.equal(again[0].pass, false);
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("runTask passes end to end when the stub does the work", async () => {
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "mutate";
  const task = loadTasks(syntheticTasksDir()).find((t) => t.id === "task-ok");
  const res = await runTask(task, {
    bin: stub,
    model: "x/y",
    timeoutMs: 10000,
    keep: false,
    keepTranscripts: false,
    transcriptsDir: path.join(tmp, "t"),
  });
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(res.pass, true);
  assert.equal(res.score, 1);
  assert.equal(res.checks.length, 3);
});

test("runTask fails when the stub does nothing", async () => {
  const task = loadTasks(syntheticTasksDir()).find(
    (t) => t.id === "task-broken",
  );
  const res = await runTask(task, {
    bin: stub,
    model: "x/y",
    timeoutMs: 10000,
    keep: false,
    keepTranscripts: false,
    transcriptsDir: path.join(tmp, "t"),
  });
  assert.equal(res.pass, false);
  assert.equal(res.score, 0);
  assert.equal(res.checks[0].pass, false);
});

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-guard-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "initial"]);
  return dir;
}

test("snapshotRepo returns null outside a git repo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-nogit-"));
  assert.equal(await snapshotRepo(dir), null);
  assert.equal(await snapshotRepo(null), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("diffSnapshots reports head moves and added or removed status lines", () => {
  const changed = diffSnapshots(
    { head: "aaa", entries: [" M a.txt", "?? b.txt"] },
    { head: "bbb", entries: [" M a.txt", "?? c.txt"] },
  );
  assert.ok(changed.some((c) => c.startsWith("HEAD aaa -> bbb")));
  assert.ok(changed.includes("?? c.txt"));
  assert.ok(
    changed.some((c) => c.startsWith("removed:") && c.includes("b.txt")),
  );
  assert.deepEqual(
    diffSnapshots({ head: "aaa", entries: [] }, { head: "aaa", entries: [] }),
    [],
  );
});

test("runTask guard passes when the agent stays in the scratch dir", async () => {
  const repo = makeGitRepo();
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "mutate";
  const task = loadTasks(syntheticTasksDir()).find((t) => t.id === "task-ok");
  const res = await runTask(task, {
    root: repo,
    bin: stub,
    model: "x/y",
    timeoutMs: 10000,
    keep: false,
    keepTranscripts: false,
    transcriptsDir: path.join(tmp, "t"),
  });
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(res.pass, true);
  assert.equal(res.guard.tripped, false);
  assert.deepEqual(res.guard.changed, []);
  fs.rmSync(repo, { recursive: true, force: true });
});

test("runTask guard trips when the agent edits the live repo", async () => {
  const repo = makeGitRepo();
  const prevMode = process.env.STUB_EVAL_MODE;
  const prevTarget = process.env.STUB_GUARD_TARGET;
  process.env.STUB_EVAL_MODE = "guard-trip";
  process.env.STUB_GUARD_TARGET = path.join(repo, "README.md");
  const task = loadTasks(syntheticTasksDir()).find((t) => t.id === "task-ok");
  const res = await runTask(task, {
    root: repo,
    bin: stub,
    model: "x/y",
    timeoutMs: 10000,
    keep: false,
    keepTranscripts: false,
    transcriptsDir: path.join(tmp, "t"),
  });
  if (prevMode === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prevMode;
  if (prevTarget === undefined) delete process.env.STUB_GUARD_TARGET;
  else process.env.STUB_GUARD_TARGET = prevTarget;
  assert.equal(res.score, 1);
  assert.equal(res.pass, false);
  assert.equal(res.guard.tripped, true);
  assert.ok(res.guard.changed.some((c) => c.includes("README.md")));
  fs.rmSync(repo, { recursive: true, force: true });
});

test("runTask guard ignores the harness's own transcripts", async () => {
  const repo = makeGitRepo();
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "mutate";
  const task = loadTasks(syntheticTasksDir()).find((t) => t.id === "task-ok");
  const res = await runTask(task, {
    root: repo,
    bin: stub,
    model: "x/y",
    timeoutMs: 10000,
    keep: false,
    keepTranscripts: true,
    transcriptsDir: path.join(repo, "eval", "results", "x.transcripts"),
  });
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(res.pass, true);
  assert.equal(res.guard.tripped, false);
  assert.ok(
    fs.existsSync(
      path.join(repo, "eval", "results", "x.transcripts", "task-ok.jsonl"),
    ),
  );
  fs.rmSync(repo, { recursive: true, force: true });
});

test("runAll writes a results file with the expected shape", async () => {
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "mutate";
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-results-"));
  const { result, outPath } = await runAll({
    root: tmp,
    tasksDir: syntheticTasksDir(),
    resultsDir,
    model: "ollama/glm-5.3-flash:cloud",
    timeoutMs: 10000,
    bin: stub,
  });
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(result.version, 1);
  assert.equal(result.model, "ollama/glm-5.3-flash:cloud");
  assert.equal(result.total, 2);
  assert.equal(result.passed, 2);
  assert.equal(result.score, 1);
  assert.equal(result.opencode, "opencode version 2.3.0");
  assert.equal(
    outPath,
    path.join(resultsDir, `${result.date}-ollama-glm-5-3-flash-cloud.json`),
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(outPath, "utf8")), result);
  fs.rmSync(resultsDir, { recursive: true, force: true });
});

test("main returns 0 when the selected tasks pass and 1 otherwise", async () => {
  const prevMode = process.env.STUB_EVAL_MODE;
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-main-"));
  const env = {
    ...process.env,
    EVAL_MODEL: "x/y",
    EVAL_TASKS_DIR: syntheticTasksDir(),
    EVAL_RESULTS_DIR: resultsDir,
    EVAL_OPENCODE_BIN: stub,
  };
  process.env.STUB_EVAL_MODE = "mutate";
  const ok = await main(["--tasks", "task-ok"], env);
  assert.equal(ok, 0);
  process.env.STUB_EVAL_MODE = "ok";
  const bad = await main(["--tasks", "task-broken"], env);
  assert.equal(bad, 1);
  if (prevMode === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prevMode;
  fs.rmSync(resultsDir, { recursive: true, force: true });
});
