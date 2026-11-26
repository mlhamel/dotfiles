import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AGENTS,
  assertEntry,
  appendLog,
  readLog,
  seedEntries,
  summarize,
  generateSummary,
} from "../../eval/history.mjs";
import { main as recordMain, buildManualEntry } from "../../eval/record.mjs";
import { main as measureMain } from "../../eval/measure.mjs";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const COMMITTED_HISTORY = path.join(
  TEST_DIR,
  "..",
  "..",
  "eval",
  "results",
  "history.jsonl",
);
const COMMITTED_SUMMARY = path.join(
  TEST_DIR,
  "..",
  "..",
  "eval",
  "results",
  "SUMMARY.md",
);
const FIXTURES_TASKS_DIR = path.join(TEST_DIR, "fixtures", "tasks");

const STUB_SOURCE = [
  "#!/usr/bin/env node",
  "import fs from 'node:fs';",
  "const jsonl = (obj) => console.log(JSON.stringify(obj));",
  "const mode = process.env.STUB_EVAL_MODE || 'ok';",
  "if (process.argv[2] === '--version') { console.log('opencode version 2.3.0'); process.exit(0); }",
  "if (mode === 'mutate') { const p = 'target.txt'; fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('before', 'after')); jsonl({ type: 'step_start', sessionID: 'ses_test' }); jsonl({ type: 'text', sessionID: 'ses_test', text: 'done' }); jsonl({ type: 'step_finish', sessionID: 'ses_test', tokens: { input: 100, output: 50 }, cost: 0.001 }); process.exit(0); }",
  "process.exit(0);",
  "",
].join("\n");

let tmp;
let stub;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
  stub = path.join(tmp, "stub-opencode");
  fs.writeFileSync(stub, STUB_SOURCE);
  fs.chmodSync(stub, 0o755);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function goodEntry(overrides = {}) {
  return {
    ts: "2026-11-25T00:00:00.000Z",
    agent: "opencode",
    model: "ollama/glm-5.3-flash:cloud",
    task: "docs-tree-sync",
    score: { passed: 2, total: 3 },
    checks: [],
    tokens_in: null,
    tokens_out: null,
    duration_s: null,
    source: "manual",
    ...overrides,
  };
}

test("the committed history log is exactly the two seed entries", () => {
  assert.deepEqual(readLog(COMMITTED_HISTORY), seedEntries());
});

test("the committed SUMMARY.md is reproducible from the seeds", () => {
  assert.equal(
    fs.readFileSync(COMMITTED_SUMMARY, "utf8"),
    summarize(seedEntries()),
  );
});

test("seed entries validate", () => {
  for (const entry of seedEntries()) assertEntry(entry);
});

test("assertEntry validates the entry shape", () => {
  for (const key of [
    "ts",
    "agent",
    "model",
    "task",
    "score",
    "checks",
    "tokens_in",
    "tokens_out",
    "duration_s",
  ]) {
    const entry = goodEntry();
    delete entry[key];
    assert.throws(
      () => assertEntry(entry),
      new RegExp(`entry missing "${key}"`),
    );
  }
  assert.throws(() => assertEntry("nope"), /entry must be a JSON object/);
  assert.throws(() => assertEntry([]), /entry must be a JSON object/);
  assert.throws(
    () => assertEntry(goodEntry({ ts: "yesterday" })),
    /entry.ts must be an ISO timestamp/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ agent: "claude" })),
    /entry.agent must be one of: opencode, openhands/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ model: "" })),
    /entry.model must be a non-empty string/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ score: { passed: 4, total: 3 } })),
    /entry.score must be \{passed, total\}/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ score: { passed: -1, total: 1 } })),
    /entry.score must be \{passed, total\}/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ score: { passed: 0, total: 0 } })),
    /entry.score must be \{passed, total\}/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ checks: "none" })),
    /entry.checks must be an array of \{name, pass\}/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ checks: [{ name: "x", pass: "yes" }] })),
    /each entry.checks item must be \{name, pass\}/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ checks: [{ name: 1, pass: true }] })),
    /each entry.checks item must be \{name, pass\}/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ tokens_in: -1 })),
    /entry.tokens_in must be null or a non-negative integer/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ tokens_out: 12.5 })),
    /entry.tokens_out must be null or a non-negative integer/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ duration_s: "fast" })),
    /entry.duration_s must be null or a non-negative number/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ source: 42 })),
    /entry.source must be a string/,
  );
  assert.throws(
    () => assertEntry(goodEntry({ note: ["n"] })),
    /entry.note must be a string/,
  );
  assert.deepEqual(assertEntry(goodEntry()), assertEntry(goodEntry()));
});

