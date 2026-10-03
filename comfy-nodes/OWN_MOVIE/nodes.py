"""OWN MOVIE — nós próprios do projeto.

OwnMovieExcerpt: carrega o trecho da cena (narração) dentro do grafo.
Comportamento idêntico a um PrimitiveString (repassa o valor), com uma
função real a mais: registra o trecho no log do servidor a cada execução,
criando trilha de auditoria cena -> job.

OwnMovieOmniRoute: chama os agentes via OmniRoute (endpoint OpenAI-compatível).
A chave sai de OMNIROUTE_API_KEY ou de ~/.hermes/config.yaml (fora do repo).

OwnMovieEmotion: agente de emoção — reescreve a narração com sintaxe
emocional na pontuação (pausas "...", ênfases, marcadores não-verbais como
[laughter] que o OmniVoice entende) + metadados por regras determinísticas.

OwnMovieTTS: sintetiza a narração com o OmniVoice real (subprocesso do
omnivoice-infer do venv) e devolve AUDIO do ComfyUI. device auto tenta CUDA
e cai para CPU em OOM (Wan 14B + TTS disputam os mesmos 12GB).
"""
import json
import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path


def _omni_key():
    key = os.environ.get("OMNIROUTE_API_KEY", "").strip()
    if key:
        return key
    try:
        for line in (Path.home() / ".hermes" / "config.yaml").read_text().splitlines():
            if "api_key" in line and "sk-" in line:
                return "sk-" + line.split("sk-")[1].split()[0].strip("\"'")
    except OSError:
        pass
    return ""


