#!/usr/bin/env bash
set -euo pipefail

# setup-ollama.sh — install the ollama gateway and pull the models pinned in
# opencode.json's provider.ollama.models: the routing table is the single
# source of truth for what gets pulled, so they cannot drift apart.
# Idempotent: safe to re-run. Skip with: SKIP_OLLAMA=1.

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
  echo "[ollama] macOS detected — install manually with: brew install ollama"
  exit 0
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
        models = json.load(f)["provider"]["ollama"]["models"]
except Exception:
    sys.exit(1)
if isinstance(models, dict):
    models = list(models.keys())
for model in models:
    print(model)
' "${CONFIG}")" || {
  echo "Error: cannot read provider.ollama.models from ${CONFIG}" >&2
  exit 1
}

if [ -z "${MODELS}" ]; then
  echo "Error: no models under provider.ollama.models in ${CONFIG}" >&2
  exit 1
fi

while IFS= read -r model; do
  echo "[ollama] pulling ${model}..."
  ollama pull "${model}"
done <<<"${MODELS}"

echo "Ollama gateway ready: pinned models pulled from ${CONFIG}"
