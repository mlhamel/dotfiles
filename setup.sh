#!/usr/bin/env bash
set -euo pipefail

# setup.sh — one-command bootstrap for a fresh machine.
#
# Chains, in order:
#   1. opencode binary        (latest V2 via official curl script, replaces V1;
#                              SKIP_OPENCODE=1)
#   2. config symlink         (opencode/install.sh)
#   3. Director + wiring       (opencode/setup-director.sh; SKIP_DIRECTOR=1)
#   4. packages               (apt/ on Debian/Ubuntu, homebrew/ hint on macOS;
#                              SKIP_PACKAGES=1)
#   5. ollama gateway + models (opencode/setup-ollama.sh; needs the packages
#                              step's python3; SKIP_OLLAMA=1)
#
# Idempotent: every step is safe to re-run.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== dotfiles bootstrap: ${DIR} ==="

# 1. opencode binary ------------------------------------------------------
if [ "${SKIP_OPENCODE:-0}" = 1 ]; then
  echo "[opencode] SKIP_OPENCODE=1 — skipping binary install"
else
  if command -v opencode >/dev/null 2>&1; then
    oc_bin="$(command -v opencode)"
    oc_ver="$(opencode --version 2>/dev/null | head -1 || true)"
    echo "[opencode] current install: ${oc_bin} (${oc_ver})"
    if [ -n "$(dpkg -S "${oc_bin}" 2>/dev/null || true)" ]; then
      echo "[opencode] ${oc_bin} is owned by a .deb package; remove it first, then re-run setup.sh" >&2
      exit 1
    elif command -v brew >/dev/null 2>&1 && [ -n "$(brew list --formula opencode 2>/dev/null || true)" ]; then
      echo "[opencode] ${oc_bin} is brew-managed; run 'brew uninstall opencode' first, then re-run setup.sh" >&2
      exit 1
    elif [ "${oc_bin#*node_modules/}" != "${oc_bin}" ]; then
      echo "[opencode] ${oc_bin} is npm-managed; run 'npm uninstall -g @opencode/cli' first, then re-run setup.sh" >&2
      exit 1
    fi
    echo "[opencode] the V2 installer replaces it with the latest release"
  fi
  echo "[opencode] running official V2 install script..."
  curl -fsSL https://opencode.ai/v2/install | bash
  command -v opencode >/dev/null 2>&1 || {
    echo "[opencode] installed but not on PATH in this shell; re-run setup.sh from a fresh shell" >&2
  }
fi

# 2. config symlink -------------------------------------------------------
echo "[config] deploying opencode config..."
"${DIR}/opencode/install.sh"

# 3. Director -------------------------------------------------------------
echo "[director] installing Director + wiring opencode..."
"${DIR}/opencode/setup-director.sh"

# 4. packages -------------------------------------------------------------
OS="$(uname -s)"
if [ "${SKIP_PACKAGES:-0}" = "1" ]; then
  echo "[packages] SKIP_PACKAGES=1 — skipping package install"
elif [ "${OS}" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
  echo "[packages] installing apt packages..."
  "${DIR}/apt/install.sh"
elif [ "${OS}" = "Darwin" ]; then
  echo "[packages] macOS detected — Homebrew flow is manual:"
  echo "  brew bundle --file=${DIR}/homebrew/Brewfile"
  echo "  (or: cd ${DIR} && bundle install && rake)"
else
  echo "[packages] no supported package manager (apt/homebrew) — skipping"
fi

# 5. ollama gateway ---------------------------------------------------------
echo "[ollama] installing gateway + pinned models..."
"${DIR}/opencode/setup-ollama.sh"

echo "=== bootstrap complete ==="
