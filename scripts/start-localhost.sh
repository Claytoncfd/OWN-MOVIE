#!/usr/bin/env bash
# OWN MOVIE — caminho localhost REAL (127.0.0.1 apenas).
# Ordem: ComfyUI :8188 (com os nodes OWN_MOVIE) → OmniRoute :20128 → UI :3000
# Uso: bash scripts/start-localhost.sh [comfy|voice|router|ui|all]
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Falta '$1' no PATH."; return 1; }; }
have() { [ -e "$1" ]; }

start_comfy() {
  need python3 || return 1
  have opensource/comfyui/custom_nodes/OWN_MOVIE/__init__.py || { echo "Nodes OWN_MOVIE ausentes: rode bash scripts/install-nodes.sh"; return 1; }
  have opensource/comfyui/main.py || { echo "opensource/comfyui ausente."; return 1; }
  have workflows/WAN2.2.json || { echo "workflows/WAN2.2.json ausente."; return 1; }
  echo "Modelos esperados em models/unet, models/clip, models/vae (nomes do WAN2.2.json)."
  echo "→ ComfyUI :8188"
  (cd opensource/comfyui && exec python3 main.py --listen 127.0.0.1 --port 8188 --enable-cors-header)
}
start_voice() {
  if [ -x /home/cfd/.venvs/omnivoice/bin/omnivoice-demo ]; then
    echo "→ OmniVoice demo :8001"
    exec /home/cfd/.venvs/omnivoice/bin/omnivoice-demo --ip 127.0.0.1 --port 8001
  fi
  have opensource/omnivoice/pyproject.toml || { echo "opensource/omnivoice ausente."; return 1; }
  echo "omnivoice-demo não instalado no venv /home/cfd/.venvs/omnivoice."
  echo "Reinstale com: /home/cfd/.venvs/omnivoice/bin/pip install -e opensource/omnivoice"
  echo "A narração por cena NÃO precisa da demo: o node OWN · OmniVoice chama omnivoice-infer (defina OMNIVOICE_BIN)."
  return 1
}
start_router() {
  have opensource/omniroute/package.json || { echo "opensource/omniroute ausente."; return 1; }
  echo "→ OmniRoute :20128 (build de produção; dev quebra no limite de inotify)"
  (cd opensource/omniroute && exec npm start)
}
start_ui() {
  need npm || return 1
  echo "→ UI :3000"
  exec npm run dev
}

case "${1:-all}" in
  comfy) start_comfy ;;
  voice) start_voice ;;
  router) start_router ;;
  ui) start_ui ;;
  all)
    echo "Subindo tudo em janelas separadas é o recomendado (um serviço por terminal):"
    echo "  1) bash scripts/start-localhost.sh comfy"
    echo "  2) bash scripts/start-localhost.sh voice"
    echo "  3) bash scripts/start-localhost.sh router"
    echo "  4) bash scripts/start-localhost.sh ui"
    echo "Checagem sem subir nada: npm run localhost:check"
    ;;
  *) echo "Uso: $0 [comfy|voice|router|ui|all]"; exit 2 ;;
esac