test("empty checks is valid: manual runs have no per-check detail", () => {
  const entry = assertEntry(
    goodEntry({ score: { passed: 2, total: 3 }, checks: [] }),
  );
  assert.deepEqual(entry.checks, []);
});

test("appendLog creates the directory, appends and never rewrites", () => {
  const historyPath = path.join(tmp, "nested", "dir", "history.jsonl");
  const first = goodEntry({ ts: "2026-11-20T00:00:00.000Z" });
  const second = goodEntry({ ts: "2026-11-21T00:00:00.000Z", task: "other" });
  appendLog(historyPath, first);
  appendLog(historyPath, second);
  assert.deepEqual(readLog(historyPath), [first, second]);
  const before = fs.readFileSync(historyPath, "utf8");
  appendLog(historyPath, goodEntry({ ts: "2026-11-22T00:00:00.000Z" }));
  assert.ok(
    fs.readFileSync(historyPath, "utf8").startsWith(`${before}{"`),
    "appending preserves earlier lines",
  );
  assert.equal(readLog(historyPath).length, 3);
  assert.throws(
    () => appendLog(historyPath, goodEntry({ agent: "claude" })),
    /entry.agent must be one of/,
  );
});

test("readLog returns [] for a missing file and reports corrupt lines", () => {
  assert.deepEqual(readLog(path.join(tmp, "does-not-exist.jsonl")), []);
  const historyPath = path.join(tmp, "broken.jsonl");
  fs.writeFileSync(historyPath, "not json\n");
  assert.throws(() => readLog(historyPath), /line 1: invalid JSON/);
  fs.writeFileSync(historyPath, "not json\n\nmore json\n");
  assert.throws(() => readLog(historyPath), /line 1: invalid JSON/);
  const invalid = JSON.stringify({ ts: "x" });
  fs.writeFileSync(historyPath, `${invalid}\n`);
  assert.throws(() => readLog(historyPath), /line 1: entry missing "agent"/);
  fs.writeFileSync(historyPath, "\n\n");
  assert.deepEqual(readLog(historyPath), []);
});

test("summarize starts with the no-runs placeholder for an empty log", () => {
  assert.equal(summarize([]), "# Eval results\n\n_No runs recorded yet._\n");
});

test("summarize breaks ts ties by insertion order and shows the seeds", () => {
  const markdown = summarize(seedEntries());
  const lines = markdown.split("\n");
  const opencode = lines.findIndex((l) =>
    l.startsWith("| 2026-11-25 | opencode"),
  );
  const openhands = lines.findIndex((l) =>
    l.startsWith("| 2026-11-25 | openhands"),
  );
  assert.ok(opencode !== -1 && openhands !== -1, "both runs are listed");
  assert.ok(opencode < openhands, "insertion order wins for equal ts");
  assert.ok(markdown.includes("## Runs"));
  assert.ok(markdown.includes("## Trends (mean per agent × model × task)"));
  assert.ok(lines[0] === "# Eval results");
});

test("summarize aggregates trends per agent x model x task ignoring nulls", () => {
  const entries = [
    goodEntry({
      agent: "opencode",
      task: "t1",
      score: { passed: 1, total: 2 },
    }),
    goodEntry({
      agent: "opencode",
      task: "t1",
      score: { passed: 1, total: 1 },
      tokens_in: 300,
      tokens_out: 50,
      duration_s: 30,
    }),
    goodEntry({
      agent: "openhands",
      task: "t1",
      score: { passed: 1, total: 1 },
    }),
  ];
  const markdown = summarize(entries);
  const lines = markdown.split("\n");
  const squash = (s) => s.replace(/\s+/g, " ");
  const runsRows = lines.filter((l) => l.startsWith("| 2026-11-25 |"));
  assert.equal(runsRows.length, 3, "runs are one row per entry");
  assert.ok(
    squash(runsRows[0]).includes("| 1/2 |"),
    "run rows keep per-run scores",
  );
  assert.ok(
    squash(runsRows[2]).includes("| — |"),
    "null run cells render as em-dashes",
  );
  const trendRows = lines.filter(
    (l) => l.startsWith("| opencode ") || l.startsWith("| openhands "),
  );
  assert.equal(trendRows.length, 2, "one trend row per agent x model x task");
  const opencodeTrend = squash(trendRows[0]);
  assert.ok(
    opencodeTrend.includes("| t1 | 2 | 66.7% | 300 | 50 | 30.0s |"),
    "opencode trend aggregates two runs, ignoring the null one",
  );
  const openhandsTrend = squash(trendRows[1]);
  assert.ok(
    openhandsTrend.includes("| t1 | 1 | 100.0% | — | — | — |"),
    "openhands trend renders null means as em-dashes",
  );
});

