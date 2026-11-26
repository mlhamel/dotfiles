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
# The bin/oc-tokens cases are a variant on the recipe: instead of stub
# binaries they build a real SQLite database with python3 so the script's
# SQL reporting runs end to end. bin/oc-tokens is also mode 644 in git,
# hence the same `bash` invocation.
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

check_line_order() {
  local file="$1" first="$2" second="$3" desc="$4"
  local ln_first ln_second
  ln_first="$(grep -nF -- "${first}" "${file}" | head -n 1 | cut -d: -f1)"
  ln_second="$(grep -nF -- "${second}" "${file}" | head -n 1 | cut -d: -f1)"
  if [ -n "${ln_first}" ] && [ -n "${ln_second}" ] && [ "${ln_first}" -lt "${ln_second}" ]; then
    return 0
  fi
  echo "  FAIL: ${desc} ('${first}' at line ${ln_first:-none}, '${second}' at line ${ln_second:-none})" >&2
  CASE_FAILED=1
}

check_symlink_to() {
  local link="$1" target="$2" desc="$3"
  if [ -L "${link}" ] && [ "$(readlink "${link}")" = "${target}" ]; then
    return 0
  fi
  echo "  FAIL: ${desc} (want symlink ${link} -> ${target})" >&2
  CASE_FAILED=1
}

check_mode() {
  local want="$1" file="$2" desc="$3" got
  got="$(stat -c %a -- "${file}" 2>/dev/null || echo missing)"
  if [ "${want}" != "${got}" ]; then
    echo "  FAIL: ${desc} (want mode ${want}, got ${got})" >&2
    CASE_FAILED=1
  fi
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
echo "fake-director-installer os=$(uname -s) arch=$(uname -m)" >> "$STUB_LOG"
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

write_ollama_stub_template() {
  cat > "${CASE_BIN}/.ollama-stub-template" <<'OLLAMA_EOF'
#!/bin/sh
echo "ollama $*" >> "$STUB_LOG"
if [ "${1:-}" = "pull" ] && [ "${2:-}" = "${STUB_OLLAMA_FAIL:-}" ]; then
  echo "stub: failing pull of $2" >&2
  exit 1
fi
exit 0
OLLAMA_EOF
}

stub_ollama() {
  write_ollama_stub_template
  cp "${CASE_BIN}/.ollama-stub-template" "${CASE_BIN}/ollama"
  chmod +x "${CASE_BIN}/ollama"
}

stub_uname() {
  cat > "${CASE_BIN}/uname" <<'UNAME_EOF'
#!/bin/sh
# Reports the stubbed OS/arch when set, delegates to the real uname
# otherwise. Lets the harness simulate Darwin on a Linux box.
case "${1:-}" in
  -s)
    if [ -n "${STUB_UNAME_S:-}" ]; then echo "${STUB_UNAME_S}"; exit 0; fi
    ;;
  -m)
    if [ -n "${STUB_UNAME_M:-}" ]; then echo "${STUB_UNAME_M}"; exit 0; fi
    ;;
esac
exec /usr/bin/uname "$@"
UNAME_EOF
  chmod +x "${CASE_BIN}/uname"
}

stub_brew() {
  write_ollama_stub_template
  cat > "${CASE_BIN}/brew" <<'BREW_EOF'
#!/bin/sh
echo "brew $*" >> "$STUB_LOG"
case "$*" in
  "install ollama")
    # The install makes the binary appear, like the real formula does.
    cp "$(dirname "$0")/.ollama-stub-template" "$(dirname "$0")/ollama"
    chmod +x "$(dirname "$0")/ollama"
    exit 0
    ;;
  "services start ollama")
    exit "${STUB_BREW_SERVICES_RC:-0}"
    ;;
  bundle*)
    exit "${STUB_BREW_BUNDLE_RC:-0}"
    ;;
  list*)
    # Nothing installed via brew in the sandbox: empty output.
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
BREW_EOF
  chmod +x "${CASE_BIN}/brew"
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

stub_docker() {
  cat > "${CASE_BIN}/docker" <<'DOCKER_EOF'
#!/bin/sh
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  "info")
    exit 0
    ;;
  "ps --format {{.Names}}")
    if [ -n "${STUB_DOCKER_PS:-}" ]; then printf '%s\n' "${STUB_DOCKER_PS}"; fi
    exit 0
    ;;
  "ps -a --format {{.Names}}")
    if [ -n "${STUB_DOCKER_PS_A:-}" ]; then printf '%s\n' "${STUB_DOCKER_PS_A}"; fi
    exit 0
    ;;
  *test\ -x\ /home/openhands/.opencode/bin/opencode*)
    exit "${STUB_DOCKER_TEST_X_RC:-0}"
    ;;
  *--version*)
    echo "${STUB_DOCKER_VERSION:-1.19.6}"
    exit 0
    ;;
  *inspect*)
    echo "running"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
