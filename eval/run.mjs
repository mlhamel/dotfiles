import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK_MODEL = "ollama/glm-5.3-flash:cloud";
const DEFAULT_TIMEOUT_MS = 600_000;
const CHECK_TIMEOUT_MS = 300_000;
const VERSION_TIMEOUT_MS = 10_000;

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function slugifyModel(model) {
  return String(model)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function defaultModel(root) {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(root, "opencode", "opencode.json"), "utf8"),
    );
    if (typeof cfg.model === "string" && cfg.model.length > 0) return cfg.model;
  } catch {}
  return FALLBACK_MODEL;
}

export function repoHead(root) {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", root, "rev-parse", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) =>
      resolve(code === 0 ? out.trim() || null : null),
    );
  });
}

export function repoStatus(root) {
  // --untracked-files=all lists untracked files individually instead of
  // collapsing them to their top directory: a collapsed `?? eval/` line
  // would hide an agent-created file next to the harness's transcripts.
  return new Promise((resolve) => {
    const child = spawn(
      "git",
      ["-C", root, "status", "--porcelain", "--untracked-files=all"],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? out : null));
  });
}

// Snapshot of the live repo (HEAD + working-tree status) used to detect an
// eval agent that edited the live repo instead of its scratch dir. Lines
// under ignorePrefix (the transcripts dir, inside the repo by default) are
// the harness's own writes and are excluded. Returns null when the repo
// state cannot be read (not a git repo, git missing): the guard then skips
// instead of failing the task.
export async function snapshotRepo(root, ignorePrefix = null) {
  if (!root) return null;
  const head = await repoHead(root);
  const status = await repoStatus(root);
  if (head === null || status === null) return null;
  const entries = status
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => {
      if (!ignorePrefix) return true;
      const p = line.slice(3);
      const target = p.includes(" -> ") ? p.split(" -> ")[1] : p;
      return !(
        target === ignorePrefix || target.startsWith(`${ignorePrefix}/`)
      );
    });
  return { head, entries };
}

export function diffSnapshots(before, after) {
  const changed = [];
  if (before.head !== after.head)
    changed.push(`HEAD ${before.head} -> ${after.head}`);
  const beforeSet = new Set(before.entries);
  const afterSet = new Set(after.entries);
  for (const e of after.entries) if (!beforeSet.has(e)) changed.push(e);
  for (const e of before.entries)
    if (!afterSet.has(e)) changed.push(`removed: ${e}`);
  return changed;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out.sort();
}

export function hashFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function countMatches(text, pattern) {
  const re = new RegExp(pattern, "g");
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

export function loadTasks(tasksDir) {
  const tasks = [];
  for (const id of fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()) {
    const dir = path.join(tasksDir, id);
    const promptFile = path.join(dir, "prompt.md");
    const checksFile = path.join(dir, "checks.json");
    const fixtureDir = path.join(dir, "fixture");
    if (!fs.existsSync(promptFile))
      throw new Error(`eval task ${id}: missing prompt.md`);
    if (!fs.existsSync(checksFile))
      throw new Error(`eval task ${id}: missing checks.json`);
    if (!fs.existsSync(fixtureDir))
      throw new Error(`eval task ${id}: missing fixture/`);
    const checks = JSON.parse(fs.readFileSync(checksFile, "utf8"));
    if (!Array.isArray(checks.checks) || checks.checks.length === 0)
      throw new Error(`eval task ${id}: checks.json has no checks`);
    const files = listFiles(fixtureDir);
    if (files.length === 0)
      throw new Error(`eval task ${id}: fixture/ is empty`);
    for (const check of checks.checks) {
      if (typeof check.name !== "string" || check.name.length === 0)
        throw new Error(`eval task ${id}: check without a name`);
      if (check.kind === "contains" || check.kind === "count-gt") {
        if (typeof check.file !== "string" || !files.includes(check.file))
          throw new Error(
            `eval task ${id}: check ${check.name} references a file outside the fixture`,
          );
      }
      if (check.kind === "unchanged") {
        if (!Array.isArray(check.files) || check.files.length === 0)
          throw new Error(`eval task ${id}: unchanged check without files`);
        for (const f of check.files) {
          if (!files.includes(f))
            throw new Error(
              `eval task ${id}: unchanged check references a file outside the fixture`,
            );
        }
      }
    }
    tasks.push({
      id,
      dir,
      prompt: fs.readFileSync(promptFile, "utf8").trim(),
      checks: checks.checks,
      fixtureDir,
      files,
    });
  }
  return tasks;
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {}
  }
  return events;
}

