#!/usr/bin/env bash
# shellcheck disable=SC2329  # case functions are invoked indirectly via run_case
# test/shell/run.sh — committed harness for the bootstrap scripts.
#
# Each case runs the real script with a scratch HOME and stub binaries on
# PATH: no sudo, no apt, no network, no model downloads. Stubs record every
# invocation to $STUB_LOG so cases can assert on what was called.
#
# Scripts are invoked via `bash` on purpose: it keeps the harness working
# regardless of file modes, and `setup.sh` itself invokes the other two
# directly. The harness previously surfaced a missing +x on these three
# scripts (they were mode 644 in git, so direct execution failed 126 on a
# fresh clone); that was fixed on this branch by commit 4a1eec9d ("fix:
# restore executable bit on bootstrap scripts"). See test/README.md.
#
#   bash test/shell/run.sh           # run everything
#   bash test/shell/run.sh ollama    # only cases matching "ollama"
#
# Exit code is non-zero when any case fails. The gateway-down case takes
# ~30s: setup-ollama.sh retries the gateway for 30 x 1s by design.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILTER="${1:-}"
PASS_COUNT=0
FAIL_COUNT=0
FAILED=()
CASE_FAILED=0

# --- assertions (set CASE_FAILED, keep going) -------------------------------

check_rc() {
  local want="$1" got="$2" desc="$3"
  if [ "${want}" != "${got}" ]; then
    echo "  FAIL: ${desc} (want exit ${want}, got ${got})" >&2
    CASE_FAILED=1
  fi
}

check_rc_nonzero() {
  local got="$1" desc="$2"
  if [ "${got}" -eq 0 ]; then
    echo "  FAIL: ${desc} (want non-zero exit, got 0)" >&2
    CASE_FAILED=1
  fi
}

check_contains() {
  local file="$1" needle="$2" desc="$3"
  if grep -qF -- "${needle}" "${file}"; then
    return 0
  fi
  echo "  FAIL: ${desc} (missing '${needle}')" >&2
  CASE_FAILED=1
}

check_not_contains() {
  local file="$1" needle="$2" desc="$3"
  if grep -qF -- "${needle}" "${file}"; then
    echo "  FAIL: ${desc} (unexpected '${needle}')" >&2
    CASE_FAILED=1
  fi
}

check_symlink_to() {
  local link="$1" target="$2" desc="$3"
  if [ -L "${link}" ] && [ "$(readlink "${link}")" = "${target}" ]; then
    return 0
  fi
  echo "  FAIL: ${desc} (want symlink ${link} -> ${target})" >&2
  CASE_FAILED=1
}

# --- per-case sandbox -------------------------------------------------------

new_case() {
  CASE_HOME="$(mktemp -d "${TMPDIR:-/tmp}/dotfiles-test-home.XXXXXX")"
  CASE_BIN="$(mktemp -d "${TMPDIR:-/tmp}/dotfiles-test-bin.XXXXXX")"
  STUB_LOG="${CASE_HOME}/stub.log"
  export HOME="${CASE_HOME}" STUB_LOG
  PATH="${CASE_BIN}:/usr/bin:/bin"
  export PATH
  touch "${STUB_LOG}"
  trap 'rm -rf "${CASE_HOME}" "${CASE_BIN}"' EXIT
}

finish_case() {
  exit "${CASE_FAILED}"
}

# --- stubs (written into $CASE_BIN, first on PATH) --------------------------

stub_curl() {
  cat > "${CASE_BIN}/curl" <<'CURL_EOF'
#!/bin/sh
echo "curl $*" >> "$STUB_LOG"
case "$*" in
  *localhost:11434*)
    exit "${STUB_GATEWAY_RC:-0}"
    ;;
  *opencode.ai/v2/install*)
    cat <<'INSTALLER_EOF'
#!/bin/sh
echo "fake-opencode-installer args: $*" >> "$STUB_LOG"
INSTALLER_EOF
    exit 0
    ;;
  *raw.githubusercontent.com/mlhamel/director/main/install.sh*)
    cat <<'INSTALLER_EOF'