DOCKER_EOF
  chmod +x "${CASE_BIN}/docker"
}

stub_setfacl() {
  cat > "${CASE_BIN}/setfacl" <<'SETFACL_EOF'
#!/bin/sh
echo "setfacl $*" >> "$STUB_LOG"
exit 0
SETFACL_EOF
  chmod +x "${CASE_BIN}/setfacl"
}

stub_getfacl() {
  cat > "${CASE_BIN}/getfacl" <<'GETFACL_EOF'
#!/bin/sh
echo "getfacl $*" >> "$STUB_LOG"
# Pretend the container user already has rwx, so ensure_acl skips the
# recursive walk (STUB_GETFACL_ACL=0 to report no entry instead).
if [ "${STUB_GETFACL_ACL:-1}" = "1" ]; then
  echo "user:10001:rwx"
fi
exit 0
GETFACL_EOF
  chmod +x "${CASE_BIN}/getfacl"
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

# --- setup-ollama.sh on Darwin ----------------------------------------------
# The VM is Linux, so Darwin is simulated with a stub uname. The brew stub
# makes `ollama` appear on PATH only after `brew install ollama`, like the
# real formula does.

case_ollama_darwin_install() {
  new_case
  stub_curl
  stub_uname
  stub_brew
  write_ollama_config
  STUB_UNAME_S=Darwin bash "${ROOT}/opencode/setup-ollama.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "darwin install exits 0"
  check_contains "${STUB_LOG}" "brew install ollama" "ollama installed via Homebrew"
  check_contains "${STUB_LOG}" "brew services start ollama" "gateway started as a brew service"
  check_contains "${STUB_LOG}" "ollama pull qwen3:4b" "local model pulled after install"
  check_contains "${STUB_LOG}" "ollama pull glm-5.3-flash:cloud" "cloud model registered after install"
  check_contains "${CASE_HOME}/out.log" "Ollama gateway ready" "ready message"
  finish_case
}

case_ollama_darwin_no_brew() {
  new_case
  stub_curl
  stub_uname
  write_ollama_config
  STUB_UNAME_S=Darwin bash "${ROOT}/opencode/setup-ollama.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "darwin without brew exits 0 (manual hint)"
  check_contains "${CASE_HOME}/out.log" "install manually with: brew install ollama" "manual hint"
  check_not_contains "${STUB_LOG}" "ollama pull" "no pull attempted without ollama"
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
  check_symlink_to "${CASE_HOME}/.local/bin/oh-fix" "${ROOT}/opencode/bin/oh-fix" "oh-fix installed to ~/.local/bin"
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
  check_symlink_to "${CASE_HOME}/.local/bin/oh-fix" "${ROOT}/opencode/bin/oh-fix" "oh-fix installed to ~/.local/bin"
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

# --- setup.sh SKIP_* guards -------------------------------------------------
# setup.sh must honor SKIP_DIRECTOR/SKIP_OLLAMA itself instead of relying
# on the sub-scripts: it invokes them directly, so a guard that only lives
# in the sub-script never runs when setup.sh skips the call. These cases
# run setup.sh from a scratch repo tree whose sub-scripts are markers that
# log their invocation and fail — proving setup.sh never calls them.

setup_skip_repo() {
  local repo="${CASE_HOME}/repo"
  mkdir -p "${repo}/opencode"
  cp "${ROOT}/setup.sh" "${repo}/setup.sh"
  cp "${ROOT}/opencode/install.sh" "${repo}/opencode/install.sh"
  cp "${ROOT}/opencode/opencode.json" "${repo}/opencode/opencode.json"
  cat > "${repo}/opencode/setup-director.sh" <<'MARKER_EOF'
#!/bin/sh
echo "marker-director invoked" >> "$STUB_LOG"
exit 1
MARKER_EOF
  cat > "${repo}/opencode/setup-ollama.sh" <<'MARKER_EOF'
#!/bin/sh
echo "marker-ollama invoked" >> "$STUB_LOG"
exit 1
MARKER_EOF
  chmod +x "${repo}/opencode/setup-director.sh" "${repo}/opencode/setup-ollama.sh"
}

case_setup_skip_both() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  setup_skip_repo
  SKIP_DIRECTOR=1 SKIP_PACKAGES=1 SKIP_OLLAMA=1 bash "${CASE_HOME}/repo/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "both SKIP exit 0"
  check_contains "${CASE_HOME}/out.log" "[director] SKIP_DIRECTOR=1" "director skip message from setup.sh itself"
  check_contains "${CASE_HOME}/out.log" "[ollama] SKIP_OLLAMA=1" "ollama skip message from setup.sh itself"
  check_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap completes"
  check_not_contains "${STUB_LOG}" "marker-director invoked" "director sub-script not invoked"
  check_not_contains "${STUB_LOG}" "marker-ollama invoked" "ollama sub-script not invoked"
  finish_case
}

case_setup_no_skip_calls_director() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  setup_skip_repo
  SKIP_PACKAGES=1 bash "${CASE_HOME}/repo/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc_nonzero "${rc}" "director marker failure aborts setup.sh"
  check_contains "${STUB_LOG}" "marker-director invoked" "director sub-script invoked without SKIP_DIRECTOR"
  check_not_contains "${STUB_LOG}" "marker-ollama invoked" "ollama sub-script not reached after director failure"
  finish_case
}

