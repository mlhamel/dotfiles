#!/usr/bin/env bash
set -euo pipefail

# setup-ollama.sh — install the ollama gateway and register the models pinned in
# opencode.json's providers.ollama.models: the routing table is the single
# source of truth for what gets pulled, so they cannot drift apart.
# Idempotent: safe to re-run. Skip with: SKIP_OLLAMA=1.
#
# Local vs cloud models — the `:cloud` suffix matters:
#   - plain tags (e.g. qwen3:4b) are local weights: `ollama pull` downloads
#     them, and a failed pull is a hard error.
#   - `:cloud` tags (e.g. glm-5.3-flash:cloud) run on Ollama's servers:
#     `ollama pull` only downloads a tiny manifest that registers the model
#     locally — no weights, no disk/VRAM. It needs `ollama signin` first.
#     A failed cloud registration is a warning, not a fatal error: the local
#     gateway still works, and the cloud model can be registered later with
#     `ollama signin && ./setup-ollama.sh`.
#
# macOS: ollama is installed with Homebrew (`brew install ollama`) and the
# gateway is started with `brew services start ollama` before the wait
# loop below. The manual hint + exit 0 remains only when Homebrew itself
# is absent.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${SKIP_OLLAMA:-0}" = "1" ]; then
  echo "SKIP_OLLAMA=1 — skipping ollama gateway setup"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 required to read the model list — run the packages step (apt/install.sh) first" >&2
  exit 1
fi

if command -v ollama >/dev/null 2>&1; then
  echo "[ollama] already installed: $(command -v ollama)"
elif [ "$(uname -s)" = "Darwin" ]; then
  if command -v brew >/dev/null 2>&1; then
    echo "[ollama] installing via Homebrew..."
    brew install ollama
    echo "[ollama] starting gateway service..."
    if brew services start ollama; then
      echo "[ollama] gateway service started"
    else
      echo "[ollama] WARN could not start ollama service — start it manually with: ollama serve" >&2
    fi
    command -v ollama >/dev/null 2>&1 || {
      echo "Error: ollama binary not on PATH after install — re-run from a fresh shell" >&2
      exit 1
    }
  else
    echo "[ollama] macOS detected — install manually with: brew install ollama"
    exit 0
  fi
else
  echo "[ollama] installing via official install script..."
  curl -fsSL https://ollama.com/install | sh
  command -v ollama >/dev/null 2>&1 || {
    echo "Error: ollama binary not on PATH after install — re-run from a fresh shell" >&2
    exit 1
  }
fi

echo "[ollama] waiting for gateway at localhost:11434..."
for ((i = 0; i < 30; i++)); do
  curl -fsS http://localhost:11434 >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS http://localhost:11434 >/dev/null 2>&1; then
  echo "Error: ollama gateway not answering on localhost:11434 — start it with: ollama serve" >&2
  exit 1
fi

CONFIG="${HOME}/.config/opencode/opencode.json"
[ -f "${CONFIG}" ] || CONFIG="${DIR}/opencode.json"

if [ ! -f "${CONFIG}" ]; then
  echo "Error: ${CONFIG} not found — run opencode/install.sh first" >&2
  exit 1
fi

MODELS="$(python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
    provider = cfg.get("providers") or cfg.get("provider")
    models = provider["ollama"]["models"]
except Exception:
    sys.exit(1)
if isinstance(models, dict):
    models = list(models.keys())
for model in models:
    print(model)
' "${CONFIG}")" || {
  echo "Error: cannot read providers.ollama.models from ${CONFIG}" >&2
  exit 1
}

if [ -z "${MODELS}" ]; then
  echo "Error: no models under providers.ollama.models in ${CONFIG}" >&2
  exit 1
fi

# Split the routing table: local weights get downloaded, cloud models only
# get their manifest registered (see header comment).
LOCAL_MODELS=""
CLOUD_MODELS=""
while IFS= read -r model; do
  [ -n "${model}" ] || continue
  case "${model}" in
    *":cloud") CLOUD_MODELS="${CLOUD_MODELS}${model}"$'\n' ;;
    *) LOCAL_MODELS="${LOCAL_MODELS}${model}"$'\n' ;;
  esac
done <<<"${MODELS}"

if [ -n "${LOCAL_MODELS}" ]; then
  while IFS= read -r model; do
    [ -n "${model}" ] || continue
    echo "[ollama] pulling local model ${model}..."
    ollama pull "${model}"
  done <<<"${LOCAL_MODELS}"
else
  echo "[ollama] no local models to pull"
fi

CLOUD_FAILED=0
if [ -n "${CLOUD_MODELS}" ]; then
  while IFS= read -r model; do
    [ -n "${model}" ] || continue
    echo "[ollama] registering cloud model ${model} (manifest only, no weights)..."
    if ollama pull "${model}"; then
      :
    else
      echo "[ollama] WARN could not register ${model} — run 'ollama signin' then re-run setup-ollama.sh" >&2
      CLOUD_FAILED=1
    fi
  done <<<"${CLOUD_MODELS}"
fi

if [ "${CLOUD_FAILED}" = 1 ]; then
  echo "[ollama] gateway ready, but some cloud models are not registered (see WARN above)" >&2
else
  echo "Ollama gateway ready: local models pulled, cloud models registered from ${CONFIG}"
fi
