import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadTasks,
  slugifyModel,
  defaultModel,
  countMatches,
  runAgent,
  runChecks,
  runTask,
  runAll,
  main,
  hashFile,
} from "../../eval/run.mjs";

const STUB_SOURCE = [
  "#!/usr/bin/env node",
  "import fs from 'node:fs';",
  "const log = process.env.STUB_LOG;",
  "if (process.argv[2] === '--version') { console.log('opencode version 2.3.0'); process.exit(0); }",
  "if (log) fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), home: process.env.HOME }) + '\\n');",
  "const mode = process.env.STUB_EVAL_MODE || 'ok';",
  "const jsonl = (obj) => console.log(JSON.stringify(obj));",
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