case_setup_skip_director_only() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  setup_skip_repo
  SKIP_DIRECTOR=1 SKIP_PACKAGES=1 bash "${CASE_HOME}/repo/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc_nonzero "${rc}" "ollama marker failure aborts setup.sh"
  check_contains "${CASE_HOME}/out.log" "[director] SKIP_DIRECTOR=1" "director skip message"
  check_not_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap does not complete"
  check_not_contains "${STUB_LOG}" "marker-director invoked" "director sub-script not invoked"
  check_contains "${STUB_LOG}" "marker-ollama invoked" "ollama sub-script invoked without SKIP_OLLAMA"
  finish_case
}

# --- setup.sh packages step on Darwin ---------------------------------------
# Darwin is simulated with a stub uname; the brew stub records every call.

case_setup_packages_darwin() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  stub_uname
  stub_brew
  STUB_UNAME_S=Darwin SKIP_DIRECTOR=1 SKIP_OLLAMA=1 bash "${ROOT}/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "darwin packages path exits 0"
  check_contains "${STUB_LOG}" "brew bundle --file=${ROOT}/homebrew/Brewfile" "brew bundle called with the repo Brewfile"
  check_contains "${CASE_HOME}/out.log" "[inotify] SKIP Darwin — Linux-only" "inotify skipped on Darwin"
  check_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap completes"
  finish_case
}

case_setup_packages_darwin_no_brew() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  stub_uname
  STUB_UNAME_S=Darwin SKIP_DIRECTOR=1 SKIP_OLLAMA=1 bash "${ROOT}/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "darwin without brew exits 0"
  check_contains "${CASE_HOME}/out.log" "WARN Homebrew not found" "warns Homebrew is missing"
  check_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap continues without brew"
  check_not_contains "${STUB_LOG}" "brew bundle" "no bundle attempted without brew"
  finish_case
}

case_setup_packages_darwin_bundle_fail() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  stub_uname
  stub_brew
  STUB_UNAME_S=Darwin STUB_BREW_BUNDLE_RC=1 SKIP_DIRECTOR=1 SKIP_OLLAMA=1 bash "${ROOT}/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "failed bundle does not abort the bootstrap"
  check_contains "${CASE_HOME}/out.log" "WARN brew bundle failed" "warns the bundle failed"
  check_contains "${CASE_HOME}/out.log" "bootstrap complete" "bootstrap completes despite the failure"
  finish_case
}

