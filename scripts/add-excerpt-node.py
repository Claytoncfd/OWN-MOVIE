#!/usr/bin/env python3
"""OWN MOVIE — adiciona o nó CENA_EXCERTO (PrimitiveString, id 200) ao workflow.

Cada cena do projeto injeta sua narração nesse nó: o trecho viaja dentro de
cada prompt do ComfyUI (auditoria por job + base para legendas futuras).
Idempotente: pula se o nó já existir. Aplica nas 3 cópias ativas.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [ROOT / "workflows/WAN2.2.json", ROOT / "src/data/WAN2.2.json",
           ROOT / "opensource/comfyui/user/workflows/WAN2.2.json"]
NODE = {"id": 200, "type": "OwnMovieExcerpt", "pos": [7900, 2520],
        "size": [320, 120], "flags": {}, "order": 5, "mode": 0,
        "inputs": [], "outputs": [{"name": "excerpt", "type": "STRING", "links": None}],
        "title": "CENA_EXCERTO", "properties": {"Node name for S&R": "OwnMovieExcerpt"},
        "widgets_values": [""]}

for p in TARGETS:
    wf = json.loads(p.read_text())
    if not any(n["id"] == 200 for n in wf["nodes"]):
        wf["nodes"].append(dict(NODE))
        wf["last_node_id"] = max(wf.get("last_node_id", 0), 200)
        print(f"{p.relative_to(ROOT)}: nó CENA_EXCERTO (200) adicionado")
    else:
        for n in wf["nodes"]:
            if n["id"] == 200 and n["type"] != "OwnMovieExcerpt":
                n["type"] = "OwnMovieExcerpt"
                n["properties"]["Node name for S&R"] = "OwnMovieExcerpt"
                print(f"{p.relative_to(ROOT)}: nó 200 convertido para OwnMovieExcerpt")
    before = len(wf.get("groups", []))
    wf["groups"] = [g for g in wf.get("groups", []) if g.get("title") != "CENA_EXCERTO"]
    if len(wf["groups"]) < before:
        print(f"{p.relative_to(ROOT)}: pasta CENA_EXCERTO removida (o nó fica no painel Nós > OWN MOVIE)")
    p.write_text(json.dumps(wf))
