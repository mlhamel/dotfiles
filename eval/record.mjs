#!/usr/bin/env node
// Record a manual eval run (e.g. OpenHands through Canvas) in the history log
// and regenerate SUMMARY.md. Per-check detail is unknown for manual runs, so
// checks is empty. See specs/measure-eval-v1.md.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./run.mjs";
import { AGENTS, appendLog, generateSummary } from "./history.mjs";

const USAGE =
  "usage: node eval/record.mjs --agent opencode|openhands --model <model> " +
  "--task <id> --score <passed>/<total> [--tokens-in <n>] [--tokens-out <n>] " +
  "[--duration-s <s>] [--source <s>] [--note <s>] [--ts <iso>] [--history <path>]";

function intArg(text, flag) {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${flag} must be a non-negative integer, got ${text}`);
  }
  return n;
}

export function buildManualEntry(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent") flags.agent = argv[++i];
    else if (argv[i] === "--model") flags.model = argv[++i];
    else if (argv[i] === "--task") flags.task = argv[++i];
    else if (argv[i] === "--score") flags.score = argv[++i];
    else if (argv[i] === "--tokens-in") flags.tokensIn = argv[++i];
    else if (argv[i] === "--tokens-out") flags.tokensOut = argv[++i];
    else if (argv[i] === "--duration-s") flags.durationS = argv[++i];
    else if (argv[i] === "--source") flags.source = argv[++i];
    else if (argv[i] === "--note") flags.note = argv[++i];
    else if (argv[i] === "--ts") flags.ts = argv[++i];
    else if (argv[i] === "--history") flags.history = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  for (const key of ["agent", "model", "task", "score"]) {
    if (flags[key] === undefined) throw new Error(`missing --${key}\n${USAGE}`);
  }
  if (!AGENTS.includes(flags.agent)) {
    throw new Error(`--agent must be one of: ${AGENTS.join(", ")}\n${USAGE}`);
  }
  const match = /^(\d+)\/(\d+)$/.exec(flags.score);
  if (!match)
    throw new Error(
      `--score must be <passed>/<total>, got ${flags.score}\n${USAGE}`,
    );
  const passed = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || passed > total) {
    throw new Error(
      `--score must satisfy 0 <= passed <= total, got ${flags.score}\n${USAGE}`,
    );
  }
  const entry = {
    agent: flags.agent,
    model: flags.model,
    task: flags.task,
    score: { passed, total },
    checks: [],
    tokens_in: null,
    tokens_out: null,
    duration_s: null,
    source: "manual",
  };
  if (flags.tokensIn !== undefined)
    entry.tokens_in = intArg(flags.tokensIn, "--tokens-in");
  if (flags.tokensOut !== undefined)
    entry.tokens_out = intArg(flags.tokensOut, "--tokens-out");
  if (flags.durationS !== undefined) {
    const n = Number(flags.durationS);
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
      throw new Error(
        `--duration-s must be a non-negative number, got ${flags.durationS}\n${USAGE}`,
      );
    }
    entry.duration_s = Math.round(n * 10) / 10;
  }
  if (flags.note !== undefined) entry.note = flags.note;
  if (flags.source !== undefined) entry.source = flags.source;
  entry.ts = flags.ts ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(entry.ts))) {
    throw new Error(`--ts must be an ISO timestamp, got ${flags.ts}\n${USAGE}`);
  }
  const historyPath =
    flags.history ?? path.join(repoRoot(), "eval", "results", "history.jsonl");
  return { entry, historyPath };
}

export function main(argv) {
  const { entry, historyPath } = buildManualEntry(argv);
  appendLog(historyPath, entry);
  const summaryPath = path.join(path.dirname(historyPath), "SUMMARY.md");
  generateSummary(historyPath, summaryPath);
  console.log(
    `recorded ${entry.agent}/${entry.model}/${entry.task} ` +
      `${entry.score.passed}/${entry.score.total} -> ${historyPath} + ${summaryPath}`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(err?.message ?? err);
    process.exit(2);
  }
}
