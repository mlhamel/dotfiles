#!/usr/bin/env bash
# openhands.sh -- One-command, fully automatic OpenHands Agent Canvas setup.
#
# Usage:
#   ./openhands.sh [up|down|status|restart|help]
#
# `up` (the default) brings up a fully configured Canvas:
#   1. ACL: grants the container user (uid 10001) read/write/execute on the
#      projects directory (recursively, plus a default ACL so new entries
#      inherit it) and on the persistent opencode directory.
#   2. Config: writes the container opencode config (Ollama provider ->
#      host.docker.internal:11434, GLM cloud models pinned) if missing.
#   3. Container: starts ghcr.io/openhands/agent-canvas:1.43.0 (detached),
#      with the projects dir, the state volume and a persistent opencode
#      dir (the binary survives restarts).
#   4. Config install: copies the config into the container (`mkdir -p`
#      + `docker cp` + `chown`; a bind-mount of the file into `.config`
#      makes that directory non-writable for uid 10001 and agent-canvas
#      refuses to start).
#   5. Binary: installs opencode inside the container if missing. The
#      install lands in the persistent dir, so it is a one-time cost.
#   6. Health: waits for the Canvas UI to answer, then prints a summary.
#
# After the FIRST `up`, do this once in the Canvas UI (it persists in the
# openhands-state volume, so it survives restarts):
#   Settings -> Agent -> Agent: ACP -> Preset: Custom
#   Command: /home/openhands/.opencode/bin/opencode acp
#   Model:   ollama/glm-5.3-flash:cloud
# Then start a new conversation. The ACP agent runs on GLM-5.3-Flash via
# the host Ollama gateway.
#
# Requirements: docker (daemon running), curl, setfacl/getfacl (acl package).
# Everything the script creates lives under ~/.local/share/openhands
# (binary + config) and in the docker volume openhands-state (Canvas state).
# To force a fresh opencode install, delete ~/.local/share/openhands/opencode
# and run `./openhands.sh up` again.

set -euo pipefail

CONTAINER_NAME="openhands-canvas"
IMAGE="ghcr.io/openhands/agent-canvas:1.43.0"
PORT="8000"
PROJECTS_PATH="$HOME/src/github.com/mlhamel"
OPENHANDS_DATA="$HOME/.local/share/openhands"
OPENCODE_DIR="$OPENHANDS_DATA/opencode"
CONFIG_FILE="$OPENHANDS_DATA/opencode-container.jsonc"
STATE_VOLUME="openhands-state"
CANVAS_URL="http://localhost:${PORT}/canvas"
CANVAS_USER="10001"

log() { printf '%s\n' "openhands: $*"; }
die() { printf '%s\n' "openhands: ERREUR: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "commande introuvable: $1"
}

docker_ok() {
  docker info >/dev/null 2>&1 || die "le daemon Docker ne répond pas (docker info a échoué). Démarre Docker puis relance."
}

# Grant uid 10001 rwx on a directory (+ default ACL so new entries inherit).
acl_dir() {
  local dir="$1"
  setfacl -m "u:${CANVAS_USER}:rwx" "$dir" \
    || sudo setfacl -m "u:${CANVAS_USER}:rwx" "$dir"
  setfacl -d -m "u:${CANVAS_USER}:rwx" "$dir" \
    || sudo setfacl -d -m "u:${CANVAS_USER}:rwx" "$dir"
}

ensure_acl() {
  if getfacl -p "$PROJECTS_PATH" 2>/dev/null | grep -q "user:${CANVAS_USER}:rwx"; then
    log "ACL déjà en place sur $PROJECTS_PATH"
  else
    log "ACL: donne rwx à l'utilisateur ${CANVAS_USER} sur $PROJECTS_PATH (récursif + défaut)…"
    acl_dir "$PROJECTS_PATH"
    setfacl -R -m "u:${CANVAS_USER}:rwx" "$PROJECTS_PATH" \
      || sudo setfacl -R -m "u:${CANVAS_USER}:rwx" "$PROJECTS_PATH"
    setfacl -R -d -m "u:${CANVAS_USER}:rwx" "$PROJECTS_PATH" \
      || sudo setfacl -R -d -m "u:${CANVAS_USER}:rwx" "$PROJECTS_PATH"
    log "ACL en place sur $PROJECTS_PATH"
  fi
  mkdir -p "$OPENCODE_DIR"
  acl_dir "$OPENCODE_DIR"
  log "ACL en place sur $OPENCODE_DIR"
}

