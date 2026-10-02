#!/usr/bin/env bash
set -euo pipefail

# setup-director.sh — install the Director binary and wire it into opencode.
# Idempotent: safe to re-run; an existing healthy install is left alone.
# Skip with: SKIP_DIRECTOR=1 (e.g. non-macOS CI boxes, minimal setups).

DIRECTOR_INSTALL_DIR="${HOME}/.local/bin"
DIRECTOR_REPO="mlhamel/director"

if [ "${SKIP_DIRECTOR:-0}" = "1" ]; then
  echo "SKIP_DIRECTOR=1 — skipping Director setup"
  exit 0
fi

if command -v director >/dev/null 2>&1 && director doctor >/dev/null 2>&1; then
  echo "Director already installed and healthy: $(command -v director) ($(director version 2>/dev/null || echo unknown))"
  echo "To re-wire opencode after a fresh deploy, run: director install --opencode"
  exit 0
fi

echo "Installing Director from github.com/${DIRECTOR_REPO}..."
curl -fsSL "https://raw.githubusercontent.com/${DIRECTOR_REPO}/main/install.sh" | sh

if ! command -v director >/dev/null 2>&1; then
  export PATH="${DIRECTOR_INSTALL_DIR}:${PATH}"
fi

command -v director >/dev/null 2>&1 || {
  echo "Error: director binary not found on PATH after install (expected ${DIRECTOR_INSTALL_DIR})" >&2
  exit 1
}

echo "Wiring Director into opencode..."
director install --opencode

echo "Verifying..."
director doctor || exit 1

echo "Director is set up: binary on PATH, opencode plugin wired, hub at ~/.director"