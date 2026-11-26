#!/usr/bin/env node
// Eval history log: one JSON object per line, append-only (never rewrite or
// dedupe), plus the deterministic SUMMARY.md generator. See
// specs/measure-eval-v1.md.
import fs from "node:fs";
import path from "node:path";

export const AGENTS = ["opencode", "openhands"];

const EM = "—";

function isToken(value) {
  return Number.isInteger(value) && value >= 0;
}

function isDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isString(value) {
  return typeof value === "string" && value !== "";
}

export function assertEntry(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("entry must be a JSON object");
  }
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
    if (!(key in entry)) throw new TypeError(`entry missing "${key}"`);
  }
  if (typeof entry.ts !== "string" || Number.isNaN(Date.parse(entry.ts))) {
    throw new TypeError(
      'entry.ts must be an ISO timestamp, e.g. "2026-11-25T00:00:00.000Z"',
    );
  }
  if (!AGENTS.includes(entry.agent)) {
    throw new TypeError(`entry.agent must be one of: ${AGENTS.join(", ")}`);
  }
  for (const key of ["model", "task"]) {
    if (!isString(entry[key]))
      throw new TypeError(`entry.${key} must be a non-empty string`);
  }
  const score = entry.score;
  if (
    score === null ||
    typeof score !== "object" ||
    Array.isArray(score) ||
    !Number.isInteger(score.passed) ||
    !Number.isInteger(score.total) ||
    score.total < 1 ||
    score.passed < 0 ||
    score.passed > score.total
  ) {
    throw new TypeError(
      "entry.score must be {passed, total} with 0 <= passed <= total",
    );
  }
  if (!Array.isArray(entry.checks)) {
    throw new TypeError("entry.checks must be an array of {name, pass}");
  }
  for (const check of entry.checks) {
    if (
      check === null ||
      typeof check !== "object" ||
      !isString(check.name) ||
      typeof check.pass !== "boolean"
    ) {
      throw new TypeError("each entry.checks item must be {name, pass}");
    }
  }
  for (const key of ["tokens_in", "tokens_out"]) {
    if (entry[key] !== null && !isToken(entry[key])) {
      throw new TypeError(
        `entry.${key} must be null or a non-negative integer`,
      );
    }
  }
  if (entry.duration_s !== null && !isDuration(entry.duration_s)) {
    throw new TypeError(
      "entry.duration_s must be null or a non-negative number",
    );
  }
  for (const key of ["source", "note"]) {
    if (entry[key] !== undefined && typeof entry[key] !== "string") {
      throw new TypeError(`entry.${key} must be a string`);
    }
  }
  return entry;
}

export function appendLog(historyPath, entry) {
  assertEntry(entry);
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
}

export function readLog(historyPath) {
  let raw;
  try {
    raw = fs.readFileSync(historyPath, "utf8");
  } catch (er) {
    if (er.code === "ENOENT") return [];
    throw er;
  }
  const entries = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      throw new Error(`history log line ${i + 1}: invalid JSON`);
    }
    try {
      assertEntry(entry);
    } catch (er) {
      throw new Error(`history log line ${i + 1}: ${er.message}`);
    }
    entries.push(entry);
  }
  return entries;
}

export function seedEntries() {
  const ts = "2026-11-25T00:00:00.000Z";
  const checks = [
    { name: "tree lists build-mini", pass: true },
    { name: "tree lists ask-local", pass: true },
    { name: "agent files untouched", pass: true },
  ];
  return [
    {
      ts,
      agent: "opencode",
      model: "ollama/glm-5.3-flash:cloud",
      task: "docs-tree-sync",
      score: { passed: 3, total: 3 },
      checks,
      tokens_in: 18372,
      tokens_out: 3886,
      duration_s: 18.8,
      source: "seed",
    },
    {
      ts,
      agent: "openhands",
      model: "ollama/glm-5.3-flash:cloud",
      task: "docs-tree-sync",
      score: { passed: 3, total: 3 },
      checks,
      tokens_in: null,
      tokens_out: null,
      duration_s: null,
      source: "manual",
      note: "OpenHands reported 164128 total tokens, 133120 cached; duration not measured",
    },
  ];
}

function fmtTokens(value) {
  return value === null ? EM : String(value);
}

function fmtDuration(value) {
  return value === null ? EM : `${value.toFixed(1)}s`;
}

function table(headers, rows) {
  const widths = headers.map((h, col) =>
    Math.max(h.length, ...rows.map((row) => row[col].length)),
  );
  const line = (cells) =>
    `| ${cells.map((cell, col) => cell.padEnd(widths[col])).join(" | ")} |`;
  const output = [line(headers), line(widths.map((w) => "-".repeat(w)))];
  for (const row of rows) output.push(line(row));
  return output.join("\n");
}

export function summarize(entries) {
  if (entries.length === 0) {
    return "# Eval results\n\n_No runs recorded yet._\n";
  }
  const ordered = entries
    .map((entry, index) => [entry, index])
    .sort((a, b) => Date.parse(b[0].ts) - Date.parse(a[0].ts) || a[1] - b[1])
    .map((pair) => pair[0]);
  const runRows = ordered.map((entry) => [
    entry.ts.slice(0, 10),
    entry.agent,
    entry.model,
    entry.task,
    `${entry.score.passed}/${entry.score.total}`,
    fmtTokens(entry.tokens_in),
    fmtTokens(entry.tokens_out),
    fmtDuration(entry.duration_s),
  ]);
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.agent} ${entry.model} ${entry.task}`;
    if (!groups.has(key)) {
      groups.set(key, {
        agent: entry.agent,
        model: entry.model,
        task: entry.task,
        runs: 0,
        passed: 0,
        total: 0,
        tokensIn: [],
        tokensOut: [],
        durations: [],
      });
    }
    const group = groups.get(key);
    group.runs++;
    group.passed += entry.score.passed;
    group.total += entry.score.total;
    if (entry.tokens_in !== null) group.tokensIn.push(entry.tokens_in);
    if (entry.tokens_out !== null) group.tokensOut.push(entry.tokens_out);
    if (entry.duration_s !== null) group.durations.push(entry.duration_s);
  }
  const mean = (values, fmt) =>
    values.length === 0
      ? EM
      : fmt(values.reduce((a, b) => a + b, 0) / values.length);
  const trendRows = [...groups.values()].map((group) => [
    group.agent,
    group.model,
    group.task,
    String(group.runs),
    `${((group.passed / group.total) * 100).toFixed(1)}%`,
    mean(group.tokensIn, (m) => String(Math.round(m))),
    mean(group.tokensOut, (m) => String(Math.round(m))),
    mean(group.durations, (m) => `${m.toFixed(1)}s`),
  ]);
  return [
    "# Eval results",
    "",
    "## Runs",
    "",
    table(
      [
        "date",
        "agent",
        "model",
        "task",
        "score",
        "tokens in",
        "tokens out",
        "duration",
      ],
      runRows,
    ),
    "",
    "## Trends (mean per agent × model × task)",
    "",
    table(
      [
        "agent",
        "model",
        "task",
        "runs",
        "mean score",
        "mean tokens in",
        "mean tokens out",
        "mean duration",
      ],
      trendRows,
    ),
    "",
  ].join("\n");
}

export function generateSummary(historyPath, summaryPath) {
  const markdown = summarize(readLog(historyPath));
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, markdown);
  return markdown;
}