# The embedded config uses the opencode v1 schema (`provider` / `npm` /
# `options`): the install script provides opencode 1.19.6. If the container
# binary is ever upgraded to a 2.x runtime, this must move to the v2 schema
# (`providers` / `package` / `settings`). Note: 1.19.6 requires BOTH
# `limit.context` AND `limit.output` on every model — a config with only
# `context` is rejected ("Configuration is invalid … Missing key
# …limit.output") and opencode exits before the ACP handshake.
write_config() {
  cat > "$CONFIG_FILE" <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": {
        "baseURL": "http://host.docker.internal:11434/v1"
      },
      "models": {
        "glm-5.3-flash:cloud": { "name": "GLM 5.3 Flash (cloud)", "limit": { "context": 65536, "output": 65536 } },
        "glm-5.3:cloud": { "limit": { "context": 65536, "output": 65536 } },
        "glm-5.2:cloud": { "limit": { "context": 65536, "output": 65536 } },
        "inkling-2-small:cloud": { "limit": { "context": 65536, "output": 65536 } },
        "gemma4:cloud": { "limit": { "context": 65536, "output": 65536 } },
        "kimi-k2.7-code:cloud": { "limit": { "context": 65536, "output": 65536 } },
        "qwen3:4b": { "limit": { "context": 65536, "output": 65536 } },
        "gemma4:26b": { "limit": { "context": 65536, "output": 65536 } },
        "llama3:latest": { "limit": { "context": 65536, "output": 65536 } }
      }
    }
  }
}
EOF
}

ensure_config() {
  mkdir -p "$OPENHANDS_DATA"
  if [ -f "$CONFIG_FILE" ]; then
    log "Config déjà présente: $CONFIG_FILE"
    return 0
  fi
  log "Config: écrit $CONFIG_FILE"
  write_config
}

container_exists() { docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; }
container_running() { docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; }

start_container() {
  if container_running; then
    log "Conteneur déjà en cours: $CONTAINER_NAME"
    return 0
  fi
  if container_exists; then
    log "Redémarre le conteneur arrêté: $CONTAINER_NAME"
    docker start "$CONTAINER_NAME"
    return 0
  fi
  log "Démarre le conteneur: $CONTAINER_NAME ($IMAGE)"
  docker run -d --name "$CONTAINER_NAME" \
    -p "127.0.0.1:${PORT}:8000" \
    -e AGENT_CANVAS_ALLOW_LAN_SESSION_KEY=true \
    --add-host host.docker.internal:host-gateway \
    -v "${STATE_VOLUME}:/home/openhands/.openhands" \
    -v "${PROJECTS_PATH}:/projects" \
    -v "${OPENCODE_DIR}:/home/openhands/.opencode" \
    "$IMAGE"
}

# Copy the opencode config into the container and give it to uid 10001.
# Deliberately NOT a bind-mount: mounting the file into `.config` makes
# that directory non-writable for the container user and agent-canvas
# refuses to start ("Browser config directory is not writable"). The copy
# is re-applied on every `up`, so a recreated container always gets the
# current config, and the image's `.config/opencode/` (node_modules and
# friends) stays intact. `mkdir -p` first: a fresh container has no
# `.config/opencode/` yet (opencode creates it on first run), and `docker
# cp` fails when the destination directory does not exist.
install_config() {
  log "Config: copie dans le conteneur…"
  docker exec "$CONTAINER_NAME" mkdir -p /home/openhands/.config/opencode
  docker cp "${CONFIG_FILE}" "${CONTAINER_NAME}:/home/openhands/.config/opencode/opencode.jsonc"
  docker exec --user root "${CONTAINER_NAME}" chown "${CANVAS_USER}:${CANVAS_USER}" /home/openhands/.config/opencode/opencode.jsonc
  log "Config installée dans le conteneur."
}

