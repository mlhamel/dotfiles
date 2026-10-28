// session-logger.js — Auto-creates Obsidian session notes for agent conversations
// in the vault and instructs the agent to log decisions as they happen.
//
// V2 port notes (from the V1 API):
//   - V1's `event` hook becomes ctx.event.subscribe(), which is SERVER-WIDE:
//     every per-location instance sees every session. The created handler
//     therefore only acts on sessions whose location matches this instance
//     (the vault), and the deleted handler only acts on session ids this
//     instance registered — foreign sessions are never touched.
//   - V1's chat.message part injection becomes a prepend to the prompt hook's
//     event.prompt.text.
//   - ctx.session keeps get/prompt; V2 has no session.messages, which this
//     plugin never used anyway.
//
// Design:
//   session.created   → run `log_session.py init` if the session's location
//                       is this vault, store session_id → note mapping
//   prompt            → on first message, prepend the logging instructions
//                       telling the agent its session_id and to log
//                       decisions proactively
//   session.deleted   → if the session note has no entries, remove it (no clutter)
//
// Cardinal rule (same as Director): a broken hook must NEVER break a session.
// Every handler swallows every error; the worst outcome is silently absent logging.

import { spawn } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

// Resolve the vault root by checking if the opencode directory is inside the
// Obsidian vault. The vault is the highest ancestor containing ".opencode/".
function vaultRoot(directory) {
  let dir = directory;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".opencode", "skills", "decision-log")))
      return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// runScript executes log_session.py with the given args and returns parsed
// RESULT: JSON, or null on any failure.
function runScript(args) {
  return new Promise((resolve) => {
    const vault =
      process.env.OBSIDIAN_VAULT ||
      `${process.env.HOME}/Dropbox/obsidian/general`;
    const scriptPath = `${vault}/.opencode/skills/decision-log/log_session.py`;
    let child;
    try {
      child = spawn("python3", [scriptPath, ...args], {
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    let stdout = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish(null);
    }, 15_000);
    child.on("error", () => finish(null));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.on("close", () => {
      const lines = stdout.trim().split("\n");
      const resultLine = lines.find((l) => l.startsWith("RESULT:"));
      if (resultLine) {
        try {
          finish(JSON.parse(resultLine.slice(7)));
        } catch {
          finish(null);
        }
      } else {
        finish(null);
      }
    });
    try {
      child.stdin.end();
    } catch {}
  });
}

// Check if a session note has any entries (D-NN, O-NN, or N-NN patterns).
function hasEntries(notePath) {
  try {
    const content = readFileSync(notePath, "utf8");
    return /\b[ DON]-\d{2}\b/.test(content);
  } catch {
    return false;
  }
}

// The injection text that tells the agent to log decisions.
function injectionText(obsidianSessionId, project) {
  return [
    `📁 **Session logging is active.** This conversation is being recorded in your Obsidian vault.`,
    ``,
    `**Session ID:** ${obsidianSessionId}`,
    `**Project:** ${project}`,
    ``,
    `You have a \`decision-log\` skill available. Use it proactively — don't wait to be asked:`,
    ``,
    `- When a **decision** is made (you and the user agree on something), log it immediately:`,
    `  \`\`\`bash`,
    `  python3 "$OBSIDIAN_VAULT/.opencode/skills/decision-log/log_session.py" emit \\`,
    `    --vault "$OBSIDIAN_VAULT" \\`,
    `    --session-id "${obsidianSessionId}" \\`,
    `    --type decision --area "<short-area>" --body "<what was decided + WHY>"`,
    `  \`\`\``,
    ``,
    `- When an **open item** is identified (something unresolved, a risk, a follow-up):`,
    `  same command with \`--type open-item\` (add \`--risk escalate\` if it needs the human).`,
    ``,
    `- For **notable observations or context**: same command with \`--type note\`.`,
    ``,
    `Be concise but complete in each entry — include the rationale, not just the outcome.`,
    `Log decisions as they happen, not at the end. This is not optional.`,
  ].join("\n");
}

export default {
  id: "session-logger",
  async setup(ctx) {
    const directory = ctx.location.directory;

    // Map opencode session ID → { obsidianSessionId, notePath, project }
    const sessions = new Map();
    // Track which sessions have been injected (only inject on first message)
    const injected = new Set();
    // Track child sessions (subagents) — skip them
    const children = new Set();

    const vault = vaultRoot(directory);

    // If this location is not the vault, this plugin instance is a no-op
    if (!vault) return;

    const vaultPath = vault;

    // Infer a project name from the directory (use the folder name, or "Obsidian Vault" if root)
    function inferProject() {
      const parts = directory.replace(vaultPath, "").split("/").filter(Boolean);
      if (parts.length > 0) return parts[0];
      return "Obsidian Vault";
    }

    async function initNote(sid) {
      const project = inferProject();
      const result = await runScript([
        "init",
        "--vault",
        vaultPath,
        "--project",
        project,
      ]);
      if (!result || !result.session_id) return null;
      const info = {
        obsidianSessionId: result.session_id,
        notePath: result.note_path,
        project,
      };
      sessions.set(sid, info);
      return info;
    }

    // The event stream is server-wide; only this vault's sessions are acted on.
    const controller = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({
        signal: controller.signal,
      })) {
        try {
          const data = event?.data;
          const sid = data?.sessionID;
          if (!sid) continue;
          switch (event?.type) {
            case "session.created": {
              if (data.parentID) {
                children.add(sid);
                continue;
              }
              if (data.location?.directory !== directory) continue;

              // Auto-create a session note
              await initNote(sid);
              continue;
            }

            case "session.deleted": {
              // Only touch sessions this instance registered; foreign
              // sessions belong to other locations' instances.
              injected.delete(sid);
              children.delete(sid);
              const info = sessions.get(sid);
              sessions.delete(sid);
              // Clean up empty session notes (no entries were logged)
              if (info && info.notePath && existsSync(info.notePath)) {
                if (!hasEntries(info.notePath)) {
                  try {
                    unlinkSync(info.notePath);
                  } catch {}
                }
              }
              continue;
            }
          }
        } catch {}
      }
    })();

    // isChild is the restart-safe subagent filter for the prompt hook: after
    // a server restart the created-event cache is empty, so a resumed child
    // session is looked up once via ctx.session.get and cached.
    const isChild = async (sid) => {
      try {
        const res = await ctx.session.get({ path: { id: sid } });
        const info = res?.data ?? res;
        if (info && typeof info === "object" && "id" in info && info.parentID) {
          children.add(sid);
          return true;
        }
      } catch {}
      return false;
    };

    // The prompt hook is location-scoped: only this vault's sessions run it.
    await ctx.session.hook("prompt", async (event) => {
      try {
        const sid = event?.sessionID;
        if (!sid || injected.has(sid) || children.has(sid)) return;
        if (await isChild(sid)) return;

        // If session.created hasn't finished creating the note yet (race),
        // create it now as a fallback. This also handles sessions resumed
        // after a server restart where the sessions Map is empty.
        const info = sessions.get(sid) ?? (await initNote(sid));
        if (!info) return;

        injected.add(sid);

        event.prompt.text =
          injectionText(info.obsidianSessionId, info.project) +
          "\n\n" +
          (event.prompt.text ?? "");
      } catch {}
    });

    return () => controller.abort();
  },
};