export function summarizeEvents(events) {
  let tokens = { input: 0, output: 0 };
  let cost = null;
  let sessionId = null;
  let errorEvents = 0;
  let error = null;
  for (const event of events) {
    if (typeof event.sessionID === "string" && !sessionId)
      sessionId = event.sessionID;
    if (event.type === "error") {
      errorEvents++;
      // First error message wins: opencode emits the API failure as a
      // top-level `error` event (`error.data.message`), and the run
      // stream is the only place it appears when no assistant message
      // is ever created — stderr stays empty, so without this the
      // failure is just "exit 1, tokens 0".
      if (!error) error = errorMessage(event);
    }
    if (event.type !== "step_finish") continue;
    // opencode 2.4.1 nests usage in event.part (top-level event.tokens
    // reported 0 tokens on every run); older binaries emit it top-level.
    // Prefer part, fall back to the top level, never sum both.
    const t = event.part?.tokens ?? event.tokens;
    if (t && typeof t === "object") {
      if (Number.isFinite(t.input)) tokens.input += t.input;
      if (Number.isFinite(t.output)) tokens.output += t.output;
      if (
        !Number.isFinite(t.input) &&
        !Number.isFinite(t.output) &&
        Number.isFinite(t.total)
      ) {
        tokens.input += t.total;
      }
    }
    const c = event.part?.cost ?? event.cost;
    if (Number.isFinite(c)) cost = (cost ?? 0) + c;
  }
  return {
    tokens,
    cost,
    sessionId,
    errorEvents,
    error,
    eventCount: events.length,
  };
}

// Extract a readable message from an opencode `error` event. Real shape
// (verified against opencode's JSON output): `error.data.message`, with
// `error.name` as the type; older / mocked shapes may carry the message
// as a plain string or on `error.message`. Truncated: an error payload
// must never grow the results file unboundedly.
function errorMessage(event) {
  const err = event.error;
  const candidates = [
    err?.data?.message,
    err?.message,
    err?.name,
    typeof err === "string" ? err : null,
    event.message,
    event.part?.state?.error,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.slice(0, 500);
  }
  return null;
}

// The agent must not see the shell's notion of where we came from: OLDPWD
// and PWD point at the live repo, and the eval agent once used an absolute
// live-repo path to decide a task was "already in place" instead of doing
// it in the scratch dir. The child gets a clean HOME, its PWD set to the
// scratch workdir, and no OLDPWD.
export function agentEnv(home, cwd, base = process.env) {
  const env = { ...base, HOME: home, PWD: cwd };
  delete env.OLDPWD;
  return env;
}

export function runAgent({
  bin,
  model,
  prompt,
  cwd,
  home,
  timeoutMs,
  transcriptPath,
}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      bin,
      [
        "run",
        "--standalone",
        "--auto",
        "--archived",
        "--format",
        "json",
        "-m",
        model,
        "--",
        prompt,
      ],
      { cwd, detached: true, env: agentEnv(home, cwd) },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        timedOut,
        ok: false,
        spawnError: String(err?.message ?? err),
        tokens: { input: 0, output: 0 },
        cost: null,
        sessionId: null,
        errorEvents: 0,
        eventCount: 0,
        durationMs: Date.now() - started,
        stderr: stderr.slice(-2000),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (transcriptPath) {
        try {
          fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
          fs.writeFileSync(transcriptPath, stdout);
        } catch {}
      }
      const summary = summarizeEvents(parseEvents(stdout));
      resolve({
        exitCode: code,
        timedOut,
        ok:
          code === 0 &&
          !timedOut &&
          summary.eventCount > 0 &&
          summary.errorEvents === 0,
        tokens: summary.tokens,
        cost: summary.cost,
        sessionId: summary.sessionId,
        errorEvents: summary.errorEvents,
        error: summary.error,
        eventCount: summary.eventCount,
        durationMs: Date.now() - started,
        stderr: stderr.slice(-2000),
      });
    });
  });
}

