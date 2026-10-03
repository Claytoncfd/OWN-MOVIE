"""Caminhos e utilidades compartilhadas. Sem dependência de torch/ComfyUI (testável isolado)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

SUBFOLDER = "OWN_MOVIE/projects"


def output_root() -> Path:
    try:
        import folder_paths  # type: ignore  # presente só dentro do ComfyUI

        return Path(folder_paths.get_output_directory())
    except Exception:
        return Path(os.environ.get("OWN_MOVIE_OUT", "output"))


def slug(name: str) -> str:
    """Nome de projeto seguro para pasta. Remove '/', '.', '..' (sem path traversal)."""
    s = re.sub(r"[^\w\-]+", "_", (name or "").strip(), flags=re.UNICODE).strip("_")[:64]
    if not s:
        raise ValueError("Nome de projeto vazio ou inválido.")
    return s


def project_dir(name: str, create: bool = False) -> Path:
    d = output_root() / SUBFOLDER / slug(name)
    if create:
        for sub in ("audio", "clips", "frames"):
            (d / sub).mkdir(parents=True, exist_ok=True)
    return d


def view_ref(path: Path) -> dict:
    """Referência no formato do /view do ComfyUI (filename/subfolder/type)."""
    rel = path.resolve().relative_to(output_root().resolve())
    parent = rel.parent.as_posix()
    return {"filename": rel.name, "subfolder": "" if parent == "." else parent, "type": "output"}


def read_project(name: str) -> dict:
    f = project_dir(name) / "scenes.json"
    if not f.exists():
        raise FileNotFoundError(
            f"Projeto '{name}' não tem scenes.json. Rode antes o workflow 01_PLANO (ScriptSplitter → agentes → ProjectSave)."
        )
    return json.loads(f.read_text(encoding="utf-8"))


def project_status(name: str) -> dict:
    """Estado real em disco: usado pela página Projetos (via rota /own_movie/project/<nome>)."""
    d = project_dir(name)
    data = read_project(name)
    scenes = []
    for sc in data["scenes"]:
        sid = sc["id"]
        clip, last = d / "clips" / f"{sid}.mp4", d / "frames" / f"{sid}_last.png"
        auds = sorted((d / "audio").glob(f"{sid}_*.wav"))
        scenes.append(
            {
                **sc,
                "has_audio": bool(auds),
                "audio": view_ref(auds[-1]) if auds else None,
                "has_clip": clip.exists(),
                "has_last_frame": last.exists(),
                "clip": view_ref(clip) if clip.exists() else None,
            }
        )
    final = d / "final.mp4"
    return {
        "project": data.get("project", name),
        "scenes": scenes,
        "final": view_ref(final) if final.exists() else None,
    }


EDITABLE = ("narration", "prompt", "negative")


def update_scene(name: str, scene_id: str, fields: dict) -> dict:
    """Edita narração/prompt de uma cena e invalida só o que ficou velho (áudio, clipe, último frame, final)."""
    bad = set(fields) - set(EDITABLE)
    if bad:
        raise ValueError(f"Campos não editáveis: {sorted(bad)}")
    d = project_dir(name)
    data = read_project(name)
    sc = next((x for x in data["scenes"] if x["id"] == scene_id), None)
    if sc is None:
        raise KeyError(f"Cena {scene_id} não existe no projeto {name}.")
    changed = {k for k, v in fields.items() if str(v) != str(sc.get(k, ""))}
    sc.update({k: str(v) for k, v in fields.items()})
    (d / "scenes.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    stale = []
    if "narration" in changed:
        stale += list((d / "audio").glob(f"{scene_id}_*.wav"))
    if changed:
        stale += [d / "clips" / f"{scene_id}.mp4", d / "frames" / f"{scene_id}_last.png", d / "final.mp4"]
    for f in stale:
        f.unlink(missing_ok=True)
    return sc
