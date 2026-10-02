#!/usr/bin/env bash
set -euo pipefail

# install.sh — install the packages listed in the Aptfile.
#
#   ./install.sh            # sudo as needed
#   ./install.sh --dry-run  # print what would run, install nothing
#
# Third-party repo packages (docker-ce, google-chrome-stable, brave-browser,
# etc.) only resolve if their apt sources/keyrings are already configured;
# this script manages the package list, not the sources.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APTFILE="${DIR}/Aptfile"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

if [ ! -f "${APTFILE}" ]; then
  echo "Error: ${APTFILE} not found. Generate it with: ./generate.sh" >&2
  exit 1
fi

PACKAGES="$(grep -vE '^\s*(#|$)' "${APTFILE}")"

if [ -z "${PACKAGES}" ]; then
  echo "Aptfile is empty; nothing to install."
  exit 0
fi

if [ "${DRY_RUN}" = 1 ]; then
  echo "apt-get update"
  echo "xargs apt-get install -y --no-install-recommends <<EOF"
  echo "${PACKAGES}"
  echo "EOF"
  exit 0
fi

SUDO=""
if [ "$(id -u)" != 0 ]; then
  SUDO="sudo"
fi

echo "Updating package lists..."
${SUDO} apt-get update

echo "Installing $(echo "${PACKAGES}" | wc -l) packages from ${APTFILE}..."
echo "${PACKAGES}" | xargs ${SUDO} apt-get install -y --no-install-recommends

echo "Done. Packages missing due to absent third-party sources can be"
echo "installed manually once their apt repo is configured."
