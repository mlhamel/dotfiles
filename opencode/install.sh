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