test("generateSummary writes SUMMARY.md next to the log", () => {
  const historyPath = path.join(tmp, "sum", "history.jsonl");
  const summaryPath = path.join(tmp, "sum", "SUMMARY.md");
  appendLog(historyPath, goodEntry());
  const markdown = generateSummary(historyPath, summaryPath);
  assert.equal(fs.readFileSync(summaryPath, "utf8"), markdown);
  assert.equal(markdown, summarize([goodEntry()]));
  assert.ok(markdown.includes("## Runs"));
});

test("buildManualEntry turns flags into a valid entry", () => {
  const historyPath = path.join(tmp, "rec", "history.jsonl");
  const { entry, historyPath: resolved } = buildManualEntry([
    "--agent",
    "openhands",
    "--model",
    "x/y",
    "--task",
    "docs-tree-sync",
    "--score",
    "2/3",
    "--tokens-in",
    "100",
    "--tokens-out",
    "5",
    "--duration-s",
    "12.34",
    "--source",
    "canvas",
    "--note",
    "ran by hand",
    "--ts",
    "2026-11-26T10:00:00.000Z",
    "--history",
    historyPath,
  ]);
  assert.equal(resolved, historyPath);
  assert.deepEqual(entry, {
    ts: "2026-11-26T10:00:00.000Z",
    agent: "openhands",
    model: "x/y",
    task: "docs-tree-sync",
    score: { passed: 2, total: 3 },
    checks: [],
    tokens_in: 100,
    tokens_out: 5,
    duration_s: 12.3,
    source: "canvas",
    note: "ran by hand",
  });
  assertEntry(entry);
});

test("buildManualEntry defaults source, ts, tokens and duration", () => {
  const { entry } = buildManualEntry([
    "--agent",
    "opencode",
    "--model",
    "m",
    "--task",
    "t",
    "--score",
    "0/1",
  ]);
  assert.equal(entry.source, "manual");
  assert.equal(entry.tokens_in, null);
  assert.equal(entry.tokens_out, null);
  assert.equal(entry.duration_s, null);
  assert.equal("note" in entry, false);
  assert.ok(!Number.isNaN(Date.parse(entry.ts)));
  assert.ok(Math.abs(Date.now() - Date.parse(entry.ts)) < 60_000);
  assertEntry(entry);
});

test("buildManualEntry rejects bad input", () => {
  const base = [
    "--agent",
    "opencode",
    "--model",
    "m",
    "--task",
    "t",
    "--score",
    "1/1",
  ];
  assert.throws(
    () => buildManualEntry(["--wat", "x", ...base]),
    /unknown argument --wat/,
  );
  for (const key of ["agent", "model", "task", "score"]) {
    const cut = base.filter(
      (arg, i) =>
        !(arg === `--${key}` || (i > 0 && base[i - 1] === `--${key}`)),
    );
    assert.throws(() => buildManualEntry(cut), new RegExp(`missing --${key}`));
  }
  assert.throws(
    () => buildManualEntry(["--agent", "claude", ...base.slice(2)]),
    /--agent must be one of: opencode, openhands/,
  );
  assert.throws(
    () => buildManualEntry([...base.slice(0, 6), "--score", "x/y"]),
    /--score must be <passed>\/<total>/,
  );
  assert.throws(
    () => buildManualEntry([...base.slice(0, 6), "--score", "4/3"]),
    /--score must satisfy 0 <= passed <= total/,
  );
  assert.throws(
    () => buildManualEntry([...base, "--tokens-in", "-5"]),
    /--tokens-in must be a non-negative integer/,
  );
  assert.throws(
    () => buildManualEntry([...base, "--duration-s", "-1"]),
    /--duration-s must be a non-negative number/,
  );
  assert.throws(
    () => buildManualEntry([...base, "--duration-s", "soon"]),
    /--duration-s must be a non-negative number/,
  );
  assert.throws(
    () => buildManualEntry([...base, "--ts", "yesterday"]),
    /--ts must be an ISO timestamp/,
  );
});

