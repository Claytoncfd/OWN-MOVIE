"""Nodes OWN MOVIE para o ComfyUI. Cada node é fino: a lógica está em scenes/router/voice/media/common."""
from __future__ import annotations

import json
import time

import numpy as np

from . import media
from . import router as router_mod
from . import scenes as scenes_mod
from . import voice as voice_mod
from .common import project_dir, read_project, slug, view_ref

C1, C2, C3, C4 = "OWN_MOVIE/1 Projeto", "OWN_MOVIE/2 Agentes (OmniRoute)", "OWN_MOVIE/3 Voz (OmniVoice)", "OWN_MOVIE/4 Vídeo"


# ───────────────────────── 1 · PROJETO ─────────────────────────
class OwnMovieScriptSplitter:
    """Recebe o texto (único ou fragmentado) e cria os trechos/cenas."""
    CATEGORY, FUNCTION = C1, "run"
    RETURN_TYPES, RETURN_NAMES = ("OWN_SCENES", "INT"), ("scenes", "count")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "text": ("STRING", {"multiline": True, "default": ""}),
            "mode": (scenes_mod.MODES,),
            "max_chars": ("INT", {"default": 180, "min": 40, "max": 600}),
        }}

    def run(self, text, mode, max_chars):
        chunks = scenes_mod.split_text(text, mode, max_chars)
        if not chunks:
            raise ValueError("Texto vazio: nada para dividir em cenas.")
        sc = [scenes_mod.new_scene(i, c) for i, c in enumerate(chunks)]
        return (scenes_mod.dump_scenes(sc), len(sc))


class OwnMovieProjectSave:
    """Grava scenes.json do projeto (ponto de entrada da página Projetos e do workflow por cena)."""
    CATEGORY, FUNCTION, OUTPUT_NODE = C1, "run", True
    RETURN_TYPES, RETURN_NAMES = ("STRING",), ("path",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"project_name": ("STRING", {"default": "projeto_001"}), "scenes": ("OWN_SCENES",)}}

    def run(self, project_name, scenes):
        d = project_dir(project_name, create=True)
        sc = scenes_mod.load_scenes(scenes)
        f = d / "scenes.json"
        f.write_text(json.dumps({"project": project_name, "saved_at": time.time(), "scenes": sc}, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ui": {"text": [f"{len(sc)} cenas salvas em {f}"]}, "result": (str(f),)}


class OwnMovieSceneLoad:
    """Carrega UMA cena do projeto. A página dispara este workflow N vezes (scene_index 0..N-1)."""
    CATEGORY, FUNCTION = C1, "run"
    RETURN_TYPES = ("OWN_SCENES", "STRING", "STRING", "INT", "INT", "IMAGE")
    RETURN_NAMES = ("scene", "positive", "negative", "seed", "mode_t2v1_i2v2", "prev_last_frame")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "project_name": ("STRING", {"default": "projeto_001"}),
            "scene_index": ("INT", {"default": 0, "min": 0, "max": 9999}),
            "style_prefix": ("STRING", {"multiline": True, "default": "Vox explainer style, flat editorial collage, paper texture, bold graphic shapes, clean motion,"}),
            "negative_default": ("STRING", {"multiline": True, "default": "blurry, low quality, distorted, watermark, text artifacts, deformed"}),
            "seed_base": ("INT", {"default": 1, "min": 0, "max": 2**53}),
            "chain_last_frame": ("BOOLEAN", {"default": False}),
        }}

    @classmethod
    def IS_CHANGED(cls, project_name, scene_index, **_):
        f = project_dir(project_name) / "scenes.json"
        return f.stat().st_mtime if f.exists() else float("nan")

    def run(self, project_name, scene_index, style_prefix, negative_default, seed_base, chain_last_frame):
        data = read_project(project_name)
        all_sc = data["scenes"]
        if not 0 <= scene_index < len(all_sc):
            raise ValueError(f"scene_index {scene_index} fora do intervalo: o projeto tem {len(all_sc)} cenas (0..{len(all_sc) - 1}).")
        sc = dict(all_sc[scene_index])
        sc["_project"] = slug(project_name)
        if not sc.get("prompt"):
            raise ValueError(f"Cena {sc['id']} sem prompt visual. Rode o agente Planner no workflow 01_PLANO.")
        prev = None
        if chain_last_frame and scene_index > 0:
            p = project_dir(project_name) / "frames" / f"{all_sc[scene_index - 1]['id']}_last.png"
            prev = p if p.exists() else None
        if prev is not None:
            from PIL import Image  # type: ignore
            arr = np.asarray(Image.open(prev).convert("RGB"))
        else:
            arr = np.zeros((64, 64, 3), np.uint8)  # placeholder: no modo t2v o ramo i2v é descartado pelo switch
        return (
            scenes_mod.dump_scenes([sc]),
            f"{style_prefix} {sc['prompt']}".strip(),
            sc.get("negative") or negative_default,
            (seed_base + scene_index) % (2**53),
            2 if prev is not None else 1,
            media.numpy_to_image(arr),
        )


