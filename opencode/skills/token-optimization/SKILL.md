---
name: token-optimization
description: Use when sessions burn excessive tokens or hit context limits, when tool searches ingest junk, or when tuning model routing, tool-output caps, and cost/latency; covers .gitignore/.ignore ingestion boundaries, schema-not-dataset payloads, session discipline, and the oc-tokens audit loop
---

# Token efficiency

Operating protocol for minimizing token consumption, API cost, and latency in
opencode sessions. The loop: **measure → find the outlier → fix → re-measure.**

## 1. Measure first: `bin/oc-tokens`

`~/.config/opencode/bin/oc-tokens` turns opencode's SQLite session DB into a
report: top sessions by input tokens, spirals (sessions above a message-count
threshold, default 50), per-agent/model efficiency, and baselines. Read-only;
`--days`, `--spiral`, `--db` flags.

Run it weekly and after any agent/model change. Aim for sessions around 8
messages; use the report to spot outliers. Every fix below should trace back
to a number in this report.

## 2. Ingestion boundaries

opencode's `grep`/`glob` run on ripgrep, which respects `.gitignore` by
default — files excluded from git are excluded from tool search. There is no
`.opencodeignore`; control ingestion through:

- `.gitignore` — the primary mechanism.
- `.ignore` — ripgrep-specific overrides; `!pattern` lines re-include what
  `.gitignore` excludes.

Keep build artifacts (`target/`, `dist/`, `build/`, lockfiles), binaries and
media, and bulky generated/static data out of search context. For repos where
gitignoring is wrong (data must be committed), prefer a committed `.ignore` if
the tooling supports it, or scope searches to `src/`-style subtrees.

**Golden rule for large datasets:** never let the agent read a full database
dump (hundreds of star systems, ship variants, trade tables). Provide a 3–5
line schema representation instead:

```rust
// schema, not dataset
pub struct SystemData {
    pub id: u32,
    pub name: String,
    pub coordinates: [f32; 2],
    pub jump_links: Vec<u32>,
}
```

## 3. Session discipline

- **Feature-scoped sessions**: end or fork the thread once a unit of work
  finishes. A 40-turn history resends every prior file dump on every turn —
  exponential growth.
- **Commit-and-reset cycle**: define requirement → implement + tests →
  commit → fresh session for the next task.
- Use `/session-handoff` to checkpoint a long thread before resetting it.

## 4. Payload minimization

- **Interface over implementation**: send trait/function signatures, not the
  500-line implementations behind them:

  ```rust
  // pass this
  pub trait PilotController {
      fn apply_thrust(&mut self, heading: f32, power: f32);
  }

  // not the 500-line controller implementation
  ```

- **Targeted tool invocation**: paste `cargo check` error snippets or
  compiler excerpts, never whole file buffers.
- **Tool-output caps**: `"tool_output": { "max_lines": ..., "max_bytes": ... }`
  in `opencode.json` truncates oversized tool results (full output is written
  to a file the agent can read in slices) — tight enough to force targeted
  reads, loose enough to keep useful command output intact.

## 5. Model routing

Divide labor by model strength; pin per agent via `model:` frontmatter.

| Responsibility                              | Model                         | Where                                    |
| ------------------------------------------- | ----------------------------- | ---------------------------------------- |
| Heavy build work                            | `ollama/glm-5.3:cloud`        | global default                           |
| Independent review, diagrams (cross-family) | `ollama/kimi-k2.7-code:cloud` | `agents/review.md`, `agents/diagrams.md` |
| Routine internal tasks (titles, summaries)  | `ollama/glm-5.2:cloud`        | `"small_model"` in `opencode.json`       |

## 6. Gateway

All traffic flows through one local OpenAI-compatible endpoint (ollama at
`http://localhost:11434/v1`), so models swap without touching opencode config.
If response caching or provider-side prefix caching becomes necessary, LiteLLM
(Redis-backed, port 8000) can slot in between opencode and the providers
without any other change.