#!/bin/sh
echo "fake-director-installer args: $*" >> "$STUB_LOG"
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/director" <<'DIRECTOR_EOF'
#!/bin/sh
echo "director $*" >> "$STUB_LOG"
case "$1" in
  doctor) exit 0 ;;
  version) echo "director version v1.23.0" ;;
  install) exit 0 ;;
  *) exit 0 ;;
esac
DIRECTOR_EOF
chmod +x "$HOME/.local/bin/director"
INSTALLER_EOF
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
CURL_EOF
  chmod +x "${CASE_BIN}/curl"
}

stub_ollama() {
  cat > "${CASE_BIN}/ollama" <<'OLLAMA_EOF'
#!/bin/sh
echo "ollama $*" >> "$STUB_LOG"
if [ "${1:-}" = "pull" ] && [ "${2:-}" = "${STUB_OLLAMA_FAIL:-}" ]; then
  echo "stub: failing pull of $2" >&2
  exit 1
fi
exit 0
OLLAMA_EOF
  chmod +x "${CASE_BIN}/ollama"
}

stub_opencode() {
  cat > "${CASE_BIN}/opencode" <<'OPENCODE_EOF'
#!/bin/sh
echo "opencode $*" >> "$STUB_LOG"
case "${1:-}" in
  --version) echo "${STUB_OPENCODE_VERSION:-2.3.0}" ;;
  reload) exit 0 ;;
  *) exit 0 ;;
esac
OPENCODE_EOF
  chmod +x "${CASE_BIN}/opencode"
}

stub_director() {
  cat > "${CASE_BIN}/director" <<'DIRECTOR_EOF'
#!/bin/sh
echo "director $*" >> "$STUB_LOG"
case "${1:-}" in
  doctor) exit "${STUB_DIRECTOR_DOCTOR_RC:-0}" ;;
  version) echo "${STUB_DIRECTOR_VERSION_OUTPUT:-director version v1.23.0}" ;;
  install) exit 0 ;;
  *) exit 0 ;;
esac
DIRECTOR_EOF
  chmod +x "${CASE_BIN}/director"
}

stub_dpkg() {
  cat > "${CASE_BIN}/dpkg" <<'DPKG_EOF'
#!/bin/sh
exit 1
DPKG_EOF
  chmod +x "${CASE_BIN}/dpkg"
}

stub_sudo() {
  cat > "${CASE_BIN}/sudo" <<'SUDO_EOF'
#!/bin/sh
echo "sudo $*" >> "$STUB_LOG"
exit 1
SUDO_EOF
  chmod +x "${CASE_BIN}/sudo"
}

write_ollama_config() {
  mkdir -p "${CASE_HOME}/.config/opencode"
  cat > "${CASE_HOME}/.config/opencode/opencode.json" <<'JSON_EOF'
{
  "providers": {
    "ollama": {
      "models": {
        "qwen3:4b": {},
        "glm-5.3-flash:cloud": {}
      }
    }
  }
}
JSON_EOF
}

# --- setup-ollama.sh --------------------------------------------------------

case_ollama_happy() {
  new_case
  stub_curl
  stub_ollama
  write_ollama_config
  bash "${ROOT}/opencode/setup-ollama.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "happy path exits 0"
  check_contains "${CASE_HOME}/out.log" "pulling local model qwen3:4b" "pulls the local model"
  check_contains "${CASE_HOME}/out.log" "registering cloud model glm-5.3-flash:cloud" "registers the cloud model"
  check_contains "${STUB_LOG}" "ollama pull qwen3:4b" "ollama pull called for local"
  check_contains "${STUB_LOG}" "ollama pull glm-5.3-flash:cloud" "ollama pull called for cloud"
  check_contains "${CASE_HOME}/out.log" "Ollama gateway ready" "ready message"
  finish_case
}

