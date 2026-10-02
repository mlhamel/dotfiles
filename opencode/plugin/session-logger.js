// session-logger.js — Auto-creates Obsidian session notes for agent conversations
// in the vault and instructs the agent to log decisions as they happen.
//
// Design:
//   session.created   → run `log_session.py init` if directory is the vault,
//                       store session_id → obsidian_session_id mapping
//   chat.message      → on first message, inject a synthetic text part telling
//                       the agent its session_id and to log decisions proactively
//   session.deleted   → if the session note has no entries, remove it (no clutter)
//
// Cardinal rule (same as Director): a broken hook must NEVER break a session.
// Every handler swallows every error; the worst outcome is silently absent logging.

import { spawn } from "node:child_process"
import { readFileSync, unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"

// Resolve the vault root by checking if the opencode directory is inside the
// Obsidian vault. The vault is the highest ancestor containing ".opencode/".
function vaultRoot(directory) {
  let dir = directory
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, ".opencode", "skills", "decision-log"))) return dir
    const parent = join(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  return null
}

// runScript executes log_session.py with the given args and returns parsed
// RESULT: JSON, or null on any failure.
function runScript(args) {
  return new Promise((resolve) => {
    const scriptPath = "/home/mlhamel/Dropbox/obsidian/general/.opencode/skills/decision-log/log_session.py"
    let child
    try {
      child = spawn("python3", [scriptPath, ...args], { stdio: ["pipe", "pipe", "ignore"] })
    } catch {
      resolve(null)
      return
    }
    let stdout = ""
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL") } catch {}
      finish(null)
    }, 15_000)
    child.on("error", () => finish(null))
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (d) => { stdout += d })
    child.on("close", () => {
      const lines = stdout.trim().split("\n")
      const resultLine = lines.find((l) => l.startsWith("RESULT:"))
      if (resultLine) {
        try {
          finish(JSON.parse(resultLine.slice(7)))
        } catch {
          finish(null)
        }
      } else {
        finish(null)
      }
    })
    try { child.stdin.end() } catch {}
  })
}

// Check if a session note has any entries (D-NN, O-NN, or N-NN patterns).
function hasEntries(notePath) {
  try {
    const content = readFileSync(notePath, "utf8")
    return /\b[ DON]-\d{2}\b/.test(content)
  } catch {
    return false
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
    `  python3 "/home/mlhamel/Dropbox/obsidian/general/.opencode/skills/decision-log/log_session.py" emit \\`,
    `    --vault "/home/mlhamel/Dropbox/obsidian/general" \\`,
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
  ].join("\n")
}

export const SessionLoggerPlugin = async ({ directory, client }) => {
  // Map opencode session ID → { obsidianSessionId, notePath, project }
  const sessions = new Map()
  // Track which sessions have been injected (only inject on first message)
  const injected = new Set()
  // Track child sessions (subagents) — skip them
  const children = new Set()

  const vault = vaultRoot(directory)

  // If not in the vault, this plugin is a no-op
  if (!vault) {
    return {}
  }

  const vaultPath = vault

  // Infer a project name from the directory (use the folder name, or "Obsidian Vault" if root)
  function inferProject() {
    const parts = directory.replace(vaultPath, "").split("/").filter(Boolean)
    if (parts.length > 0) return parts[0]
    return "Obsidian Vault"
  }

  return {
    event: async ({ event }) => {
      try {
        const sid = event?.properties?.sessionID ?? event?.properties?.info?.id
        switch (event?.type) {
          case "session.created": {
            const id = event.properties?.info?.id
            if (id && event.properties?.info?.parentID) {
              children.add(id)
              return
            }
            if (!id) return

            // Auto-create a session note
            const project = inferProject()
            const result = await runScript([
              "init",
              "--vault", vaultPath,
              "--project", project,
            ])
            if (result && result.session_id) {
              sessions.set(id, {
                obsidianSessionId: result.session_id,
                notePath: result.note_path,
                project,
              })
            }
            return
          }

          case "session.deleted": {
            if (!sid) return
            injected.delete(sid)
            children.delete(sid)
            const info = sessions.get(sid)
            sessions.delete(sid)
            // Clean up empty session notes (no entries were logged)
            if (info && info.notePath && existsSync(info.notePath)) {
              if (!hasEntries(info.notePath)) {
                try { unlinkSync(info.notePath) } catch {}
              }
            }
            return
          }

          case "session.idle":
            // Nothing to do on idle — handoff is explicit via /session-handoff
            return
        }
      } catch {}
    },

    "chat.message": async (input, output) => {
      try {
        const sid = input.sessionID
        if (!sid || injected.has(sid) || children.has(sid)) return

        // If session.created hasn't finished creating the note yet (race),
        // create it now as a fallback. This also handles sessions resumed
        // after a server restart where the sessions Map is empty.
        let info = sessions.get(sid)
        if (!info) {
          const project = inferProject()
          const result = await runScript([
            "init",
            "--vault", vaultPath,
            "--project", project,
          ])
          if (result && result.session_id) {
            info = {
              obsidianSessionId: result.session_id,
              notePath: result.note_path,
              project,
            }
            sessions.set(sid, info)
          }
        }
        if (!info) return

        injected.add(sid)

        output.parts.unshift({
          id: "prt_sessionlogger" + Math.random().toString(36).slice(2, 14),
          sessionID: sid,
          messageID: output.message.id,
          type: "text",
          synthetic: true,
          text: injectionText(info.obsidianSessionId, info.project),
        })
      } catch {}
    },
  }
}