wait_ui() {
  log "Attente de l'interface (${CANVAS_URL})…"
  local i
  for ((i = 1; i <= 45; i++)); do
    if curl -fsS -o /dev/null "$CANVAS_URL" 2>/dev/null; then
      log "Interface joignable."
      return 0
    fi
    sleep 2
  done
  die "l'interface ne répond pas après 90 s. Voir: docker logs $CONTAINER_NAME"
}

ensure_opencode() {
  mkdir -p "$OPENCODE_DIR/bin"
  if docker exec "$CONTAINER_NAME" test -x /home/openhands/.opencode/bin/opencode 2>/dev/null; then
    local v
    v="$(docker exec "$CONTAINER_NAME" /home/openhands/.opencode/bin/opencode --version 2>/dev/null || true)"
    log "opencode déjà installé dans le conteneur: ${v:-version inconnue}"
    return 0
  fi
  log "opencode absent — installation dans le conteneur (persistée dans $OPENCODE_DIR)…"
  docker exec "$CONTAINER_NAME" sh -c 'curl -fsSL https://opencode.ai/install | bash'
  docker exec "$CONTAINER_NAME" /home/openhands/.opencode/bin/opencode --version
  log "opencode installé."
}

show_summary() {
  echo
  log "Canvas: $CANVAS_URL"
  log "Conteneur: $CONTAINER_NAME ($(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo '?'))"
  if docker exec "$CONTAINER_NAME" test -x /home/openhands/.opencode/bin/opencode 2>/dev/null; then
    log "opencode: $(docker exec "$CONTAINER_NAME" /home/openhands/.opencode/bin/opencode --version 2>/dev/null)"
  fi
  log "Config: $CONFIG_FILE -> /home/openhands/.config/opencode/opencode.jsonc (copiée à chaque up, Ollama -> host.docker.internal:11434, GLM épinglés)"
  echo
  log "Reste à faire UNE fois dans l'interface (persistant) :"
  log "  Settings -> Agent -> ACP / Custom"
  log "  Command: /home/openhands/.opencode/bin/opencode acp"
  log "  Model:   ollama/glm-5.3-flash:cloud"
}

cmd_up() {
  need_cmd docker
  need_cmd curl
  need_cmd setfacl
  need_cmd getfacl
  docker_ok
  [ -d "$PROJECTS_PATH" ] || die "dossier projets introuvable: $PROJECTS_PATH"
  ensure_acl
  ensure_config
  start_container
  install_config
  wait_ui
  ensure_opencode
  show_summary
}

cmd_down() {
  if container_exists; then
    log "Arrêt + suppression du conteneur $CONTAINER_NAME (le volume d'état et les fichiers persistants sont conservés)…"
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
    log "Conteneur supprimé. Relance avec: $0 up"
  else
    log "Aucun conteneur $CONTAINER_NAME."
  fi
}

cmd_status() {
  if container_running; then
    log "Conteneur: $CONTAINER_NAME en cours"
  elif container_exists; then
    log "Conteneur: $CONTAINER_NAME arrêté"
  else
    log "Conteneur: $CONTAINER_NAME absent"
    return 0
  fi
  if curl -fsS -o /dev/null "$CANVAS_URL" 2>/dev/null; then
    log "Interface: joignable ($CANVAS_URL)"
  else
    log "Interface: ne répond pas ($CANVAS_URL)"
  fi
  if docker exec "$CONTAINER_NAME" test -x /home/openhands/.opencode/bin/opencode 2>/dev/null; then
    log "opencode: $(docker exec "$CONTAINER_NAME" /home/openhands/.opencode/bin/opencode --version 2>/dev/null)"
  else
    log "opencode: absent dans le conteneur"
  fi
  if docker exec "$CONTAINER_NAME" test -f /home/openhands/.config/opencode/opencode.jsonc 2>/dev/null; then
    log "Config: présente dans le conteneur"
  else
    log "Config: absente dans le conteneur"
  fi
}

usage() {
  sed -n '2,34p' "$0"
}

main() {
  local cmd="${1:-up}"
  case "$cmd" in
    up) cmd_up ;;
    down) cmd_down ;;
    status) cmd_status ;;
    restart) cmd_down; cmd_up ;;
    help|--help|-h) usage ;;
    *) die "commande inconnue: $cmd (up|down|status|restart|help)" ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
