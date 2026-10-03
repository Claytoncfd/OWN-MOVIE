#!/usr/bin/env bash
# Instala custom_nodes/OWN_MOVIE no ComfyUI (opensource/comfyui ou COMFYUI_DIR). Guarda backup do __init__.py antigo.
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${COMFYUI_DIR:-$HERE/opensource/comfyui}/custom_nodes/OWN_MOVIE"
mkdir -p "$DEST"
[ -f "$DEST/__init__.py" ] && [ ! -f "$DEST/__init__.py.bak" ] && cp "$DEST/__init__.py" "$DEST/__init__.py.bak" && echo "backup: $DEST/__init__.py.bak"
cp -r "$HERE/custom_nodes/OWN_MOVIE/." "$DEST/"
find "$DEST" -name __pycache__ -prune -exec rm -rf {} +
echo "Nodes instalados em $DEST — reinicie o ComfyUI."
echo "Requisitos: ffmpeg no PATH · Pillow · OMNIVOICE_BIN (omnivoice-infer) · OMNIROUTE_API_KEY se o OmniRoute pedir chave."
