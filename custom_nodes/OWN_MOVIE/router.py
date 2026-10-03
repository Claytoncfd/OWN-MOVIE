"""Cliente OmniRoute (OpenAI-compatível) + agentes Planner e Emoção. Só stdlib."""
from __future__ import annotations

import difflib
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ROLES = ("planner", "emotion")

PLANNER_SYSTEM = (
    "You are the OWN MOVIE Planner. Given one narration excerpt (any language), write ONE short English "
    "visual prompt (max 40 words) for Wan 2.2 text-to-video, in Vox explainer style: flat editorial collage, "
    "paper cutouts, bold graphic shapes, smooth camera motion. Reply ONLY with JSON: {\"prompt\": \"...\"}"
)

EMOTION_SYSTEM = (
    "You are the OWN MOVIE Emotion agent. Rewrite the narration for text-to-speech by adding ONLY punctuation "
    "and markers: pauses as '...', emphasis with commas/dashes, and optionally these tags: {tags}. "
    "NEVER add, remove or change words or meaning. Same language as the input. "
    "Reply ONLY with JSON: {{\"narration\": \"...\", \"tone\": \"one or two words\", \"pace\": \"slow|normal|fast\"}}"
)


def _key_from_hermes() -> str:
    """Mesma fonte que scripts/batch-render.py usa: ~/.hermes/config.yaml (fora do repositório)."""
    try:
        for line in (Path.home() / ".hermes" / "config.yaml").read_text().splitlines():
            if "api_key" in line and "sk-" in line:
                return "sk-" + line.split("sk-")[1].split()[0].strip("\"'")
    except OSError:
        pass
    return ""


def make_router(base_url: str, api_key: str, planner_model: str, emotion_model: str, timeout: int, temperature: float) -> dict:
    return {
        "base_url": base_url.rstrip("/"),
        # Prefira a variável de ambiente: o valor do widget é gravado em texto puro no workflow exportado.
        "api_key": api_key or os.environ.get("OMNIROUTE_API_KEY", "") or _key_from_hermes(),
        "models": {"planner": planner_model, "emotion": emotion_model},
        "timeout": int(timeout),
        "temperature": float(temperature),
    }


def chat(router: dict, role: str, system: str, user: str) -> str:
    if role not in router["models"]:
        raise ValueError(f"Papel de agente desconhecido: {role}")
    payload = {
        "model": router["models"][role],
        "temperature": router["temperature"],
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    headers = {"Content-Type": "application/json"}
    if router["api_key"]:
        headers["Authorization"] = f"Bearer {router['api_key']}"
    req = urllib.request.Request(
        f"{router['base_url']}/chat/completions", data=json.dumps(payload).encode(), headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=router["timeout"]) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"OmniRoute respondeu HTTP {e.code} (agente '{role}', modelo '{router['models'][role]}').") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RuntimeError(f"OmniRoute indisponível em {router['base_url']}: {e}. Suba com: omniroute") from e
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"Resposta do OmniRoute sem choices/message: {str(data)[:200]}") from e


def extract_json(text: str, want_key: str):
    """Extrai o 1º objeto JSON que contém `want_key`. Ignora blocos <think> e colchetes soltos no texto."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    dec = json.JSONDecoder()
    for m in re.finditer(r"[\{\[]", text):
        try:
            obj, _ = dec.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and want_key in obj:
            return obj
    raise ValueError(f"Nenhum JSON com a chave '{want_key}' na resposta do agente: {text[:200]!r}")


_MARK = re.compile(r"\[[^\]]*\]|\.{2,}|…")


def _words(s: str) -> list[str]:
    return re.findall(r"\w+", _MARK.sub(" ", s).lower())


def same_words(original: str, rewritten: str) -> float:
    """Similaridade 0..1 das palavras (marcadores/pausas ignorados). Garante que a Emoção não mudou o sentido."""
    return difflib.SequenceMatcher(None, _words(original), _words(rewritten)).ratio()


def run_planner(router: dict, scenes: list[dict], overwrite: bool, style_hint: str = "") -> list[dict]:
    out = []
    for sc in scenes:
        sc = dict(sc)
        if sc.get("prompt") and not overwrite:
            out.append(sc)
            continue
        txt = chat(router, "planner", PLANNER_SYSTEM + (f" Extra style: {style_hint}" if style_hint else ""), sc["narration"])
        sc["prompt"] = str(extract_json(txt, "prompt")["prompt"]).strip()
        out.append(sc)
    return out


def run_emotion(router: dict, scenes: list[dict], tags: str, min_similarity: float, on_fail: str) -> list[dict]:
    out = []
    system = EMOTION_SYSTEM.format(tags=tags or "none")
    for sc in scenes:
        sc = dict(sc)
        txt = chat(router, "emotion", system, sc["text"])
        obj = extract_json(txt, "narration")
        new = str(obj["narration"]).strip()
        score = same_words(sc["text"], new)
        if score < min_similarity:
            msg = f"Agente Emoção alterou o sentido da cena {sc['id']} (similaridade {score:.2f} < {min_similarity})."
            if on_fail == "error":
                raise RuntimeError(msg)
            sc["warnings"] = list(sc.get("warnings", [])) + [msg + " Mantido o texto original."]
            out.append(sc)
            continue
        sc["narration"], sc["tone"], sc["pace"] = new, str(obj.get("tone", "")), str(obj.get("pace", ""))
        out.append(sc)
    return out