function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", cmd], { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, CHECK_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) =>
      resolve({ pass: false, detail: String(err?.message ?? err) }),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      const tail = `${stdout}\n${stderr}`.trim().slice(-500);
      resolve({
        pass: code === 0,
        detail: code === 0 ? "" : `exit ${code}${tail ? `: ${tail}` : ""}`,
      });
    });
  });
}

export async function runChecks(checks, workdir, baseline) {
  const results = [];
  for (const check of checks) {
    let result;
    if (check.kind === "cmd") {
      result = await runCommand(check.cmd, workdir);
    } else if (check.kind === "contains") {
      const text = fs.readFileSync(path.join(workdir, check.file), "utf8");
      const pass = text.includes(check.text);
      result = {
        pass,
        detail: pass ? "" : `${check.file} does not contain ${check.text}`,
      };
    } else if (check.kind === "count-gt") {
      const text = fs.readFileSync(path.join(workdir, check.file), "utf8");
      const before = baseline.counts.get(`${check.file}:${check.pattern}`) ?? 0;
      const after = countMatches(text, check.pattern);
      result = {
        pass: after > before,
        detail: `matches ${before} -> ${after}`,
      };
    } else if (check.kind === "unchanged") {
      const changed = check.files.filter(
        (f) => hashFile(path.join(workdir, f)) !== baseline.hashes.get(f),
      );
      result = {
        pass: changed.length === 0,
        detail: changed.length ? `changed: ${changed.join(", ")}` : "",
      };
    } else {
      result = { pass: false, detail: `unknown check kind ${check.kind}` };
    }
    results.push({ name: check.name, kind: check.kind, ...result });
  }
  return results;
}

// Local gateway name -> direct cloud API name (https://ollama.com/v1/models).
// The direct API names models WITHOUT the `:cloud` suffix the local
// gateway uses; `gemma4:cloud` is the exception — the cloud name is
// `gemma4:31b`, not `gemma4`. Verified against the live list 2026-11-26.
const CLOUD_MODEL_NAMES = {
  "glm-5.3-flash:cloud": "glm-5.3-flash",
  "glm-5.3:cloud": "glm-5.3",
  "glm-5.2:cloud": "glm-5.2",
  "inkling-2-small:cloud": "inkling-2-small",
  "gemma4:cloud": "gemma4:31b",
  "kimi-k2.7-code:cloud": "kimi-k2.7-code",
};

// Map a `provider/model` id to the id the endpoint in use expects. With
// OLLAMA_API_KEY set the run goes through the direct cloud API, so a
// `:cloud` model name is translated to its cloud name; without the key
// the id is returned unchanged (local gateway). Idempotent: resolving an
// already-resolved id returns it unchanged.
export function resolveModel(model, env = process.env) {
  if (!env.OLLAMA_API_KEY) return model;
  const slash = model.indexOf("/");
  const provider = slash === -1 ? "" : model.slice(0, slash);
  const name = slash === -1 ? model : model.slice(slash + 1);
  const cloudName = CLOUD_MODEL_NAMES[name] ?? name.replace(/:cloud$/, "");
  return provider ? `${provider}/${cloudName}` : cloudName;
}