# ───────────────────────── 2 · AGENTES / OMNIROUTE ─────────────────────────
class OwnMovieRouterConfig:
    """Distribuição dos agentes: qual modelo do OmniRoute atende cada papel."""
    CATEGORY, FUNCTION = C2, "run"
    RETURN_TYPES, RETURN_NAMES = ("OWN_ROUTER",), ("router",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "base_url": ("STRING", {"default": "http://127.0.0.1:20128/v1"}),
            "planner_model": ("STRING", {"default": ""}),
            "emotion_model": ("STRING", {"default": ""}),
            "timeout_s": ("INT", {"default": 120, "min": 5, "max": 1800}),
            "temperature": ("FLOAT", {"default": 0.4, "min": 0.0, "max": 1.5, "step": 0.05}),
        }, "optional": {"api_key": ("STRING", {"default": ""})}}

    def run(self, base_url, planner_model, emotion_model, timeout_s, temperature, api_key=""):
        if not planner_model or not emotion_model:
            raise ValueError("Defina planner_model e emotion_model (nomes/combos do seu OmniRoute).")
        return (router_mod.make_router(base_url, api_key, planner_model, emotion_model, timeout_s, temperature),)


class OwnMovieAgentPlanner:
    """Agente Planner: escreve o prompt visual (Wan 2.2, estilo Vox) de cada cena."""
    CATEGORY, FUNCTION = C2, "run"
    RETURN_TYPES, RETURN_NAMES = ("OWN_SCENES",), ("scenes",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"router": ("OWN_ROUTER",), "scenes": ("OWN_SCENES",), "overwrite": ("BOOLEAN", {"default": False}),
                             "style_hint": ("STRING", {"default": ""})}}

    def run(self, router: dict, scenes: str, overwrite, style_hint):
        return (scenes_mod.dump_scenes(router_mod.run_planner(router, scenes_mod.load_scenes(scenes), overwrite, style_hint)),)


class OwnMovieAgentEmotion:
    """Agente Emoção: pausas/ênfases/tags na narração SEM mudar as palavras (validado por similaridade)."""
    CATEGORY, FUNCTION = C2, "run"
    RETURN_TYPES, RETURN_NAMES = ("OWN_SCENES",), ("scenes",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "router": ("OWN_ROUTER",), "scenes": ("OWN_SCENES",),
            "allowed_tags": ("STRING", {"default": "[laughter], [sigh]"}),
            "min_similarity": ("FLOAT", {"default": 0.85, "min": 0.5, "max": 1.0, "step": 0.01}),
            "on_fail": (["error", "keep_original"],),
        }}

    def run(self, router: dict, scenes: str, allowed_tags, min_similarity, on_fail):
        res = router_mod.run_emotion(router, scenes_mod.load_scenes(scenes), allowed_tags, min_similarity, on_fail)
        return (scenes_mod.dump_scenes(res),)