case_ollama_local_fail() {
  new_case
  stub_curl
  stub_ollama
  write_ollama_config
  STUB_OLLAMA_FAIL="qwen3:4b" bash "${ROOT}/opencode/setup-ollama.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc_nonzero "${rc}" "failed local pull aborts the script"
  check_contains "${CASE_HOME}/out.log" "pulling local model qwen3:4b" "local pull was attempted"
  check_contains "${STUB_LOG}" "ollama pull qwen3:4b" "ollama pull called for local"
  check_not_contains "${STUB_LOG}" "glm-5.3-flash:cloud" "cloud model not attempted after local failure"
  finish_case
}

case_ollama_cloud_fail() {
  new_case
  stub_curl
  stub_ollama
  write_ollama_config
  STUB_OLLAMA_FAIL="glm-5.3-flash:cloud" bash "${ROOT}/opencode/setup-ollama.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "failed cloud registration is a warning, not fatal"
  check_contains "${CASE_HOME}/out.log" "WARN could not register glm-5.3-flash:cloud" "warns about the cloud model"
  check_contains "${CASE_HOME}/out.log" "ollama signin" "points at ollama signin"
  check_contains "${CASE_HOME}/out.log" "gateway ready, but some cloud models are not registered" "reports partial readiness"
  check_contains "${STUB_LOG}" "ollama pull qwen3:4b" "local model still pulled"
  finish_case
}

case_ollama_skip() {
  new_case
  stub_curl
  stub_ollama
  write_ollama_config
  SKIP_OLLAMA=1 bash "${ROOT}/opencode/setup-ollama.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "SKIP_OLLAMA=1 exits 0"
  check_contains "${CASE_HOME}/out.log" "SKIP_OLLAMA=1" "skip message"
  check_not_contains "${STUB_LOG}" "ollama pull" "no pull attempted when skipped"
  finish_case
}

case_ollama_gateway_down() {
  new_case
  stub_curl
  stub_ollama
  write_ollama_config
  STUB_GATEWAY_RC=1 bash "${ROOT}/opencode/setup-ollama.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc_nonzero "${rc}" "dead gateway aborts the script"
  check_contains "${CASE_HOME}/out.log" "not answering on localhost:11434" "gateway error message"
  check_not_contains "${STUB_LOG}" "ollama pull" "no pull attempted without a gateway"
  finish_case
}

# --- setup.sh ---------------------------------------------------------------

setup_env() {
  SKIP_DIRECTOR=1 SKIP_PACKAGES=1 SKIP_OLLAMA=1 bash "${ROOT}/setup.sh" > "${CASE_HOME}/out.log" 2>&1
}

case_setup_skip_pinned() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  setup_env
  local rc=$?
  check_rc 0 "${rc}" "skip path exits 0"
  check_contains "${CASE_HOME}/out.log" "already installed" "reports the installed binary"
  check_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap completes"
  check_not_contains "${STUB_LOG}" "opencode.ai" "no installer download when pinned version is present"
  check_symlink_to "${CASE_HOME}/.config/opencode" "${ROOT}/opencode" "config symlink deployed"
  finish_case
}

case_setup_drift() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  export STUB_OPENCODE_VERSION="2.2.0"
  stub_opencode
  setup_env
  local rc=$?
  check_rc 0 "${rc}" "drift path exits 0"
  check_contains "${CASE_HOME}/out.log" "NOTE installed 2.2.0 differs from pinned 2.3.0" "drift note names both versions"
  check_not_contains "${STUB_LOG}" "opencode.ai" "no reinstall without FORCE_OPENCODE"
  finish_case
}

case_setup_force() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  FORCE_OPENCODE=1 SKIP_DIRECTOR=1 SKIP_PACKAGES=1 SKIP_OLLAMA=1 bash "${ROOT}/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "force path exits 0"
  check_contains "${STUB_LOG}" "fake-opencode-installer args: --version 2.3.0" "installer receives the pinned version"
  check_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap completes"
  finish_case
}

