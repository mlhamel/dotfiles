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
#   4. Config install: copies the config, the global AGENTS.md rules and
#      the skills into the container (`mkdir -p` + `docker cp` + `chown`;
#      a bind-mount of the file into `.config` makes that directory
#      non-writable for uid 10001 and agent-canvas refuses to start).
#   5. Profiles: seeds four opencode agent profiles into the container
#      (build, ask, plan, review), each pinning its ACP session mode —
#      profiles already present are kept, so edits made in the UI survive.
#   6. Binary: installs opencode inside the container if missing. The
#      install lands in the persistent dir, so it is a one-time cost.
#   7. Health: waits for the Canvas UI to answer, then prints a summary.
#
# The agent picker in each conversation is the ACP session-mode switch
# the Canvas UI lacks: opencode-ask reads and answers without editing,
# opencode-plan prepares a plan, opencode-build does the integrated work
# and opencode-review reviews the diff. All of them run the ACP agent with
# the `ollama/glm-5.3-flash:cloud` model via the host Ollama gateway — no
# manual UI step needed.
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

# Agent profiles live in the openhands-state volume. Canvas has no ACP
# session-mode picker in the UI, so each opencode profile pins its mode
# and doubles as the mode selector in the conversation's agent picker.
ACP_PROFILE_DIR="/home/openhands/.openhands/agent-profiles"
ACP_LEGACY_PROFILE="opencode-acp.json"
ACP_MODES="build ask plan review"

# Repo tree adjacent to this script: the global rules (AGENTS.md), the
# skills and the mode agents (Ask/Plan/Build/Review) they contain are
# synced into the container config too, so the ACP agent plans like a
# host agent does. Absent when the script runs as a standalone copy
# (~/bin): the sync is then skipped with a warning.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
HOST_AGENTS="$REPO_ROOT/opencode/AGENTS.md"
HOST_AGENTS_DIR="$REPO_ROOT/opencode/agents"
HOST_SKILLS="$REPO_ROOT/opencode/skills"

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
#
# When the repo tree is adjacent to this script (normal checkout), the
# global AGENTS.md, the skills and the mode agents are synced the same
# way: opencode loads its global instructions from
# `.config/opencode/AGENTS.md`, discovers skills in
# `.config/opencode/skills/` and the mode agents (Ask/Plan/Build/Review)
# in `.config/opencode/agents/`. The trees are wiped before each copy so
# deletions/renames on the host side propagate (docker cp would only
# merge). A standalone copy of this script (~/bin) has no repo to read
# from: both are skipped with a warning instead of failing.
install_config() {
  log "Config: copie dans le conteneur…"
  docker exec "$CONTAINER_NAME" mkdir -p /home/openhands/.config/opencode
  docker cp "${CONFIG_FILE}" "${CONTAINER_NAME}:/home/openhands/.config/opencode/opencode.jsonc"
  docker exec --user root "${CONTAINER_NAME}" chown "${CANVAS_USER}:${CANVAS_USER}" /home/openhands/.config/opencode/opencode.jsonc
  if [ -f "$HOST_AGENTS" ] && [ -d "$HOST_SKILLS" ]; then
    log "Config: copie des règles globales (AGENTS.md), des skills et des agents de mode…"
    docker cp "${HOST_AGENTS}" "${CONTAINER_NAME}:/home/openhands/.config/opencode/AGENTS.md"
    docker exec --user root "${CONTAINER_NAME}" chown "${CANVAS_USER}:${CANVAS_USER}" /home/openhands/.config/opencode/AGENTS.md
    docker exec --user root "$CONTAINER_NAME" rm -rf /home/openhands/.config/opencode/skills
    docker cp "${HOST_SKILLS}" "${CONTAINER_NAME}:/home/openhands/.config/opencode/skills"
    docker exec --user root "$CONTAINER_NAME" chown -R "${CANVAS_USER}:${CANVAS_USER}" /home/openhands/.config/opencode/skills
    if [ -d "$HOST_AGENTS_DIR" ]; then
      docker exec --user root "$CONTAINER_NAME" rm -rf /home/openhands/.config/opencode/agents
      docker cp "${HOST_AGENTS_DIR}" "${CONTAINER_NAME}:/home/openhands/.config/opencode/agents"
      docker exec --user root "$CONTAINER_NAME" chown -R "${CANVAS_USER}:${CANVAS_USER}" /home/openhands/.config/opencode/agents
    fi
  else
    log "Config: AGENTS.md/skills introuvables à côté du script — non copiés (copie standalone du script)."
  fi
  log "Config installée dans le conteneur."
}

