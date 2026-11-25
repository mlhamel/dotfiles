#!/usr/bin/env bash
set -euo pipefail

# generate.sh — dump this machine's manually-installed apt packages into
# Aptfile, filtering out Debian base/system packages so the file only lists
# what a human chose to install.
#
#   ./generate.sh              # overwrite Aptfile
#   ./generate.sh --check      # exit 1 if Aptfile is out of date (no writes)
#
# Filtering: drops packages that are (a) priority required/important/standard
# AND not marked essential by dpkg (Debian's own base footprint), (b) dpkg
# essential packages (bash, coreutils, ...), (c) runtime lib* dependencies
# (kept are lib*-dev and explicit non-lib entries), or (d) listed in
# exclude.txt (machine-specific exclusions: firmware, task-* metas, ...).

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APTFILE="${DIR}/Aptfile"
EXCLUDE="${DIR}/exclude.txt"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

if ! command -v apt-mark >/dev/null 2>&1; then
  echo "Error: apt-mark not found — this generator is Debian/Ubuntu only." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

apt-mark showmanual | sort > "${TMP}/manual"

dpkg-query -W -f='${Package}\t${Priority}\t${Essential}\n' 2>/dev/null \
  | awk '$2 ~ /^(required|important|standard)$/ && $3 != "yes" {print $1}' \
  | sort > "${TMP}/base"

comm -23 "${TMP}/manual" "${TMP}/base" > "${TMP}/result"

dpkg-query -W -f='${Package}\t${Essential}\n' 2>/dev/null \
  | awk '$2 == "yes" {print $1}' | sort > "${TMP}/essential"

comm -23 "${TMP}/result" "${TMP}/essential" > "${TMP}/result2"

awk '$0 ~ /^lib/ && $0 !~ /-dev(:[a-z0-9]+)?$/ { next } { print }' \
  "${TMP}/result2" > "${TMP}/final"

if [ -f "${EXCLUDE}" ]; then
  grep -vE '^\s*(#|$)' "${EXCLUDE}" | sort > "${TMP}/exclude" || true
  if [ -s "${TMP}/exclude" ]; then
    comm -23 "${TMP}/final" "${TMP}/exclude" > "${TMP}/filtered"
    mv "${TMP}/filtered" "${TMP}/final"
  fi
fi

if [ "${CHECK}" = 1 ]; then
  if diff -q "${TMP}/final" "${APTFILE}" >/dev/null 2>&1; then
    echo "Aptfile is up to date."
    exit 0
  fi
  echo "Aptfile is out of date. Regenerate with: ./generate.sh" >&2
  diff "${TMP}/final" "${APTFILE}" || true
  exit 1
fi

cp "${TMP}/final" "${APTFILE}"
echo "Wrote $(wc -l < "${APTFILE}") packages to ${APTFILE}"