export function evalConfig(model, env = process.env) {
  // Same never-list as docs/threat-model.md and opencode/profiles/:
  // evals launch real agents with --auto, so `ask` is no protection and
  // the dangerous shapes must be `deny`. Shell stays broadly allowed
  // (eval tasks run arbitrary test commands); containment comes from the
  // scratch workdir + scratch HOME, which hold no secrets to leak.
  // Cloud endpoint: with OLLAMA_API_KEY set (scheduled CI runs), the
  // provider resolves against https://ollama.com/v1 instead of the
  // local gateway. The `{env:...}` reference keeps the literal key out
  // of the config — opencode reads it from the subprocess environment.
  // Cloud model names: the direct API names models WITHOUT the `:cloud`
  // suffix the local gateway uses (verified against the live
  // https://ollama.com/v1/models list, 2026-11-26: 25 models, zero
  // `:cloud` ids). `gemma4:cloud` is the exception — the cloud name is
  // `gemma4:31b`, not `gemma4`. Local-only models (qwen3:4b, gemma4:26b,
  // llama3:latest) are not on the cloud API, so they are not pinned
  // in cloud mode.
  // Provider shape (opencode v2): the ollama block needs an explicit
  // `package` (`aisdk:@ai-sdk/openai-compatible`, same as the repo's
  // opencode/opencode.json) and `settings` — NOT the v1 `options` key,
  // which v2 silently ignores. Without `package` the run fails with
  // "Unsupported package for ollama/<model>: " (empty package); without
  // `settings` the cloud baseURL/key never reach the provider.
  const cloud = Boolean(env.OLLAMA_API_KEY);
  const settings = cloud
    ? {
        baseURL: "https://ollama.com/v1",
        apiKey: "{env:OLLAMA_API_KEY}",
      }
    : { baseURL: "http://localhost:11434/v1" };
  const resolvedModel = resolveModel(model, env);
  const models = cloud
    ? Object.fromEntries(
        Object.values(CLOUD_MODEL_NAMES).map((name) => [
          name,
          { limit: { context: 65536 } },
        ]),
      )
    : {
        "glm-5.3-flash:cloud": { limit: { context: 65536 } },
        "glm-5.3:cloud": { limit: { context: 65536 } },
        "glm-5.2:cloud": { limit: { context: 65536 } },
        "inkling-2-small:cloud": { limit: { context: 65536 } },
        "gemma4:cloud": { limit: { context: 65536 } },
        "kimi-k2.7-code:cloud": { limit: { context: 65536 } },
        "qwen3:4b": { limit: { context: 65536 } },
        "gemma4:26b": { limit: { context: 65536 } },
        "llama3:latest": { limit: { context: 65536 } },
      };
  return {
    $schema: "https://opencode.ai/config.json",
    model: resolvedModel,
    // Pinned model list: under a scratch HOME the gateway does not resolve
    // `ollama/<model>:cloud` from discovery alone (provider.no-route), so
    // the eval config names every model explicitly, each with a context
    // limit. Mirrors the gateway inventory (ollama list) as of 2026-11-25
    // in local mode, and the live cloud catalogue
    // (https://ollama.com/v1/models) in cloud mode; add new models here
    // when the inventory grows.
    providers: {
      ollama: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings,
        models,
      },
    },
    permissions: [
      { action: "shell", resource: "*", effect: "allow" },
      { action: "shell", resource: "rm *", effect: "deny" },
      { action: "shell", resource: "sudo *", effect: "deny" },
      { action: "shell", resource: "curl * | bash", effect: "deny" },
      { action: "shell", resource: "curl * | sh", effect: "deny" },
      { action: "shell", resource: "wget * | bash", effect: "deny" },
      { action: "shell", resource: "wget * | sh", effect: "deny" },
      { action: "shell", resource: "git push *", effect: "deny" },
      { action: "shell", resource: "eval *", effect: "deny" },
      { action: "read", resource: "~/.ssh/*", effect: "deny" },
      { action: "read", resource: "~/.gnupg/*", effect: "deny" },
      { action: "read", resource: "~/.aws/*", effect: "deny" },
      { action: "read", resource: "~/.config/gh/*", effect: "deny" },
      { action: "read", resource: "~/.config/gcloud/*", effect: "deny" },
      { action: "read", resource: "~/.azure/*", effect: "deny" },
      { action: "read", resource: "~/.kube/*", effect: "deny" },
      { action: "read", resource: "~/.docker/*", effect: "deny" },
      { action: "read", resource: "~/.npmrc", effect: "deny" },
      { action: "read", resource: "~/.netrc", effect: "deny" },
      { action: "read", resource: "*.pem", effect: "deny" },
      { action: "read", resource: "*.key", effect: "deny" },
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "read", resource: "*.env.*", effect: "deny" },
      { action: "read", resource: "*.env.example", effect: "allow" },
      { action: "external_directory", resource: "~/.ssh/*", effect: "deny" },
      { action: "external_directory", resource: "~/.gnupg/*", effect: "deny" },
      { action: "external_directory", resource: "~/.aws/*", effect: "deny" },
      {
        action: "external_directory",
        resource: "~/.config/gh/*",
        effect: "deny",
      },
      {
        action: "external_directory",
        resource: "~/.config/gcloud/*",
        effect: "deny",
      },
      { action: "external_directory", resource: "~/.azure/*", effect: "deny" },
      { action: "external_directory", resource: "~/.kube/*", effect: "deny" },
      { action: "external_directory", resource: "~/.docker/*", effect: "deny" },
    ],
  };
}

