"""Modelo de cena e divisão do texto (porte fiel do splitText do front, agora no ComfyUI)."""
from __future__ import annotations

import json
import re

MODES = ["fragmentos", "unico"]


def split_text(text: str, mode: str = "fragmentos", max_chars: int = 180) -> list[str]:
    t = (text or "").strip()
    if not t:
        return []
    if mode == "fragmentos":
        parts = re.split(r"\n\s*(?:---+)?\s*\n", t)
        return [p for p in (re.sub(r"\s+", " ", x).strip() for x in parts) if p]
    sentences = re.findall(r"[^.!?…]+[.!?…]*", re.sub(r"\s+", " ", t)) or [t]
    out, cur = [], ""
    for s in sentences:
        if len(cur + s) > max_chars and cur:
            out.append(cur.strip())
            cur = ""
        cur += s
    if cur.strip():
        out.append(cur.strip())
    return out


def new_scene(i: int, text: str) -> dict:
    return {
        "id": f"c{i + 1:03d}",
        "index": i,
        "text": text,        # trecho original (nunca alterado)
        "narration": text,   # texto que vai para o TTS (o agente Emoção pode reescrever)
        "prompt": "",        # prompt visual (o agente Planner preenche)
        "negative": "",
        "tone": "",
        "pace": "",
        "warnings": [],
    }


def dump_scenes(scenes: list[dict]) -> str:
    return json.dumps(scenes, ensure_ascii=False)


def load_scenes(raw: str) -> list[dict]:
    data = json.loads(raw)
    if not isinstance(data, list) or not all(isinstance(x, dict) and "id" in x for x in data):
        raise ValueError("OWN_SCENES inválido: esperado lista de cenas com 'id'.")
    return data