case_setup_packages_darwin_skip() {
  new_case
  stub_curl
  stub_dpkg
  stub_sudo
  stub_opencode
  stub_uname
  stub_brew
  STUB_UNAME_S=Darwin SKIP_PACKAGES=1 SKIP_DIRECTOR=1 SKIP_OLLAMA=1 bash "${ROOT}/setup.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "SKIP_PACKAGES=1 exits 0 on Darwin"
  check_contains "${CASE_HOME}/out.log" "SKIP_PACKAGES=1" "skip message"
  check_not_contains "${STUB_LOG}" "brew bundle" "no bundle attempted when skipped"
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

# --- setup-director.sh on Darwin --------------------------------------------
# setup-director.sh itself is OS-agnostic; the OS-specific part is the
# fork installer, which maps uname to the upstream asset name. The fake
# installer logs the os/arch it sees, so this case proves the Darwin
# values reach it. Upstream v1.23.0 ships darwin_arm64 and darwin_amd64
# tarballs (verified against the release download URLs).

case_director_darwin() {
  new_case
  stub_curl
  stub_uname
  STUB_UNAME_S=Darwin STUB_UNAME_M=arm64 bash "${ROOT}/opencode/setup-director.sh" > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "darwin fresh install exits 0"
  check_contains "${STUB_LOG}" "fake-director-installer os=Darwin arch=arm64" "installer sees Darwin/arm64"
  check_contains "${STUB_LOG}" "fake-director-installer args: --version v1.23.0" "installer receives the pinned version"
  check_contains "${CASE_HOME}/out.log" "Director is set up" "setup message"
  finish_case
}

# --- bin/oc-tokens -----------------------------------------------------------
# oc-tokens reports on the opencode SQLite DB (v2 session_v2 schema, legacy
# v1 session/message schema). Cases call it via `bash` (the file is also
# mode 644 in git, like the bootstrap scripts) and build real fixtures with
# python3's sqlite3 module so the reporting SQL runs end to end. Fixtures
# embed NOW_MS tokens that build_db replaces with the current epoch millis,
# so the --days cases never rot. Per-row token counts stay under 1,000 so
# fmt() emits no commas except where a Total line asserts them.

build_db() {
  mkdir -p "$(dirname "$1")"
  python3 -c '
import sqlite3, sys, time
con = sqlite3.connect(sys.argv[1])
con.executescript(sys.stdin.read().replace("NOW_MS", str(int(time.time() * 1000))))
con.commit()
con.close()
' "$@"
}

case_oc_tokens_happy() {
  new_case
  local db="${CASE_HOME}/.local/share/opencode/opencode.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
INSERT INTO session_v2 VALUES('a1','Alpha Co','build','claude-x',900,40,50,NOW_MS-86400000,NOW_MS);
INSERT INTO session_v2 VALUES('b2','Beta Co','build','claude-x',400,30,60,NOW_MS-7200000,NOW_MS);
INSERT INTO session_v2 VALUES('c3','Gamma Co','build','claude-x',90,10,40,NOW_MS-3600000,NOW_MS);
INSERT INTO session_message VALUES('a1','user');
INSERT INTO session_message VALUES('a1','assistant');
INSERT INTO session_message VALUES('b2','user');
INSERT INTO session_message VALUES('c3','user');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "happy path exits 0"
  check_contains "${CASE_HOME}/out.log" "opencode session efficiency report" "report header"
  check_contains "${CASE_HOME}/out.log" "Total: 3 sessions | input 1,390 | output 80 | cache-read 150" "token totals with comma grouping"
  check_line_order "${CASE_HOME}/out.log" "Alpha Co" "Beta Co" "burners ordered by tokens_input desc (1/2)"
  check_line_order "${CASE_HOME}/out.log" "Beta Co" "Gamma Co" "burners ordered by tokens_input desc (2/3)"
  check_contains "${CASE_HOME}/out.log" "every large session recorded cache-read" "zero-cache section empty"
  check_contains "${CASE_HOME}/out.log" "no session crossed the message threshold" "spirals section empty"
  check_not_contains "${CASE_HOME}/err.log" "oc-tokens:" "stderr clean on a well-formed DB"
  finish_case
}

case_oc_tokens_msg_filter() {
  new_case
  local db="${CASE_HOME}/spiral.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
INSERT INTO session_v2 VALUES('s1','Spiral Co','build','claude-x',500,50,50,NOW_MS-3600000,NOW_MS);
INSERT INTO session_message VALUES('s1','user');
INSERT INTO session_message VALUES('s1','assistant');
INSERT INTO session_message VALUES('s1','user');
INSERT INTO session_message VALUES('s1','assistant');
INSERT INTO session_message VALUES('s1','user');
INSERT INTO session_message VALUES('s1','idle');
INSERT INTO session_message VALUES('s1','synthetic');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" --spiral 5 > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "threshold 5 run exits 0"
  check_contains "${CASE_HOME}/out.log" "5 msgs" "session at the threshold is listed (only user/assistant count)"
  check_not_contains "${CASE_HOME}/out.log" "no session crossed the message threshold" "spirals section not empty at threshold 5"
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" --spiral 6 > "${CASE_HOME}/out2.log" 2> "${CASE_HOME}/err.log"
  rc=$?
  check_rc 0 "${rc}" "threshold 6 run exits 0"
  check_not_contains "${CASE_HOME}/out2.log" "5 msgs" "session below the threshold is not listed"
  check_contains "${CASE_HOME}/out2.log" "no session crossed the message threshold" "spirals section empty at threshold 6"
  finish_case
}

case_oc_tokens_days() {
  new_case
  local db="${CASE_HOME}/days.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
INSERT INTO session_v2 VALUES('f1','Fresh Co','build','claude-x',300,30,30,NOW_MS-86400000,NOW_MS);
INSERT INTO session_v2 VALUES('s2','Stale Co','build','claude-x',200,20,20,NOW_MS-2592000000,NOW_MS);
INSERT INTO session_message VALUES('f1','user');
INSERT INTO session_message VALUES('s2','user');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "no-filter run exits 0"
  check_contains "${CASE_HOME}/out.log" "Total: 2 sessions" "no filter counts both sessions"
  check_contains "${CASE_HOME}/out.log" "Fresh Co" "one-day-old session listed"
  check_contains "${CASE_HOME}/out.log" "Stale Co" "30-day-old session listed"
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" --days 7 > "${CASE_HOME}/out2.log" 2> "${CASE_HOME}/err.log"
  rc=$?
  check_rc 0 "${rc}" "--days run exits 0"
  check_contains "${CASE_HOME}/out2.log" "Total: 1 sessions" "--days 7 keeps the one-day-old session"
  check_not_contains "${CASE_HOME}/out2.log" "Stale Co" "--days 7 drops the 30-day-old session everywhere"
  finish_case
}

case_oc_tokens_reconcile_max() {
  new_case
  local db="${CASE_HOME}/reconcile.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
CREATE TABLE session(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE message(session_id TEXT, type TEXT);
INSERT INTO session_v2 VALUES('dual','v2-row','v2-agent','claude-x',222,50,60,NOW_MS-3600000,NOW_MS);
INSERT INTO session_message VALUES('dual','user');
INSERT INTO session VALUES('dual','v1-row','v1-agent','claude-x',999,300,500,NOW_MS-3600000,NOW_MS);
INSERT INTO message VALUES('dual','user');
INSERT INTO message VALUES('dual','assistant');
INSERT INTO message VALUES('dual','x1');
INSERT INTO message VALUES('dual','x2');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "reconciled v1+v2 DB exits 0"
  check_contains "${CASE_HOME}/out.log" "Total: 1 sessions | input 999 | output 300 | cache-read 500" "MAX(v1,v2) wins the token columns"
  check_contains "${CASE_HOME}/out.log" "v2-row" "v2 title wins the reconcile"
  check_contains "${CASE_HOME}/out.log" "v2-agent" "v2 agent wins the reconcile"
  check_not_contains "${CASE_HOME}/out.log" "v1-row" "v1 title loses the reconcile"
  check_not_contains "${CASE_HOME}/out.log" "v1-agent" "v1 agent loses the reconcile"
  check_not_contains "${CASE_HOME}/out.log" "222" "v1 max beats the v2 token counts"
  finish_case
}

case_oc_tokens_v1_only_rows() {
  new_case
  local db="${CASE_HOME}/v1only.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
CREATE TABLE session(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE message(session_id TEXT, type TEXT);
INSERT INTO session_v2 VALUES('v2only','V2 Only','build','claude-x',300,30,30,NOW_MS-3600000,NOW_MS);
INSERT INTO session VALUES('v1only','V1 Only','build','claude-x',700,70,70,NOW_MS-7200000,NOW_MS);
INSERT INTO message VALUES('v1only','user');
INSERT INTO message VALUES('v1only','assistant');
INSERT INTO message VALUES('v1only','tool');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "v1-only rows are reconciled in"
  check_contains "${CASE_HOME}/out.log" "Total: 2 sessions" "both the v2-only and v1-only sessions count"
  check_contains "${CASE_HOME}/out.log" "V1 Only" "v1-only session title listed"
  check_contains "${CASE_HOME}/out.log" "V2 Only" "v2-only session title listed"
  check_not_contains "${CASE_HOME}/err.log" "v1 tables incomplete" "complete v1 tables produce no warning"
  finish_case
}

case_oc_tokens_v1_half() {
  new_case
  local db="${CASE_HOME}/v1half.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
CREATE TABLE session(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
INSERT INTO session_v2 VALUES('h1','Half Co','build','claude-x',150,15,15,NOW_MS-3600000,NOW_MS);
INSERT INTO session_message VALUES('h1','user');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "half-migrated v1 side is tolerated, not fatal"
  check_contains "${CASE_HOME}/err.log" "v1 tables incomplete; ignoring the v1 side" "warns about the incomplete v1 side"
  check_contains "${CASE_HOME}/out.log" "Total: 1 sessions" "the v2 side still reports"
  finish_case
}

case_oc_tokens_prev2() {
  new_case
  local db="${CASE_HOME}/prev2.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE message(session_id TEXT, type TEXT);
INSERT INTO session VALUES('p1','Pre V2 Co','build','claude-x',100,10,10,NOW_MS-3600000,NOW_MS);
INSERT INTO message VALUES('p1','user');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc_nonzero "${rc}" "a DB without session_v2 is a hard error"
  check_contains "${CASE_HOME}/err.log" "DB predates the v2 schema" "predates message"
  check_not_contains "${CASE_HOME}/out.log" "Total:" "no report is produced"
  finish_case
}

case_oc_tokens_missing_db() {
  new_case
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${CASE_HOME}/absent.db" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "a missing DB is not an error (fresh machine)"
  check_contains "${CASE_HOME}/err.log" "no opencode DB at" "missing-DB note on stderr"
  check_contains "${CASE_HOME}/err.log" "absent.db" "note names the offending path"
  check_not_contains "${CASE_HOME}/out.log" "Total:" "no report is produced"
  finish_case
}

case_oc_tokens_malformed() {
  new_case
  local db="${CASE_HOME}/garbage.db"
  printf 'this is definitely not a sqlite database\n' > "${db}"
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc_nonzero "${rc}" "a malformed DB is a hard error"
  check_contains "${CASE_HOME}/err.log" "falling back to the pre-checkpoint view" "WAL-mode warning"
  check_contains "${CASE_HOME}/err.log" "file is not a database" "the sqlite error surfaces in the traceback"
  finish_case
}

case_oc_tokens_bad_args() {
  new_case
  bash "${ROOT}/opencode/bin/oc-tokens" --bogus > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc_nonzero "${rc}" "unknown flag is rejected"
  check_contains "${CASE_HOME}/err.log" "unknown flag: --bogus" "unknown flag message"
  bash "${ROOT}/opencode/bin/oc-tokens" --days abc > "${CASE_HOME}/out2.log" 2> "${CASE_HOME}/err.log"
  rc=$?
  check_rc_nonzero "${rc}" "non-numeric --days is rejected"
  check_contains "${CASE_HOME}/err.log" "positive integers" "non-numeric value message"
  bash "${ROOT}/opencode/bin/oc-tokens" --days > "${CASE_HOME}/out3.log" 2> "${CASE_HOME}/err.log"
  rc=$?
  check_rc_nonzero "${rc}" "--days without a value is rejected"
  check_contains "${CASE_HOME}/err.log" "needs a value" "missing value message"
  check_not_contains "${CASE_HOME}/out.log" "Total:" "bad args never open the DB"
  finish_case
}

case_oc_tokens_env_db() {
  new_case
  local db="${CASE_HOME}/env.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
INSERT INTO session_v2 VALUES('e1','Env db One','build','claude-x',120,12,12,NOW_MS-3600000,NOW_MS);
INSERT INTO session_message VALUES('e1','user');
SQL_EOF
  OPENCODE_DB="${db}" bash "${ROOT}/opencode/bin/oc-tokens" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "OPENCODE_DB env var is honored"
  check_contains "${CASE_HOME}/out.log" "Env db One" "the env-var DB is reported"
  check_contains "${CASE_HOME}/out.log" "Total: 1 sessions" "no missing-DB fallback happened"
  check_not_contains "${CASE_HOME}/err.log" "no opencode DB" "the env-var DB exists"
  finish_case
}

case_oc_tokens_days_zero_pin() {
  new_case
  local db="${CASE_HOME}/days0.db"
  build_db "${db}" <<'SQL_EOF'
CREATE TABLE session_v2(id TEXT, title TEXT, agent TEXT, model TEXT, tokens_input INT, tokens_output INT, tokens_cache_read INT, time_created INT, time_updated INT);
CREATE TABLE session_message(session_id TEXT, type TEXT);
INSERT INTO session_v2 VALUES('f1','Future Co','build','claude-x',333,33,33,NOW_MS+60000,NOW_MS+70000);
INSERT INTO session_v2 VALUES('o1','Old Co','build','claude-x',222,22,22,NOW_MS-86400000,NOW_MS);
INSERT INTO session_message VALUES('f1','user');
INSERT INTO session_message VALUES('o1','user');
SQL_EOF
  bash "${ROOT}/opencode/bin/oc-tokens" --db "${db}" --days 0 > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "--days 0 is accepted"
  check_contains "${CASE_HOME}/out.log" "Total: 1 sessions" "the days-0 cutoff excludes exactly one session"
  check_contains "${CASE_HOME}/out.log" "Future Co" "future-dated session survives the days-0 cutoff"
  # Pin: --days 0 must enforce a real cutoff (not be treated as "no filter"),
  # else the total would be 2 sessions and Old Co would appear.
  check_not_contains "${CASE_HOME}/out.log" "Old Co" "'0' is filtered, not treated as no-filter"
  finish_case
}

# --- bin/oh-fix ------------------------------------------------------------
# oh-fix retakes ownership of files the OpenHands agent (uid 10001) created
# or rewrote in a mounted workspace. Cases call it via `bash` (the file is
# mode 644 in git, like oc-tokens) with OH_CANVAS_UID set to the current
# uid, so the fixture files count as the agent's without needing root or a
# second uid; sudo is stubbed to pass through to the real command.

stub_sudo_passthrough() {
  cat > "${CASE_BIN}/sudo" <<'SUDO_EOF'
#!/bin/sh
echo "sudo $*" >> "$STUB_LOG"
exec "$@"
SUDO_EOF
  chmod +x "${CASE_BIN}/sudo"
}

oh_fix_fixture() {
  local root="$1"
  mkdir -p "${root}/sub"
  printf '# README\n' > "${root}/README.md"; chmod 755 "${root}/README.md"
  printf '#!/usr/bin/env bash\necho hi\n' > "${root}/run.sh"; chmod 644 "${root}/run.sh"
  printf 'node_modules\n' > "${root}/.gitignore"; chmod 654 "${root}/.gitignore"
  cp /bin/true "${root}/data.bin"; chmod 755 "${root}/data.bin"
  printf 'inner\n' > "${root}/sub/inner.md"; chmod 700 "${root}/sub"
  chmod 644 "${root}/sub/inner.md"
}

case_oh_fix_happy() {
  new_case
  stub_sudo_passthrough
  local root="${CASE_HOME}/org/repo"
  oh_fix_fixture "${root}"
  OH_FIX_ROOT="${CASE_HOME}/org" OH_CANVAS_UID="$(id -u)" bash "${ROOT}/opencode/bin/oh-fix" "${root}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "happy path exits 0"
  check_mode 644 "${root}/README.md" "stray +x removed from text file"
  check_mode 755 "${root}/run.sh" "shebang script gains +x"
  check_mode 644 "${root}/.gitignore" "group-only +x removed"
  check_mode 755 "${root}/data.bin" "binary keeps its mode"
  check_mode 644 "${root}/sub/inner.md" "file inside a 700 dir is fixed"
  check_contains "${CASE_HOME}/out.log" "rendue(s)" "summary reports the retaken entries"
  finish_case
}

case_oh_fix_dry_run() {
  new_case
  stub_sudo_passthrough
  local root="${CASE_HOME}/org/repo"
  oh_fix_fixture "${root}"
  OH_FIX_ROOT="${CASE_HOME}/org" OH_CANVAS_UID="$(id -u)" bash "${ROOT}/opencode/bin/oh-fix" -n "${root}" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc 0 "${rc}" "dry-run exits 0"
  check_mode 755 "${root}/README.md" "dry-run leaves the stray +x alone"
  check_mode 644 "${root}/run.sh" "dry-run leaves the script without +x"
  check_mode 654 "${root}/.gitignore" "dry-run leaves the group-only +x alone"
  check_contains "${CASE_HOME}/out.log" "dry-run" "dry-run says so"
  check_contains "${CASE_HOME}/out.log" "serait +x" "dry-run previews the mode fixes"
  finish_case
}

case_oh_fix_refuse() {
  new_case
  stub_sudo_passthrough
  mkdir -p "${CASE_HOME}/org" "${CASE_HOME}/outside"
  OH_FIX_ROOT="${CASE_HOME}/org" OH_CANVAS_UID="$(id -u)" bash "${ROOT}/opencode/bin/oh-fix" "${CASE_HOME}/outside" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log"
  local rc=$?
  check_rc_nonzero "${rc}" "target outside the allowed root fails"
  check_contains "${CASE_HOME}/err.log" "hors de" "refusal names the allowed root"
  finish_case
}

case_oh_fix_no_args() {
  new_case
  stub_sudo_passthrough
  local root="${CASE_HOME}/org/repo"
  oh_fix_fixture "${root}"
  git init -q "${root}" 2>/dev/null
  ( cd "${root}" && OH_FIX_ROOT="${CASE_HOME}/org" OH_CANVAS_UID="$(id -u)" bash "${ROOT}/opencode/bin/oh-fix" > "${CASE_HOME}/out.log" 2> "${CASE_HOME}/err.log" )
  local rc=$?
  check_rc 0 "${rc}" "no-args run exits 0"
  check_mode 644 "${root}/README.md" "no-args run fixes the current repo"
  check_contains "${CASE_HOME}/out.log" "${root}" "no-args run reports the repo root"
  finish_case
}

# --- openhands/openhands.sh -------------------------------------------------
# One-command Canvas setup. Cases run it via `bash` with a stub `docker`
# (plus stub setfacl/getfacl/curl), so no container ever starts: the stub
# logs every docker invocation and pretends the UI answers.

case_openhands_help() {
  new_case
  bash "${ROOT}/openhands/openhands.sh" help > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "help exits 0"
  check_contains "${CASE_HOME}/out.log" "openhands.sh" "help names the script"
  check_contains "${CASE_HOME}/out.log" "Canvas" "help mentions Canvas"
  check_contains "${CASE_HOME}/out.log" "ollama/glm-5.3-flash:cloud" "help shows the ACP model"
  finish_case
}

case_openhands_up() {
  new_case
  stub_curl
  stub_docker
  stub_setfacl
  stub_getfacl
  mkdir -p "${CASE_HOME}/src/github.com/mlhamel"
  bash "${ROOT}/openhands/openhands.sh" up > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "up exits 0"
  check_contains "${CASE_HOME}/out.log" "http://localhost:8000/canvas" "summary prints the Canvas URL"
  check_contains "${CASE_HOME}/out.log" "1.19.6" "summary reports the opencode version"
  local cfg="${CASE_HOME}/.local/share/openhands/opencode-container.jsonc"
  check_contains "${cfg}" "host.docker.internal:11434" "config points Ollama at the host gateway"
  check_contains "${cfg}" "glm-5.3-flash:cloud" "config pins the GLM model"
  check_contains "${cfg}" "http://host.docker.internal:11434/v1" "config uses the OpenAI-compatible base URL"
  check_contains "${cfg}" "\"context\": 65536" "config pins a 64k context limit"
  check_contains "${cfg}" "\"output\": 65536" "config pins a 64k output limit (required by opencode 1.19.6)"
  if ! python3 -m json.tool "${cfg}" > "${CASE_HOME}/cfg.json" 2> "${CASE_HOME}/cfg.err"; then
    echo "  FAIL: config is not valid JSON" >&2
    CASE_FAILED=1
  fi
  check_contains "${STUB_LOG}" "ghcr.io/openhands/agent-canvas:1.43.0" "docker run uses the pinned image"
  check_contains "${STUB_LOG}" "mkdir -p /home/openhands/.config/opencode" "config dir is created in the container"
  check_contains "${STUB_LOG}" "/home/openhands/.config/opencode/opencode.jsonc" "config is copied to the container path"
  check_contains "${STUB_LOG}" "chown 10001:10001" "config is chowned to the container user"
  check_not_contains "${STUB_LOG}" "opencode.jsonc:ro" "no read-only file mount for the config"
  finish_case
}

case_openhands_status() {
  new_case
  stub_curl
  stub_docker
  stub_setfacl
  stub_getfacl
  STUB_DOCKER_PS="openhands-canvas" STUB_DOCKER_PS_A="openhands-canvas" bash "${ROOT}/openhands/openhands.sh" status > "${CASE_HOME}/out.log" 2>&1
  local rc=$?
  check_rc 0 "${rc}" "status exits 0"
  check_contains "${CASE_HOME}/out.log" "en cours" "status reports the container running"
  check_contains "${CASE_HOME}/out.log" "joignable" "status reports the UI reachable"
  check_contains "${CASE_HOME}/out.log" "1.19.6" "status reports the opencode version"
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
run_case "ollama-darwin-install" case_ollama_darwin_install
run_case "ollama-darwin-no-brew" case_ollama_darwin_no_brew
run_case "setup-skip-pinned" case_setup_skip_pinned
run_case "setup-drift" case_setup_drift
run_case "setup-force" case_setup_force
run_case "setup-fresh" case_setup_fresh
run_case "setup-skip-opencode" case_setup_skip_opencode
run_case "setup-skip-both" case_setup_skip_both
run_case "setup-no-skip-calls-director" case_setup_no_skip_calls_director
run_case "setup-skip-director-only" case_setup_skip_director_only
run_case "setup-packages-darwin" case_setup_packages_darwin
run_case "setup-packages-darwin-no-brew" case_setup_packages_darwin_no_brew
run_case "setup-packages-darwin-bundle-fail" case_setup_packages_darwin_bundle_fail
run_case "setup-packages-darwin-skip" case_setup_packages_darwin_skip
run_case "director-skip-pinned" case_director_skip_pinned
run_case "director-drift" case_director_drift
run_case "director-fresh" case_director_fresh
run_case "director-skip" case_director_skip
run_case "director-darwin" case_director_darwin

run_case "oc-tokens-happy" case_oc_tokens_happy
run_case "oc-tokens-msg-filter" case_oc_tokens_msg_filter
run_case "oc-tokens-days" case_oc_tokens_days
run_case "oc-tokens-reconcile-max" case_oc_tokens_reconcile_max
run_case "oc-tokens-v1-only-rows" case_oc_tokens_v1_only_rows
run_case "oc-tokens-v1-half" case_oc_tokens_v1_half
run_case "oc-tokens-prev2" case_oc_tokens_prev2
run_case "oc-tokens-missing-db" case_oc_tokens_missing_db
run_case "oc-tokens-malformed" case_oc_tokens_malformed
run_case "oc-tokens-bad-args" case_oc_tokens_bad_args
run_case "oc-tokens-env-db" case_oc_tokens_env_db
run_case "oc-tokens-days-zero-pin" case_oc_tokens_days_zero_pin

run_case "oh-fix-happy" case_oh_fix_happy
run_case "oh-fix-dry-run" case_oh_fix_dry_run
run_case "oh-fix-refuse" case_oh_fix_refuse
run_case "oh-fix-no-args" case_oh_fix_no_args

run_case "openhands-help" case_openhands_help
run_case "openhands-up" case_openhands_up
run_case "openhands-status" case_openhands_status

echo "shell tests: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
if [ "${FAIL_COUNT}" -gt 0 ]; then
  printf 'failed cases: %s\n' "${FAILED[@]}" >&2
  exit 1
fi
exit 0
