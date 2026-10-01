---
name: scaffolding
description: Per-language reference for scaffolding new projects with official tooling, test runners, and linters
---

# Scaffolding reference

Always use the official scaffolder for the language. Never hand-roll project structure. Default to the modern, idiomatic toolchain.

## Python

```bash
uv init <name> --package          # project with src/ layout
cd <name>
uv add --dev pytest ruff
```

- Test: `uv run pytest`
- Lint/format: `uv run ruff check .` / `uv run ruff format .`
- Structure: `src/<name>/__init__.py`, tests in `tests/`
- Example test file: `tests/test_smoke.py` with `def test_import(): import <name>`

## TypeScript / Node

```bash
npm create vite@latest <name> -- --template vanilla-ts
cd <name>
npm install
npm install -D vitest @biomejs/biome
```

- Test: `npm test` (add `"test": "vitest run"` to package.json scripts)
- Lint/format: `npx biome check .`
- For CLIs/services instead of Vite, use the matching official scaffolder (`pnpm create t3-app`, `npm create cloudflare@latest`, etc.) — ask the user which fits.
- Example test: `src/smoke.test.ts` with `import { expect, test } from "vitest"`

## Rust

```bash
cargo new <name>
cd <name>
cargo test
```

- Test: `cargo test`
- Lint: `cargo clippy -- -D warnings`
- Format: `cargo fmt --check`
- Scaffolder already provides module layout, `.gitignore`, and a placeholder test — extend it, don't restructure.

## Go

```bash
mkdir <name> && cd <name>
go mod init github.com/mlhamel/<name>
```

- Test: `go test ./...`
- Lint: `golangci-lint run` (fall back to `go vet ./...` if not installed)
- Add `main.go` with `package main` and `func main()`, plus `main_test.go`
- `.gitignore`: standard Go ignores (binaries, coverage files)

## Any language not listed

1. Find the official or most widely adopted scaffolder (do not guess — search).
2. Confirm the choice with the user before scaffolding.
3. Apply the same baseline: `.gitignore`, README, one example test, lint config.