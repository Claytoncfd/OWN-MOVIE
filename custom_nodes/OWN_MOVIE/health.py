"""Estado real das dependências, medido no servidor (sem CORS no navegador). Substitui GET :8000/api/health."""
from __future__ import annotations

import os
import shutil
import urllib.error
import urllib.request
from pathlib import Path


def _probe(url: str, timeout: float = 2.5) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return {"online": True, "status": r.status}
    except urllib.error.HTTPError as e:
        return {"online": e.code == 401, "status": e.code}  # 401 = OmniRoute no ar pedindo chave (ok)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return {"online": False, "error": str(e)}


def check() -> dict:
    router = os.environ.get("OMNIROUTE_URL", "http://127.0.0.1:20128/v1").rstrip("/")
    ffmpeg = shutil.which("ffmpeg")
    bin_ = os.environ.get("OMNIVOICE_BIN") or shutil.which("omnivoice-infer") or ""
    ok_bin = bool(bin_) and Path(bin_).exists()
    return {
        "omniroute": {"url": router, **_probe(f"{router}/models")},
        "omnivoice": {"online": ok_bin, "bin": bin_ or None,
                      "hint": None if ok_bin else "Defina OMNIVOICE_BIN com o caminho do omnivoice-infer (venv do OmniVoice)."},
        "ffmpeg": {"online": bool(ffmpeg), "bin": ffmpeg, "hint": None if ffmpeg else "Instale o FFmpeg e coloque no PATH."},
    }