case_setup_fresh() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  setup_env
  local rc=$?
  check_rc 0 "${rc}" "fresh install exits 0"
  check_contains "${STUB_LOG}" "fake-opencode-installer args: --version 2.3.0" "installer receives the pinned version"
  check_contains "${CASE_HOME}/out.log" "not on PATH" "warns the binary is not on PATH yet"
  check_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap completes"
  check_symlink_to "${CASE_HOME}/.config/opencode" "${ROOT}/opencode" "config symlink deployed"
  finish_case
}

case_setup_skip_opencode() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  SKIP_OPENCODE=1 SKIP_DIRECTOR=1 SKIP_PACKAGES=1 SKIP_OLLAMA=1 bash "${ROOT}/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "SKIP_OPENCODE=1 exits 0"
  check_contains "${CASE_HOME}/out.log" "SKIP_OPENCODE=1" "skip message"
  check_not_contains "${STUB_LOG}" "opencode.ai" "no installer download when skipped"
  finish_case
}

# --- setup-director.sh ------------------------------------------------------

case_director_skip_pinned() {
  new_case
  stub_director
  bash "${ROOT}/opencode/setup-director.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "healthy pinned install exits 0"
  check_contains "${CASE_HOME}/out.log" "already installed and healthy" "healthy message"
  check_not_contains "${STUB_LOG}" "raw.githubusercontent.com" "no installer download when healthy"
  finish_case
}

case_director_drift() {
  new_case
  stub_director
  STUB_DIRECTOR_VERSION_OUTPUT="director version v1.20.0" bash "${ROOT}/opencode/setup-director.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "drift path exits 0"
  check_contains "${CASE_HOME}/out.log" "NOTE installed version differs from pinned v1.23.0" "drift note names the pin"
  finish_case
}

case_director_fresh() {
  new_case
  stub_curl
  bash "${ROOT}/opencode/setup-director.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "fresh install exits 0"
  check_contains "${STUB_LOG}" "fake-director-installer args: --version v1.23.0" "installer receives the pinned version"
  check_contains "${STUB_LOG}" "director install --opencode" "wires opencode"
  check_contains "${CASE_HOME}/out.log" "Director is set up" "setup message"
  finish_case
}

case_director_skip() {
  new_case
  stub_director
  SKIP_DIRECTOR=1 bash "${ROOT}/opencode/setup-director.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "SKIP_DIRECTOR=1 exits 0"
  check_contains "${CASE_HOME}/out.log" "SKIP_DIRECTOR=1" "skip message"
  finish_case
}

# --- runner -----------------------------------------------------------------

run_case() {
  local name="$1" fn="$2"
  if [ -n "${FILTER}" ] && [[ "${name}" != *"${FILTER}"* ]]; then
    return 0
  fi
  CASE_FAILED=0
  if ( "${fn}" ); then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "PASS: ${name}"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED+=("${name}")
    echo "FAIL: ${name}" >&2
  fi
}

run_case "ollama-happy" case_ollama_happy
run_case "ollama-local-fail" case_ollama_local_fail
run_case "ollama-cloud-fail" case_ollama_cloud_fail
run_case "ollama-skip" case_ollama_skip
run_case "ollama-gateway-down" case_ollama_gateway_down
run_case "setup-skip-pinned" case_setup_skip_pinned
run_case "setup-drift" case_setup_drift
run_case "setup-force" case_setup_force
run_case "setup-fresh" case_setup_fresh
run_case "setup-skip-opencode" case_setup_skip_opencode
run_case "director-skip-pinned" case_director_skip_pinned
run_case "director-drift" case_director_drift
run_case "director-fresh" case_director_fresh
run_case "director-skip" case_director_skip

echo "shell tests: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
if [ "${FAIL_COUNT}" -gt 0 ]; then
  printf 'failed cases: %s\n' "${FAILED[@]}" >&2
  exit 1
fi
exit 0