# ───────────────────────── 3 · VOZ / OMNIVOICE ─────────────────────────
class OwnMovieOmniVoice:
    """Gera a narração da cena (CLI, Python ou HTTP), com cache em disco. Saída: AUDIO nativo do ComfyUI.
    É OUTPUT_NODE para poder rodar sozinho no workflow 02_VOZ (fase de áudio, antes da GPU de vídeo)."""
    CATEGORY, FUNCTION, OUTPUT_NODE = C3, "run", True
    RETURN_TYPES, RETURN_NAMES = ("AUDIO", "FLOAT", "STRING"), ("audio", "duration_s", "wav_path")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "scene": ("OWN_SCENES",),
            "backend": (voice_mod.BACKENDS,),
            "voice": ("STRING", {"default": "default"}),  # "default" ou caminho de um áudio de referência (clonagem, só no cli)
            "language": ("STRING", {"default": "pt"}),
            "model": ("STRING", {"default": voice_mod.DEFAULT_MODEL}),
            "cli_template": ("STRING", {"default": voice_mod.DEFAULT_CLI}),
            "http_url": ("STRING", {"default": "http://127.0.0.1:8001/tts"}),
            "python_device": (["auto", "cpu"],),
            "keep_loaded": ("BOOLEAN", {"default": False}),
            "timeout_s": ("INT", {"default": 420, "min": 5, "max": 3600}),
        }}

    def run(self, scene, backend, voice: str, language, model, cli_template, http_url, python_device, keep_loaded, timeout_s):
        sc = scenes_mod.load_scenes(scene)[0]
        d = project_dir(sc["_project"], create=True) / "audio"
        wav = d / f"{sc['id']}_{voice_mod.cache_key(sc['narration'], voice + model, language)}.wav"
        voice_mod.synthesize_to_wav(wav, backend, sc["narration"], voice, language, http_url, cli_template, timeout_s,
                                    model, python_device, keep_loaded)
        samples, sr = media.read_wav(wav.read_bytes())
        dur = samples.shape[1] / sr
        return {"ui": {"text": [f"{sc['id']}: {dur:.1f}s de narração"]}, "result": (media.to_audio_dict(samples, sr), dur, str(wav))}


class OwnMovieAudioTiming:
    """Duração do áudio → segundos e frames do Wan (ligar em Seconds/FPS do subgraph t2v,i2v)."""
    CATEGORY, FUNCTION = C3, "run"
    RETURN_TYPES, RETURN_NAMES = ("INT", "INT"), ("seconds", "frames")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"duration_s": ("FLOAT", {"forceInput": True}),
                             "fps": ("INT", {"default": 16, "min": 1, "max": 60}),
                             "min_seconds": ("INT", {"default": 1, "min": 1, "max": 30}),
                             "max_seconds": ("INT", {"default": 5, "min": 1, "max": 30})}}

    def run(self, duration_s, fps, min_seconds, max_seconds):
        return media.compute_timing(duration_s, fps, min_seconds, max_seconds)


# ───────────────────────── 4 · VÍDEO ─────────────────────────
class OwnMovieLastFrameSave:
    """Salva o último frame da cena (base do encadeamento i2v). Substitui SelectEveryNth + Gate + SaveImage."""
    CATEGORY, FUNCTION, OUTPUT_NODE = C4, "run", True
    RETURN_TYPES, RETURN_NAMES = ("IMAGE",), ("last_frame",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"scene": ("OWN_SCENES",), "frames": ("IMAGE",)}}

    def run(self, scene, frames):
        from PIL import Image  # type: ignore
        sc = scenes_mod.load_scenes(scene)[0]
        arr = media.image_to_numpy(frames)[-1]
        p = project_dir(sc["_project"], create=True) / "frames" / f"{sc['id']}_last.png"
        Image.fromarray(arr).save(p)
        return {"ui": {"images": [view_ref(p)]}, "result": (media.numpy_to_image(arr),)}