export async function runTask(task, opts) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-eval-"));
  const agentHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencode-eval-home-"),
  );
  const baseline = { hashes: new Map(), counts: new Map() };
  for (const rel of task.files) {
    baseline.hashes.set(rel, hashFile(path.join(task.fixtureDir, rel)));
  }
  for (const check of task.checks) {
    if (check.kind === "count-gt") {
      const text = fs.readFileSync(
        path.join(task.fixtureDir, check.file),
        "utf8",
      );
      baseline.counts.set(
        `${check.file}:${check.pattern}`,
        countMatches(text, check.pattern),
      );
    }
  }
  fs.cpSync(task.fixtureDir, workdir, { recursive: true });
  // Resolve once so the config and the `-m` flag agree: in cloud mode the
  // model id is the cloud name (no `:cloud` suffix), in local mode it is
  // the gateway name. resolveModel is idempotent, so evalConfig resolving
  // it again below is a no-op.
  const env = opts.env ?? process.env;
  const model = resolveModel(opts.model, env);
  fs.writeFileSync(
    path.join(workdir, "opencode.json"),
    JSON.stringify(evalConfig(model, env), null, 2),
  );
  const transcriptPath = opts.keepTranscripts
    ? path.join(opts.transcriptsDir, `${task.id}.jsonl`)
    : null;
  // Repo-relative transcripts dir, so the guard ignores the harness's own
  // transcript writes (transcripts land inside the repo by default).
  let ignorePrefix = null;
  if (opts.root && opts.transcriptsDir) {
    const rel = path.relative(opts.root, opts.transcriptsDir);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel))
      ignorePrefix = rel.split(path.sep).join("/");
  }
  const before = await snapshotRepo(opts.root, ignorePrefix);
  const run = await runAgent({
    bin: opts.bin,
    model,
    prompt: task.prompt,
    cwd: workdir,
    home: agentHome,
    timeoutMs: opts.timeoutMs,
    transcriptPath,
  });
  const checks = await runChecks(task.checks, workdir, baseline);
  const passedChecks = checks.filter((c) => c.pass).length;
  const score = checks.length ? passedChecks / checks.length : 0;
  // The guard fails the task when the live repo moved during the run: an
  // agent that edits the live repo instead of its scratch dir must never
  // score a pass, even if every check passed.
  let guard;
  const after = await snapshotRepo(opts.root, ignorePrefix);
  if (before && after) {
    const changed = diffSnapshots(before, after);
    guard = { tripped: changed.length > 0, changed };
  } else {
    guard = {
      skipped: true,
      reason: before ? "after-state unreadable" : "no repo baseline",
    };
  }
  if (!opts.keep) {
    fs.rmSync(workdir, { recursive: true, force: true });
    fs.rmSync(agentHome, { recursive: true, force: true });
  }
  return {
    id: task.id,
    pass: run.ok && score === 1 && !guard.tripped,
    score,
    durationMs: run.durationMs,
    guard,
    run: {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      ok: run.ok,
      tokens: run.tokens,
      cost: run.cost,
      sessionId: run.sessionId,
      errorEvents: run.errorEvents,
      // First error message from the JSONL stream, when present: the
      // API failure lives here (stderr stays empty), so without it the
      // run is just "exit 1, tokens 0". Never the key — an error payload
      // carries the provider's message, not the auth header.
      ...(run.error ? { error: run.error } : {}),
      // Last 2000 chars of opencode's stderr, when non-empty: without it
      // a failed run is opaque (exit 1, tokens 0, no message). The key
      // never appears here — the config carries only the `{env:...}`
      // reference, and opencode does not log auth headers.
      ...(run.stderr ? { stderr: run.stderr } : {}),
      ...(run.spawnError ? { spawnError: run.spawnError } : {}),
    },
    checks,
    ...(opts.keep ? { workdir, agentHome } : {}),
  };
}

