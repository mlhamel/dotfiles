#!/usr/bin/env bash
set -euo pipefail

# setup.sh — one-command bootstrap for a fresh machine.
#
# Chains, in order:
#   1. kernel inotify limit    (fs.inotify.max_user_watches via sysctl, persisted
#                              to /etc/sysctl.d/99-dotfiles-inotify.conf)
#   2. opencode binary         (pinned V2, see OPENCODE_VERSION below, via
#                              official curl script, replaces V1;
#                              OPENCODE_VERSION=x.y.z overrides the pin;
#                              SKIP_OPENCODE=1; FORCE_OPENCODE=1 reinstalls)
#   3. config symlink          (opencode/install.sh, then `opencode reload`)
#   4. Director + wiring        (opencode/setup-director.sh; SKIP_DIRECTOR=1)
#   5. packages                (apt/ on Debian/Ubuntu, homebrew/ via
#                              `brew bundle` on macOS; SKIP_PACKAGES=1)
#   6. ollama gateway + models (opencode/setup-ollama.sh; needs the packages
#                              step's python3; SKIP_OLLAMA=1)
#
# Idempotent: every step is safe to re-run.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS="$(uname -s)"

# Pinned opencode version — bump deliberately after checking the release
# notes, never float to latest on every fresh install. Latest release
# 2026-11-24: 2.3.0.
OPENCODE_VERSION="${OPENCODE_VERSION:-2.3.0}"

echo "=== dotfiles bootstrap: ${DIR} ==="

# 1. kernel inotify limit ---------------------------------------------------
echo "[inotify] checking fs.inotify.max_user_watches for opencode config watching..."
INOTIFY_TARGET=1048576
INOTIFY_FILE="/proc/sys/fs/inotify/max_user_watches"
SYSCTL_CONF="/etc/sysctl.d/99-dotfiles-inotify.conf"
if [ "${OS}" != "Linux" ]; then
  echo "[inotify] SKIP ${OS} — Linux-only"
elif [ ! -r "${INOTIFY_FILE}" ]; then
  echo "[inotify] SKIP ${INOTIFY_FILE} not readable"
else
  inotify_current="$(cat "${INOTIFY_FILE}")"
  if [ "${inotify_current}" -ge "${INOTIFY_TARGET}" ] && grep -qs "^fs.inotify.max_user_watches=${INOTIFY_TARGET}$" "${SYSCTL_CONF}"; then
    echo "[inotify] SKIP ${INOTIFY_FILE}=${inotify_current} (runtime >= ${INOTIFY_TARGET} and persisted)"
  else
    echo "[inotify] raising ${INOTIFY_FILE}: ${inotify_current} -> ${INOTIFY_TARGET} (sudo)"
    inotify_tmp="$(mktemp)"
    printf 'fs.inotify.max_user_watches=%s\n' "${INOTIFY_TARGET}" > "${inotify_tmp}"
    if sudo install -m 0644 "${inotify_tmp}" "${SYSCTL_CONF}" && sudo sysctl -p "${SYSCTL_CONF}"; then
      echo "[inotify] done: runtime set and persisted in ${SYSCTL_CONF}"
    else
      echo "[inotify] WARN could not raise limit (sudo?); config-staleness guard weakened" >&2
    fi
    rm -f "${inotify_tmp}"
  fi
fi

# 2. opencode binary --------------------------------------------------------
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
    if [ "${FORCE_OPENCODE:-0}" = 1 ]; then
      echo "[opencode] FORCE_OPENCODE=1 — replacing with pinned ${OPENCODE_VERSION}"
    else
      echo "[opencode] SKIP ${oc_bin} (${oc_ver:-unknown}) already installed; FORCE_OPENCODE=1 to reinstall"
      oc_installed_ver="$(printf '%s' "${oc_ver:-}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
      if [ -n "${oc_installed_ver}" ] && [ "${oc_installed_ver}" != "${OPENCODE_VERSION}" ]; then
        echo "[opencode] NOTE installed ${oc_installed_ver} differs from pinned ${OPENCODE_VERSION} — FORCE_OPENCODE=1 to align" >&2
      fi
      skip_opencode_install=1
    fi
  fi
  if [ "${skip_opencode_install:-0}" != 1 ]; then
    echo "[opencode] running official V2 install script (pinned ${OPENCODE_VERSION})..."
    curl -fsSL https://opencode.ai/v2/install | bash -s -- --version "${OPENCODE_VERSION}"
    command -v opencode >/dev/null 2>&1 || {
      echo "[opencode] installed but not on PATH in this shell; re-run setup.sh from a fresh shell" >&2
    }
  fi
fi

# 3. config symlink ---------------------------------------------------------
echo "[config] deploying opencode config..."
"${DIR}/opencode/install.sh"
if command -v opencode >/dev/null 2>&1 && opencode reload >/dev/null 2>&1; then
  echo "[config] opencode service config reloaded"
else
  echo "[config] SKIP opencode reload (service not running; fresh install picks it up on first start)"
fi

# 4. Director -------------------------------------------------------------
if [ "${SKIP_DIRECTOR:-0}" = "1" ]; then
  echo "[director] SKIP_DIRECTOR=1 — skipping Director setup"
else
  echo "[director] installing Director + wiring opencode..."
  "${DIR}/opencode/setup-director.sh"
fi

# 5. packages ---------------------------------------------------------------
if [ "${SKIP_PACKAGES:-0}" = "1" ]; then
  echo "[packages] SKIP_PACKAGES=1 — skipping package install"
elif [ "${OS}" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
  echo "[packages] installing apt packages..."
  "${DIR}/apt/install.sh"
elif [ "${OS}" = "Darwin" ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "[packages] installing Homebrew packages..."
    if brew bundle --file="${DIR}/homebrew/Brewfile"; then
      echo "[packages] done: Homebrew bundle installed"
    else
      echo "[packages] WARN brew bundle failed — install the remaining packages manually, then re-run setup.sh" >&2
    fi
  else
    echo "[packages] WARN Homebrew not found — install it first, then re-run setup.sh:" >&2
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' >&2
  fi
else
  echo "[packages] no supported package manager (apt/homebrew) — skipping"
fi

# 6. ollama gateway ---------------------------------------------------------
if [ "${SKIP_OLLAMA:-0}" = "1" ]; then
  echo "[ollama] SKIP_OLLAMA=1 — skipping ollama gateway setup"
else
  echo "[ollama] installing gateway + pinned models..."
  "${DIR}/opencode/setup-ollama.sh"
fi

echo "=== bootstrap complete ==="