# Seed the four per-mode opencode agent profiles into the container.
# Canvas has no ACP session-mode picker in its UI; the SDK derives the
# session mode from the selected agent profile (`acp_session_mode`), so
# one profile per mode turns the mode into a pick in the agent picker.
# Per-name rule, evaluated at each `up`: present in the volume -> left
# untouched (edits made in the UI survive); absent -> (re)written from
# the canonical definitions. The legacy generic `opencode-acp` preset
# (no pinned mode) is removed at each `up`, best-effort: a failed removal
# logs a warning instead of aborting `up`. Profiles
# are written to the host staging dir first
# (~/.local/share/openhands/agent-profiles/) — a wiped volume is
# repopulated from there on the next `up` — then `docker cp`-ed one by
# one (`mkdir -p` first: a fresh container has no `agent-profiles/` yet
# and `docker cp` fails into a missing destination directory).
acp_profile_id() {
  case "$1" in
    build) echo "5b1d0c3a-9e24-4f77-b2d6-8a41c5e93f10" ;;
    ask) echo "7d94e2b1-3a68-4c15-9f8b-0e57a6d2c481" ;;
    plan) echo "2c8f6a94-71d3-4b2e-8d50-93b4e1f7a2c0" ;;
    review) echo "4e7a2b8f-0d51-49c3-a6b9-1f28c4d5e736" ;;
    *) die "mode ACP inconnu: $1" ;;
  esac
}

write_acp_profile() {
  local mode="$1" file="$2" id
  id="$(acp_profile_id "$mode")"
  cat > "$file" <<EOF
{
  "schema_version": 4,
  "agent_kind": "acp",
  "id": "$id",
  "name": "opencode-$mode",
  "revision": 1,
  "mcp_server_refs": null,
  "secret_refs": null,
  "integration_refs": null,
  "sandbox": null,
  "acp_server": "custom",
  "acp_model": "ollama/glm-5.3-flash:cloud",
  "acp_effort": null,
  "acp_session_mode": "$mode",
  "acp_prompt_timeout": 1800.0,
  "acp_startup_timeout": 90.0,
  "acp_command": "/home/openhands/.opencode/bin/opencode acp",
  "acp_args": null
}
EOF
}

seed_profiles() {
  local staging="$OPENHANDS_DATA/agent-profiles"
  local mode file
  mkdir -p "$staging"
  docker exec "$CONTAINER_NAME" mkdir -p "$ACP_PROFILE_DIR"
  for mode in $ACP_MODES; do
    if docker exec "$CONTAINER_NAME" test -f "$ACP_PROFILE_DIR/opencode-${mode}.json" 2>/dev/null; then
      log "Profil: opencode-${mode} déjà présent — conservé (modifiable dans l'UI)"
      continue
    fi
    file="$staging/opencode-${mode}.json"
    write_acp_profile "$mode" "$file"
    docker cp "$file" "$CONTAINER_NAME:$ACP_PROFILE_DIR/opencode-${mode}.json"
    docker exec --user root "$CONTAINER_NAME" chown "${CANVAS_USER}:${CANVAS_USER}" "$ACP_PROFILE_DIR/opencode-${mode}.json"
    log "Profil: opencode-${mode} écrit dans le conteneur (mode ACP: ${mode})"
  done
  docker exec --user root "$CONTAINER_NAME" rm -f "$ACP_PROFILE_DIR/$ACP_LEGACY_PROFILE" 2>/dev/null \
    || log "Attention: retrait du preset ${ACP_LEGACY_PROFILE%.json} impossible (non bloquant)"
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
  if [ -f "$HOST_AGENTS" ] && [ -d "$HOST_SKILLS" ] && [ -d "$HOST_AGENTS_DIR" ]; then
    log "Règles: $HOST_AGENTS + $HOST_SKILLS + $HOST_AGENTS_DIR -> /home/openhands/.config/opencode/ (recopiées à chaque up — l'agent ACP suit les règles globales, les skills et les 4 modes)"
  else
    log "Règles: AGENTS.md/skills introuvables à côté du script — non copiés (copie standalone du script)"
  fi
  echo
  log "Profils: opencode-build/ask/plan/review épinglés par mode ACP -> $ACP_PROFILE_DIR (écrits s'ils manquent, conservés sinon; le preset générique opencode-acp est retiré)"
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
  seed_profiles
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
  if docker exec "$CONTAINER_NAME" test -f /home/openhands/.config/opencode/AGENTS.md 2>/dev/null; then
    log "Règles globales: AGENTS.md présent dans le conteneur"
  else
    log "Règles globales: AGENTS.md absent dans le conteneur"
  fi
  if docker exec "$CONTAINER_NAME" test -d /home/openhands/.config/opencode/skills 2>/dev/null; then
    log "Règles globales: skills présentes dans le conteneur"
  else
    log "Règles globales: skills absentes dans le conteneur"
  fi
  if [ -d "$HOST_AGENTS_DIR" ]; then
    if docker exec "$CONTAINER_NAME" test -d /home/openhands/.config/opencode/agents 2>/dev/null; then
      log "Règles globales: agents de mode présents dans le conteneur"
    else
      log "Règles globales: agents de mode absents dans le conteneur"
    fi
  fi
  if docker exec "$CONTAINER_NAME" test -f "$ACP_PROFILE_DIR/opencode-build.json" 2>/dev/null; then
    log "Profils agents: opencode (4 modes) présents dans le conteneur"
  else
    log "Profils agents: opencode absents dans le conteneur (relance: $0 up)"
  fi
}

usage() {
  sed -n '2,35p' "$0"
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