export function opencodeVersion(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve(null);
    }, VERSION_TIMEOUT_MS);
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() || null : null);
    });
  });
}

export async function runAll({
  root,
  tasksDir,
  resultsDir,
  model,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  only = null,
  bin = "opencode",
  keep = false,
  keepTranscripts = false,
  env = process.env,
}) {
  const tasks = loadTasks(tasksDir).filter((t) => !only || only.includes(t.id));
  if (tasks.length === 0) throw new Error("no eval tasks selected");
  const date = new Date().toISOString().slice(0, 10);
  // The recorded model is the one that actually ran: in cloud mode the
  // `:cloud` suffix is stripped, so the results file and history carry
  // the cloud name (e.g. ollama/glm-5.3-flash).
  const resolvedModel = resolveModel(model, env);
  const stem = `${date}-${slugifyModel(resolvedModel)}`;
  const transcriptsDir = path.join(resultsDir, `${stem}.transcripts`);
  const taskResults = [];
  for (const task of tasks) {
    taskResults.push(
      await runTask(task, {
        root,
        bin,
        model: resolvedModel,
        timeoutMs,
        keep,
        keepTranscripts,
        transcriptsDir,
        env,
      }),
    );
  }
  const passed = taskResults.filter((t) => t.pass).length;
  const result = {
    version: 1,
    date,
    model: resolvedModel,
    modelDigest: null,
    opencode: await opencodeVersion(bin),
    repoHead: await repoHead(root),
    tasks: taskResults,
    score:
      taskResults.length > 0
        ? taskResults.reduce((s, t) => s + t.score, 0) / taskResults.length
        : 0,
    passed,
    total: taskResults.length,
  };
  fs.mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `${stem}.json`);
  // Trailing newline: prettier requires one, and the bot commits this file,
  // so without it every scheduled run re-breaks lint (the two hand-fixed
  // results files in 39b4df4 were the same missing newline).
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  return { result, outPath };
}

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
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  const model = flags.model ?? env.EVAL_MODEL ?? defaultModel(root);
  const { result, outPath } = await runAll({
    root,
    tasksDir:
      flags.tasksDir ?? env.EVAL_TASKS_DIR ?? path.join(root, "eval", "tasks"),
    resultsDir:
      flags.resultsDir ??
      env.EVAL_RESULTS_DIR ??
      path.join(root, "eval", "results"),
    model,
    timeoutMs:
      Number(flags.timeout ?? env.EVAL_TIMEOUT_S ?? DEFAULT_TIMEOUT_MS / 1000) *
      1000,
    only:
      (flags.tasks ?? env.EVAL_TASKS ?? null)?.split(",").filter(Boolean) ??
      null,
    bin: flags.bin ?? env.EVAL_OPENCODE_BIN ?? "opencode",
    keep: flags.keep ?? env.EVAL_KEEP === "1",
    keepTranscripts: flags.keepTranscripts ?? env.EVAL_KEEP_TRANSCRIPTS === "1",
    env,
  });
  for (const t of result.tasks) {
    console.log(
      `${t.pass ? "PASS" : "FAIL"} ${t.id} score=${t.score.toFixed(2)} ` +
        `tokens=${t.run.tokens.input + t.run.tokens.output} ` +
        `cost=${t.run.cost ?? "?"} ${Math.round(t.durationMs / 1000)}s`,
    );
    if (t.guard?.tripped)
      console.log(`  guard tripped (${t.id}): ${t.guard.changed.join("; ")}`);
  }
  console.log(
    `${result.passed}/${
      result.total
    } tasks passed, score=${result.score.toFixed(2)} -> ${outPath}`,
  );
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