def _chat(base_url, key, model, system, user, max_tokens=800, timeout=180):
    body = json.dumps({"model": model,
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": user}]}).encode()
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", data=body,
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def _chat_ollama(model, system, user, num_predict=600, timeout=600):
    """Fallback local (Ollama, sem quota): devolve message.content (thinking vem separado)."""
    base = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    body = json.dumps({"model": model,
                       "messages": [{"role": "system", "content": system},
                                    {"role": "user", "content": user}],
                       "stream": False, "options": {"num_predict": num_predict}}).encode()
    req = urllib.request.Request(base + "/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        msg = json.loads(r.read()).get("message", {})
    text = (msg.get("content") or "").strip()
    if not text:
        raise RuntimeError("OwnMovie: Ollama devolveu conteúdo vazio")
    return text


def _chat_auto(base_url, key, model, system, user, max_tokens=800, timeout=180,
               ollama_model="qwen-heretic:latest"):
    """OmniRoute primeiro; em falha (ex.: quota 503), cai para o Ollama local."""
    try:
        return _chat(base_url, key, model, system, user, max_tokens, timeout)
    except Exception as e:
        print(f"[OWN MOVIE] OmniRoute falhou ({e}), fallback Ollama local")
        return _chat_ollama(ollama_model, system, user)


class OwnMovieExcerpt:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"value": ("STRING", {"multiline": True})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("excerpt",)
    FUNCTION = "run"
    CATEGORY = "OWN MOVIE"

    def run(self, value):
        print(f"[OWN MOVIE] cena -> {value[:120]}")
        return (value,)


class OwnMovieOmniRoute:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "prompt": ("STRING", {"multiline": True}),
            "system": ("STRING", {"multiline": True, "default": "Você é um agente do OWN MOVIE. Responda de forma curta e direta."}),
            "model": ("STRING", {"default": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"}),
            "base_url": ("STRING", {"default": "http://127.0.0.1:20128/v1"}),
            "max_tokens": ("INT", {"default": 800, "min": 16, "max": 8000}),
        }, "optional": {
            "use_fallback": ("BOOLEAN", {"default": True}),
            "ollama_model": ("STRING", {"default": "qwen-heretic:latest"}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "OWN MOVIE"

    def run(self, prompt, system, model, base_url, max_tokens, use_fallback=True, ollama_model="qwen-heretic:latest"):
        key = _omni_key()
        if not key:
            raise RuntimeError("OwnMovieOmniRoute: sem chave (OMNIROUTE_API_KEY ou ~/.hermes/config.yaml)")
        if use_fallback:
            return (_chat_auto(base_url, key, model, system, prompt, max_tokens, ollama_model=ollama_model),)
        return (_chat(base_url, key, model, system, prompt, max_tokens),)


EMOTION_SYSTEM = (
    "Você é o Agente Emoção do OWN MOVIE. Reescreva a narração abaixo com "
    "sintaxe emocional na pontuação para narração expressiva: reticências ... "
    "para pausas, ?! para surpresa, palavras de impacto em CAIXA ALTA (máx 2), "
    "e marcadores não-verbais como [laughter], [sigh] ou [pause] onde couber. "
    "NÃO mude os fatos nem a ordem. Responda APENAS com a narração reescrita."
)


class OwnMovieEmotion:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "narration": ("STRING", {"multiline": True, "forceInput": True}),
            "model": ("STRING", {"default": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"}),
            "base_url": ("STRING", {"default": "http://127.0.0.1:20128/v1"}),
        }, "optional": {
            "use_fallback": ("BOOLEAN", {"default": True}),
            "ollama_model": ("STRING", {"default": "qwen-heretic:latest"}),
        }}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("emotional_text", "emotion_json")
    FUNCTION = "run"
    CATEGORY = "OWN MOVIE"

    def run(self, narration, model, base_url, use_fallback=True, ollama_model="qwen-heretic:latest"):
        key = _omni_key()
        if not key:
            raise RuntimeError("OwnMovieEmotion: sem chave (OMNIROUTE_API_KEY ou ~/.hermes/config.yaml)")
        if use_fallback:
            emo = _chat_auto(base_url, key, model, EMOTION_SYSTEM, narration,
                             max_tokens=1200, ollama_model=ollama_model).strip()
        else:
            emo = _chat(base_url, key, model, EMOTION_SYSTEM, narration, max_tokens=1200).strip()
        meta = {"pauses": emo.count("..."), "questions": emo.count("?"),
                "exclaims": emo.count("!"), "marks": sorted({m for m in ("laughter", "sigh", "pause", "gasp") if m in emo})}
        print(f"[OWN MOVIE] emoção aplicada: {json.dumps(meta, ensure_ascii=False)}")
        return (emo, json.dumps(meta, ensure_ascii=False))


def _find_infer():
    for c in (os.environ.get("OMNIVOICE_BIN", ""),
              "/home/cfd/.venvs/omnivoice/bin/omnivoice-infer", "omnivoice-infer"):
        if c and (c == "omnivoice-infer" or Path(c).exists()):
            return c
    return ""


class OwnMovieTTS:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "text": ("STRING", {"multiline": True, "forceInput": True}),
            "language": ("STRING", {"default": "pt"}),
            "device": (["auto", "cuda", "cpu"],),
        }}

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "run"
    CATEGORY = "OWN MOVIE"

    def run(self, text, language, device):
        import torch

        cli = _find_infer()
        if not cli:
            raise RuntimeError("OwnMovieTTS: omnivoice-infer não achado (OMNIVOICE_BIN ou venv)")
        with tempfile.TemporaryDirectory(prefix="ownmovie-tts-") as d:
            out = str(Path(d) / "voz.wav")
            for dev in (["cuda", "cpu"] if device == "auto" else [device]):
                r = subprocess.run([cli, "--text", text[:2000], "--output", out,
                                    "--language", language or "pt", "--device", dev],
                                   capture_output=True, text=True, timeout=600)
                if r.returncode == 0 and Path(out).exists():
                    break
                if "out of memory" in (r.stderr or "").lower() and dev == "cuda":
                    print("[OWN MOVIE] TTS sem VRAM no cuda, caindo para cpu")
                    continue
                raise RuntimeError(f"OwnMovieTTS falhou: {(r.stderr or '')[-300:]}")
            import wave
            with wave.open(out, "rb") as w:
                sr, n, raw = w.getframerate(), w.getnframes(), w.readframes(w.getnframes())
                ch = w.getnchannels()
        pcm = torch.frombuffer(bytearray(raw), dtype=torch.int16).float() / 32768.0
        pcm = pcm.reshape(1, ch, n).mean(dim=1, keepdim=True)
        print(f"[OWN MOVIE] TTS ok: {n/sr:.1f}s @{sr}Hz")
        return ({"waveform": pcm, "sample_rate": sr},)


NODE_CLASS_MAPPINGS = {
    "OwnMovieExcerpt": OwnMovieExcerpt,
    "OwnMovieOmniRoute": OwnMovieOmniRoute,
    "OwnMovieEmotion": OwnMovieEmotion,
    "OwnMovieTTS": OwnMovieTTS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "OwnMovieExcerpt": "Excerpt (OWN MOVIE)",
    "OwnMovieOmniRoute": "OmniRoute Agent (OWN MOVIE)",
    "OwnMovieEmotion": "Emotion (OWN MOVIE)",
    "OwnMovieTTS": "TTS OmniVoice (OWN MOVIE)",
}
