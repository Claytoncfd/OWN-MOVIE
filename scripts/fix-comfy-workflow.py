#!/usr/bin/env python3
"""OWN MOVIE — registra o workflow Wan 2.2 no ComfyUI de verdade.

1. Lê a fonte canônica (nunca modificada): opensource/ComfyUI-Wan2.2-workflow-main/WAN2.2.json
2. Corrige os caminhos de modelo do Windows do autor para os arquivos locais reais.
3. Grava nas 3 cópias ativas:
   - workflows/WAN2.2.json                      (cópia ativa do projeto)
   - src/data/WAN2.2.json                       (canvas + aba Modelo da UI)
   - opensource/comfyui/user/workflows/WAN2.2.json  (onde o ComfyUI lista em Workflows)
Falha se algum modelo não existir — sem caminho falso.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "opensource/ComfyUI-Wan2.2-workflow-main/WAN2.2.json"
COMFY = ROOT / "opensource/comfyui"

# node_id -> (pastas candidatas no ComfyUI, nome de arquivo local correto)
FIXES = {
    2: (["models/unet", "models/diffusion_models"], "wan2.2-rapid-mega-aio-nsfw-v12.1-Q4_K.gguf"),
    4: (["models/clip", "models/text_encoders"], "umt5-xxl-encoder-Q3_K_S.gguf"),
    6: (["models/vae"], "wan_2.1_vae.safetensors"),
    92: (["models/loras"], "DR34ML4Y_I2V_14B_LOW_V2.safetensors"),
}
DESTS = [
    ROOT / "workflows/WAN2.2.json",
    ROOT / "src/data/WAN2.2.json",
    COMFY / "user/workflows/WAN2.2.json",
]

wf = json.loads(SRC.read_text())
by_id = {n["id"]: n for n in wf["nodes"]}
errors = []
for nid, (dirs, filename) in FIXES.items():
    found = next((d for d in dirs if (COMFY / d / filename).exists()), None)
    if not found:
        errors.append(f"node {nid}: {filename} não achado em {dirs}")
        continue
    vals = by_id[nid].get("widgets_values")
    if nid == 92:
        vals[3] = filename  # lora_name_1 no easy loraStack
    else:
        vals[0] = filename
    print(f"node {nid}: -> {filename}  (ok em {found})")

if errors:
    print("ERRO:", *errors, sep="\n  ", file=sys.stderr)
    sys.exit(1)

for d in DESTS:
    d.parent.mkdir(parents=True, exist_ok=True)
    d.write_text(json.dumps(wf))
    print(f"gravado {d.relative_to(ROOT)} ({d.stat().st_size // 1024} KB)")
print("Workflow real registrado. Abra http://127.0.0.1:8188 → Workflows → WAN2.2.json")
