#!/usr/bin/env bash
set -euo pipefail

# setup-director.sh — install the Director binary and wire it into opencode.
# Idempotent: safe to re-run; an existing healthy install is left alone.
# Skip with: SKIP_DIRECTOR=1 (e.g. non-macOS CI boxes, minimal setups).
#
# Version pin: DIRECTOR_VERSION defaults to v1.23.0 (latest upstream release,
# 2026-10-27). Note the installer script is fetched from the mlhamel/director
# fork, but the script itself downloads its binary from
# colinsurprenant/director releases — the fork has no releases of its own,
# so the pin below is an upstream tag. Override with DIRECTOR_VERSION=vX.Y.Z.

DIRECTOR_INSTALL_DIR="${HOME}/.local/bin"
DIRECTOR_REPO="mlhamel/director"
DIRECTOR_VERSION="${DIRECTOR_VERSION:-v1.23.0}"

if [ "${SKIP_DIRECTOR:-0}" = "1" ]; then
  echo "SKIP_DIRECTOR=1 — skipping Director setup"
  exit 0
fi

if command -v director >/dev/null 2>&1 && director doctor >/dev/null 2>&1; then
  installed_ver="$(director version 2>/dev/null || echo unknown)"
  echo "Director already installed and healthy: $(command -v director) (${installed_ver})"
  case "${installed_ver}" in
    *"${DIRECTOR_VERSION}"*) ;;
    *) echo "NOTE installed version differs from pinned ${DIRECTOR_VERSION} — remove $(command -v director) and re-run to align" >&2 ;;
  esac
  echo "To re-wire opencode after a fresh deploy, run: director install --opencode"
  exit 0
fi

echo "Installing Director ${DIRECTOR_VERSION} from github.com/${DIRECTOR_REPO}..."
curl -fsSL "https://raw.githubusercontent.com/${DIRECTOR_REPO}/main/install.sh" | sh -s -- --version "${DIRECTOR_VERSION}"

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
