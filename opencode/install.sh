#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${HOME}/.config/opencode"

mkdir -p "${HOME}/.config"

if [ -L "${TARGET}" ]; then
  echo "Removing existing symlink: ${TARGET}"
  rm "${TARGET}"
elif [ -d "${TARGET}" ]; then
  BACKUP="${TARGET}.backup.$(date +%Y%m%d%H%M%S)"
  echo "Backing up existing directory: ${TARGET} -> ${BACKUP}"
  mv "${TARGET}" "${BACKUP}"
fi

ln -s "${REPO_DIR}" "${TARGET}"
echo "Deployed: ${TARGET} -> ${REPO_DIR}"
echo "Verify with: opencode  (then check /bless and /new appear in the command list)"

# Bin tools: symlink oh-fix into ~/.local/bin so it is on PATH after setup.
# The chmod repairs the mode when the file landed 644 (GitHub API pushes do
# not preserve the executable bit); on a normal clone it is a no-op, so it
# only runs when the executable bit is actually missing and a mode repair
# that the current user cannot perform (repo owned by another uid) is
# skipped rather than aborting the bootstrap under set -e. The file guard
# keeps the bootstrap working when the tool is absent (partial trees).
if [ -f "${REPO_DIR}/bin/oh-fix" ]; then
  mkdir -p "${HOME}/.local/bin"
  if [ ! -x "${REPO_DIR}/bin/oh-fix" ]; then
    chmod +x "${REPO_DIR}/bin/oh-fix" 2>/dev/null || true
  fi
  ln -sfn "${REPO_DIR}/bin/oh-fix" "${HOME}/.local/bin/oh-fix"
  echo "Installed: ${HOME}/.local/bin/oh-fix -> ${REPO_DIR}/bin/oh-fix"
  if ! command -v oh-fix >/dev/null 2>&1; then
    echo "NOTE oh-fix is installed but ~/.local/bin is not on PATH in this shell; re-login or export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
  fi
fi
