#!/usr/bin/env bash
set -euo pipefail

# setup.sh — one-command bootstrap for a fresh machine.
#
# Chains, in order:
#   1. opencode binary        (skipped if already on PATH; SKIP_OPENCODE=1)
#   2. config symlink         (opencode/install.sh)
#   3. Director + wiring       (opencode/setup-director.sh; SKIP_DIRECTOR=1)
#   4. packages               (apt/ on Debian/Ubuntu, homebrew/ hint on macOS;
#                              SKIP_PACKAGES=1)
#
# Idempotent: every step is safe to re-run.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== dotfiles bootstrap: ${DIR} ==="

# 1. opencode binary ------------------------------------------------------
if [ "${SKIP_OPENCODE:-0}" = 1 ]; then
  echo "[opencode] SKIP_OPENCODE=1 — skipping binary install"
elif command -v opencode >/dev/null 2>&1; then
  echo "[opencode] already installed: $(command -v opencode) ($(opencode --version 2>/dev/null | head -1))"
else
  echo "[opencode] installing via official install script..."
  curl -fsSL https://opencode.ai/install | bash
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
if [ "${SKIP_PACKAGES:-0}" = 1 ]; then
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

echo "=== bootstrap complete ==="
