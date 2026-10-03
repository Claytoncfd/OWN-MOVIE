"""OmniVoice: backends HTTP e CLI, com cache em disco por (texto, voz, idioma). Só stdlib."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shlex
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

from .media import ensure_wav

BACKENDS = ["cli", "python", "http"]
DEFAULT_MODEL = "k2-fsa/OmniVoice"
DEFAULT_CLI = "omnivoice-infer --model {model} --text {text} --output {out} --language {lang} {ref_args}"


def cache_key(text: str, voice: str, lang: str) -> str:
    return hashlib.sha1(f"{voice}|{lang}|{text}".encode()).hexdigest()[:10]


def synth_http(url: str, text: str, voice: str, lang: str, timeout: int) -> bytes:
    req = urllib.request.Request(
        url, data=json.dumps({"text": text, "voice": voice, "language": lang}).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            ctype, body = r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"OmniVoice respondeu HTTP {e.code} em {url}.") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise RuntimeError(f"OmniVoice indisponível em {url}: {e}. Suba o serviço ou use backend 'cli'.") from e
    if "json" in ctype:
        j = json.loads(body)
        if j.get("audio"):
            return base64.b64decode(j["audio"])
        if j.get("url"):
            with urllib.request.urlopen(j["url"], timeout=timeout) as r2:
                return r2.read()
        raise RuntimeError("Resposta JSON do OmniVoice sem 'audio' nem 'url'.")
    return body


def synth_cli(template: str, text: str, voice: str, lang: str, out: Path, timeout: int, model: str = DEFAULT_MODEL) -> bytes:
    """Executa o comando SEM shell. Placeholders: {text} {out} {lang} {model} {voice} e {ref_args}.
    {ref_args} vira `--ref_audio <arquivo>` quando `voice` é o caminho de um áudio existente (clonagem), senão some.
    Flags conferidos no bridge.mjs: --model --text --output --language --ref_audio.
    Se OMNIVOICE_BIN estiver definido, ele substitui o executável `omnivoice-infer`."""
    ref = voice if voice and voice != "default" and Path(voice).is_file() else ""
    mapping = {"{text}": text[:2000], "{out}": str(out), "{voice}": voice, "{lang}": lang, "{model}": model}
    args: list[str] = []
    for tok in shlex.split(template):
        if tok == "{ref_args}":
            args += ["--ref_audio", ref] if ref else []
            continue
        for k, v in mapping.items():
            tok = tok.replace(k, v)
        args.append(tok)
    if args and args[0] == "omnivoice-infer" and os.environ.get("OMNIVOICE_BIN"):
        args[0] = os.environ["OMNIVOICE_BIN"]
    try:
        p = subprocess.run(args, capture_output=True, timeout=timeout)
    except FileNotFoundError as e:
        raise RuntimeError(f"Comando do OmniVoice não encontrado: {args[0]}. Defina OMNIVOICE_BIN com o caminho do omnivoice-infer.") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"OmniVoice CLI excedeu {timeout}s.") from e
    if p.returncode != 0:
        raise RuntimeError(f"omnivoice-infer falhou ({p.returncode}): {p.stderr.decode(errors='replace')[-300:]}")
    if not out.exists():
        raise RuntimeError(f"OmniVoice CLI terminou sem gerar {out}. Confira o cli_template.")
    return out.read_bytes()


_MODEL = None


def synth_python(text: str, lang: str, model_id: str, device: str, keep_loaded: bool) -> bytes:
    """OmniVoice em processo (mesma API do scripts/batch-tts.py). Exige `omnivoice` instalado no Python do ComfyUI.
    Cuidado com VRAM: com keep_loaded=False o modelo é liberado ao fim de cada cena (o Wan precisa da GPU)."""
    global _MODEL
    try:
        import torch  # type: ignore
        from omnivoice import OmniVoice  # type: ignore
        from omnivoice.utils.common import get_best_device  # type: ignore
    except ImportError as e:
        raise RuntimeError("Pacote 'omnivoice' não está instalado no Python do ComfyUI. Use backend 'cli' ou instale-o nesse ambiente.") from e
    import io
    import numpy as np
    from .media import write_wav
    dev = "cpu" if device == "cpu" else get_best_device()
    if _MODEL is None:
        _MODEL = OmniVoice.from_pretrained(model_id, device_map=dev, dtype=torch.float32 if dev == "cpu" else torch.float16)
    try:
        aud = _MODEL.generate(text=text, language=lang)
        w = aud[0]
        arr = np.asarray(w.detach().cpu().float().numpy() if hasattr(w, "detach") else w, dtype=np.float32).reshape(-1)[None, :]
        buf = io.BytesIO()
        tmp = Path(os.environ.get("TMPDIR", "/tmp")) / f"ownmovie_{os.getpid()}.wav"
        write_wav(tmp, arr, int(_MODEL.sampling_rate))
        buf.write(tmp.read_bytes())
        tmp.unlink(missing_ok=True)
        return buf.getvalue()
    finally:
        if not keep_loaded:
            _MODEL = None
            import gc
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()


def synthesize_to_wav(wav_path: Path, backend: str, text: str, voice: str, lang: str, url: str, cli_template: str, timeout: int,
                      model: str = DEFAULT_MODEL, device: str = "auto", keep_loaded: bool = False) -> Path:
    """Gera (ou reaproveita do cache) o WAV da cena."""
    if wav_path.exists():
        return wav_path
    if backend == "http":
        data = synth_http(url, text, voice, lang, timeout)
    elif backend == "python":
        data = synth_python(text, lang, model, device, keep_loaded)
    else:
        tmp = wav_path.with_name(wav_path.stem + ".tmp.wav")
        try:
            data = synth_cli(cli_template, text, voice, lang, tmp, timeout, model)
        finally:
            tmp.unlink(missing_ok=True)
    wav_path.write_bytes(ensure_wav(data))
    return wav_path