test("record main appends to the history and regenerates the summary", () => {
  const historyPath = path.join(tmp, "recorded", "history.jsonl");
  const summaryPath = path.join(tmp, "recorded", "SUMMARY.md");
  const argv = [
    "--agent",
    "openhands",
    "--model",
    "m",
    "--task",
    "docs-tree-sync",
    "--score",
    "3/3",
    "--ts",
    "2026-11-26T10:00:00.000Z",
    "--history",
    historyPath,
  ];
  assert.equal(recordMain(argv), 0);
  assert.equal(recordMain([...argv, "--note", "again"]), 0);
  const entries = readLog(historyPath);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.checks),
    [[], []],
  );
  const markdown = fs.readFileSync(summaryPath, "utf8");
  assert.equal(markdown, summarize(entries));
  assert.ok(markdown.includes("| m "));
});

test("measure main records one entry per task and regenerates the summary", async () => {
  const tasksDir = path.join(tmp, "measure-ok", "tasks");
  fs.cpSync(
    path.join(FIXTURES_TASKS_DIR, "task-ok"),
    path.join(tasksDir, "task-ok"),
    { recursive: true },
  );
  fs.cpSync(
    path.join(FIXTURES_TASKS_DIR, "task-ok"),
    path.join(tasksDir, "task-two"),
    { recursive: true },
  );
  const resultsDir = path.join(tmp, "measure-ok", "results");
  const env = {
    ...process.env,
    EVAL_MODEL: "ollama/glm-5.3-flash:cloud",
    EVAL_TASKS_DIR: tasksDir,
    EVAL_RESULTS_DIR: resultsDir,
    EVAL_OPENCODE_BIN: stub,
    EVAL_TIMEOUT_S: "10",
  };
  const prev = process.env.STUB_EVAL_MODE;
  process.env.STUB_EVAL_MODE = "mutate";
  const code = await measureMain(["--tasks", "task-ok,task-two"], env);
  if (prev === undefined) delete process.env.STUB_EVAL_MODE;
  else process.env.STUB_EVAL_MODE = prev;
  assert.equal(code, 0);
  const resultFile = fs
    .readdirSync(resultsDir)
    .find((f) => f.endsWith(".json"));
  assert.ok(resultFile, "runAll wrote a results file");
  assert.match(
    resultFile,
    /^\d{4}-\d{2}-\d{2}-ollama-glm-5-3-flash-cloud\.json$/,
  );
  const entries = readLog(path.join(resultsDir, "history.jsonl"));
  assert.deepEqual(
    entries.map((e) => e.task),
    ["task-ok", "task-two"],
  );
  for (const entry of entries) {
    assert.equal(entry.agent, "opencode");
    assert.equal(entry.model, "ollama/glm-5.3-flash:cloud");
    assert.deepEqual(entry.score, { passed: 3, total: 3 });
    assert.equal(entry.checks.length, 3);
    assert.ok(entry.checks.every((c) => c.pass === true));
    assert.deepEqual(entry.tokens_in, 100);
    assert.deepEqual(entry.tokens_out, 50);
    assert.ok(Number.isFinite(entry.duration_s) && entry.duration_s >= 0);
    assert.equal(entry.source, resultFile);
    assert.ok(!Number.isNaN(Date.parse(entry.ts)));
  }
  const summaryPath = path.join(resultsDir, "SUMMARY.md");
  const markdown = fs.readFileSync(summaryPath, "utf8");
  assert.equal(markdown, summarize(entries));
  assert.ok(markdown.includes("| task-ok "));
  assert.ok(markdown.includes("| task-two "));
  assert.ok(markdown.includes("| 3/3 "));
});

test("measure main records failed runs too and returns non-zero", async () => {
  const resultsDir = path.join(tmp, "measure-fail", "results");
  const env = {
    ...process.env,
    EVAL_MODEL: "ollama/glm-5.3-flash:cloud",
    EVAL_TASKS_DIR: FIXTURES_TASKS_DIR,
    EVAL_RESULTS_DIR: resultsDir,
    EVAL_OPENCODE_BIN: stub,
    EVAL_TIMEOUT_S: "10",
  };
  const code = await measureMain(["--tasks", "task-ok"], env);
  assert.equal(code, 1);
  const [entry] = readLog(path.join(resultsDir, "history.jsonl"));
  assert.deepEqual(entry.score, { passed: 2, total: 3 });
  assert.deepEqual(
    entry.checks.map((c) => c.pass),
    [false, true, true],
  );
  const summaryPath = path.join(resultsDir, "SUMMARY.md");
  const markdown = fs.readFileSync(summaryPath, "utf8");
  assert.equal(markdown, summarize([entry]));
  assert.ok(markdown.includes("| 2/3 "));
});
