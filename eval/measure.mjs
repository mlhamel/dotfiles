#!/usr/bin/env node
// Run the eval via eval/run.mjs and record it: appends one history entry per
// task to eval/results/history.jsonl and regenerates SUMMARY.md. See
// specs/measure-eval-v1.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultModel, repoRoot, runAll } from "./run.mjs";
import { appendLog, generateSummary } from "./history.mjs";

const DEFAULT_TIMEOUT_S = 600;

export async function main(argv, env = process.env) {
  const root = repoRoot();
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model") flags.model = argv[++i];
    else if (argv[i] === "--tasks") flags.tasks = argv[++i];
    else if (argv[i] === "--timeout") flags.timeout = argv[++i];
    else if (argv[i] === "--bin") flags.bin = argv[++i];
    else if (argv[i] === "--keep") flags.keep = true;
    else if (argv[i] === "--keep-transcripts") flags.keepTranscripts = true;
    else if (argv[i] === "--tasks-dir") flags.tasksDir = argv[++i];
    else if (argv[i] === "--results-dir") flags.resultsDir = argv[++i];
    else if (argv[i] === "--history") flags.history = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const model = flags.model ?? env.EVAL_MODEL ?? defaultModel(root);
  const resultsDir =
    flags.resultsDir ??
    env.EVAL_RESULTS_DIR ??
    path.join(root, "eval", "results");
  const historyPath =
    flags.history ?? env.EVAL_HISTORY ?? path.join(resultsDir, "history.jsonl");
  const { result, outPath } = await runAll({
    root,
    tasksDir:
      flags.tasksDir ?? env.EVAL_TASKS_DIR ?? path.join(root, "eval", "tasks"),
    resultsDir,
    model,
    timeoutMs:
      Number(flags.timeout ?? env.EVAL_TIMEOUT_S ?? DEFAULT_TIMEOUT_S) * 1000,
    only:
      (flags.tasks ?? env.EVAL_TASKS ?? null)?.split(",").filter(Boolean) ??
      null,
    bin: flags.bin ?? env.EVAL_OPENCODE_BIN ?? "opencode",
    keep: flags.keep ?? env.EVAL_KEEP === "1",
    keepTranscripts: flags.keepTranscripts ?? env.EVAL_KEEP_TRANSCRIPTS === "1",
    env,
  });
  for (const t of result.tasks) {
    appendLog(historyPath, {
      ts: new Date().toISOString(),
      agent: "opencode",
      model: result.model,
      task: t.id,
      score: {
        passed: t.checks.filter((c) => c.pass).length,
        total: t.checks.length,
      },
      checks: t.checks.map((c) => ({ name: c.name, pass: c.pass })),
      tokens_in:
        typeof t.run?.tokens?.input === "number" ? t.run.tokens.input : null,
      tokens_out:
        typeof t.run?.tokens?.output === "number" ? t.run.tokens.output : null,
      duration_s: Math.round(t.durationMs / 100) / 10,
      source: path.basename(outPath),
    });
    console.log(
      `${t.pass ? "PASS" : "FAIL"} ${t.id} score=${t.score.toFixed(2)} ` +
        `tokens=${t.run.tokens.input + t.run.tokens.output} ` +
        `cost=${t.run.cost ?? "?"} ${Math.round(t.durationMs / 1000)}s`,
    );
    if (t.guard?.tripped)
      console.log(`  guard tripped (${t.id}): ${t.guard.changed.join("; ")}`);
  }
  const summaryPath = path.join(path.dirname(historyPath), "SUMMARY.md");
  generateSummary(historyPath, summaryPath);
  console.log(`${result.passed}/${result.total} tasks passed -> ${outPath}`);
  console.log(`recorded -> ${historyPath} + ${summaryPath}`);
  return result.passed === result.total ? 0 : 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err?.message ?? err);
      process.exit(2);
    },
  );
}
