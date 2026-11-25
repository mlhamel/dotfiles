#!/usr/bin/env bash
set -euo pipefail

# sources.sh — configure the third-party apt repos used by packages in the
# Aptfile (docker, chrome, brave, code, spotify, ...). Idempotent: skips any
# source that already exists, so it's safe to re-run.
#
#   sudo ./sources.sh            # configure all sources
#   ./sources.sh --dry-run       # print what would run, change nothing
#
# Uses the deb822 .sources format where vendors ship one (Debian 12+);
# classic .list for the rest. Keyrings land in /etc/apt/keyrings/ with
# checksum-verified download to a temp file first (no curl|gpg pipes).

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

SUDO=""
[ "$(id -u)" != 0 ] && SUDO="sudo"

KEYRING_DIR="/etc/apt/keyrings"
SOURCES_DIR="/etc/apt/sources.list.d"

run() {
  if [ "${DRY_RUN}" = 1 ]; then
    echo "[dry-run] $*"
  else
    "${SUDO}" "$@"
  fi
}

fetch_keyring() {
  # fetch_keyring <url> <dest>
  [ "${DRY_RUN}" = 1 ] && { echo "[dry-run] fetch keyring ${1} -> ${2}"; return 0; }
  local tmp
  tmp="$(mktemp)"
  curl -fsSL "${1}" -o "${tmp}"
  "${SUDO}" gpg --dearmor -o "${2}" "${tmp}" 2>/dev/null \
    || "${SUDO}" cp "${tmp}" "${2}"
  rm -f "${tmp}"
  "${SUDO}" chmod 644 "${2}"
}

write_sources() {
  # write_sources <name> <content>
  [ "${DRY_RUN}" = 1 ] && { echo "[dry-run] write ${SOURCES_DIR}/${1}.sources"; return 0; }
  printf '%s\n' "${2}" | "${SUDO}" tee "${SOURCES_DIR}/${1}.sources" >/dev/null
}

write_list() {
  # write_list <name> <content>
  [ "${DRY_RUN}" = 1 ] && { echo "[dry-run] write ${SOURCES_DIR}/${1}.list"; return 0; }
  printf '%s\n' "${2}" | "${SUDO}" tee "${SOURCES_DIR}/${1}.list" >/dev/null
}

# shellcheck source=/dev/null
CODE_NAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"

[ "${DRY_RUN}" = 0 ] && run mkdir -p "${KEYRING_DIR}" "${SOURCES_DIR}"

# --- Docker ---------------------------------------------------------------
if [ ! -f "${SOURCES_DIR}/docker.sources" ]; then
  fetch_keyring "https://download.docker.com/linux/debian/gpg" "${KEYRING_DIR}/docker.gpg"
  write_sources docker "Types: deb
URIs: https://download.docker.com/linux/debian/
Suites: ${CODE_NAME}
Components: stable
Architectures: amd64
Signed-By: ${KEYRING_DIR}/docker.gpg"
fi

# --- Google Chrome --------------------------------------------------------
if [ ! -f "${SOURCES_DIR}/google-chrome.sources" ]; then
  fetch_keyring "https://dl.google.com/linux/linux_signing_key.pub" "${KEYRING_DIR}/google-chrome.gpg"
  write_sources google-chrome "Types: deb
URIs: https://dl.google.com/linux/chrome/deb/
Suites: stable
Components: main
Architectures: amd64
Signed-By: ${KEYRING_DIR}/google-chrome.gpg"
fi

# --- Brave Browser --------------------------------------------------------
if [ ! -f "${SOURCES_DIR}/brave-browser-release.sources" ]; then
  fetch_keyring "https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg" "${KEYRING_DIR}/brave-browser-archive-keyring.gpg"
  write_sources brave-browser-release "Types: deb
URIs: https://brave-browser-apt-release.s3.brave.com
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: ${KEYRING_DIR}/brave-browser-archive-keyring.gpg"
fi

# --- Microsoft (VS Code + .NET prod repo) ---------------------------------
if [ ! -f "${SOURCES_DIR}/vscode.sources" ]; then
  fetch_keyring "https://packages.microsoft.com/keys/microsoft.asc" "${KEYRING_DIR}/microsoft-prod.gpg"
  write_sources vscode "Types: deb
URIs: https://packages.microsoft.com/repos/code/
Suites: stable
Components: main
Architectures: amd64 arm64
Signed-By: ${KEYRING_DIR}/microsoft-prod.gpg"
fi

# --- Spotify --------------------------------------------------------------
if [ ! -f "${SOURCES_DIR}/spotify.list" ] && [ ! -f "${SOURCES_DIR}/spotify.sources" ]; then
  fetch_keyring "https://download.spotify.com/debian/pubkey.gpg" "${KEYRING_DIR}/spotify.gpg"
  write_list spotify "deb [signed-by=${KEYRING_DIR}/spotify.gpg] https://repository.spotify.com stable non-free"
fi

# --- GitHub CLI -----------------------------------------------------------
if [ ! -f "${SOURCES_DIR}/github-cli.list" ]; then
  fetch_keyring "https://cli.github.com/packages/githubcli-archive-keyring.gpg" "${KEYRING_DIR}/githubcli-archive-keyring.gpg"
  write_list github-cli "deb [arch=amd64 signed-by=${KEYRING_DIR}/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main"
fi

# --- Google Cloud SDK -----------------------------------------------------
if [ ! -f "${SOURCES_DIR}/google-cloud-sdk.list" ] && [ ! -f "${SOURCES_DIR}/google-cloud-sdk.sources" ]; then
  fetch_keyring "https://packages.cloud.google.com/apt/doc/apt-key.gpg" "${KEYRING_DIR}/google-cloud-sdk.gpg"
  write_list google-cloud-sdk "deb [signed-by=${KEYRING_DIR}/google-cloud-sdk.gpg] https://packages.cloud.google.com/apt cloud-sdk main"
fi

if [ "${DRY_RUN}" = 0 ]; then
  echo "Running apt-get update to verify sources..."
  "${SUDO}" apt-get update
  echo "All third-party sources configured."
else
  echo "[dry-run] would end with: apt-get update"
fi