class OwnMovieSceneMux:
    """Frames do Wan + áudio da cena → clips/cNNN.mp4 (H.264 + AAC). Mantém a fala inteira."""
    CATEGORY, FUNCTION, OUTPUT_NODE = C4, "run", True
    RETURN_TYPES, RETURN_NAMES = ("STRING",), ("clip_path",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"scene": ("OWN_SCENES",), "frames": ("IMAGE",), "audio": ("AUDIO",),
                             "fps": ("INT", {"default": 16, "min": 1, "max": 60}), "sync": (media.SYNC_MODES,)}}

    @classmethod
    def IS_CHANGED(cls, **_):
        return float("nan")  # sempre refaz o arquivo

    def run(self, scene, frames, audio, fps, sync):
        sc = scenes_mod.load_scenes(scene)[0]
        d = project_dir(sc["_project"], create=True)
        samples, sr = media.audio_to_numpy(audio)
        wav = d / "audio" / f"{sc['id']}_mux.wav"
        media.write_wav(wav, samples, sr)
        out = d / "clips" / f"{sc['id']}.mp4"
        media.mux_scene(media.image_to_numpy(frames), fps, wav, samples.shape[1] / sr, out, sync)
        wav.unlink(missing_ok=True)
        return {"ui": {"gifs": [{**view_ref(out), "format": "video/h264-mp4"}]}, "result": (str(out),)}


class OwnMovieFinalConcat:
    """Fase final: junta todos os clips das cenas, na ordem, em final.mp4. Falha listando cenas ausentes."""
    CATEGORY, FUNCTION, OUTPUT_NODE = C4, "run", True
    RETURN_TYPES, RETURN_NAMES = ("STRING",), ("final_path",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"project_name": ("STRING", {"default": "projeto_001"})}}

    @classmethod
    def IS_CHANGED(cls, **_):
        return float("nan")

    def run(self, project_name):
        d = project_dir(project_name)
        ids = [s["id"] for s in read_project(project_name)["scenes"]]
        clips = [d / "clips" / f"{i}.mp4" for i in ids]
        missing = [i for i, c in zip(ids, clips) if not c.exists()]
        if missing:
            raise RuntimeError(f"Faltam clips das cenas: {', '.join(missing)}. Renderize-as antes (workflow 02_CENA).")
        out = d / "final.mp4"
        media.concat_clips(clips, out)
        return {"ui": {"gifs": [{**view_ref(out), "format": "video/h264-mp4"}]}, "result": (str(out),)}


class OwnMovieExcerpt:
    """Compatível com o node que já existe no seu ComfyUI (categoria 'OWN MOVIE', entrada `value`, saída `excerpt`).
    Mantido para não quebrar workflows antigos; o 02_CENA novo não usa mais (a cena já carrega o trecho)."""
    CATEGORY, FUNCTION = "OWN MOVIE", "run"
    RETURN_TYPES, RETURN_NAMES = ("STRING",), ("excerpt",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"value": ("STRING", {"multiline": True})}}

    def run(self, value):
        return (value,)


NODE_CLASS_MAPPINGS = {c.__name__: c for c in (
    OwnMovieExcerpt,
    OwnMovieScriptSplitter, OwnMovieProjectSave, OwnMovieSceneLoad,
    OwnMovieRouterConfig, OwnMovieAgentPlanner, OwnMovieAgentEmotion,
    OwnMovieOmniVoice, OwnMovieAudioTiming,
    OwnMovieLastFrameSave, OwnMovieSceneMux, OwnMovieFinalConcat,
)}
NODE_DISPLAY_NAME_MAPPINGS = {
    "OwnMovieExcerpt": "Excerpt (OWN MOVIE)",
    "OwnMovieScriptSplitter": "OWN · Dividir roteiro em cenas",
    "OwnMovieProjectSave": "OWN · Salvar projeto",
    "OwnMovieSceneLoad": "OWN · Carregar cena",
    "OwnMovieRouterConfig": "OWN · OmniRoute (agentes)",
    "OwnMovieAgentPlanner": "OWN · Agente Planner",
    "OwnMovieAgentEmotion": "OWN · Agente Emoção",
    "OwnMovieOmniVoice": "OWN · OmniVoice (narração)",
    "OwnMovieAudioTiming": "OWN · Áudio → segundos/frames",
    "OwnMovieLastFrameSave": "OWN · Salvar último frame",
    "OwnMovieSceneMux": "OWN · Montar clipe da cena (vídeo+áudio)",
    "OwnMovieFinalConcat": "OWN · Montar filme final",
}
