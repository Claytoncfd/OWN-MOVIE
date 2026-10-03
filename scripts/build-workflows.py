#!/usr/bin/env python3
"""OWN MOVIE — gera os 4 workflows (formato API) dos nodes OWN_MOVIE.

  01_PLANO  : roteiro → cenas → Planner → Emoção → scenes.json      (só nodes OWN_MOVIE)
  02_VOZ    : carrega a cena → OmniVoice (cache em disco)           (fase de áudio, antes da GPU de vídeo)
  02_CENA   : derivado de workflows/WAN2.2.api.json (Wan 2.2) com os nodes OWN_MOVIE ligados
  03_FINAL  : junta os clipes em final.mp4

Uso: python3 scripts/build-workflows.py     (não precisa do ComfyUI no ar)
"""
import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / "workflows"
BASE = json.loads((WF / "WAN2.2.api.json").read_text())

MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"   # o mesmo de config/localhost.json
STYLE = "Vox explainer style, flat editorial collage, paper texture, bold graphic shapes, archival cutouts, clean motion,"
NEG = "blurry, low quality, distorted, watermark, text artifacts, deformed"
PROJECT = "projeto_001"


def node(cls, title, **inputs):
    return {"class_type": cls, "inputs": inputs, "_meta": {"title": title}}


def scene_load(**over):
    base = dict(project_name=PROJECT, scene_index=0, style_prefix=STYLE, negative_default=NEG, seed_base=1, chain_last_frame=False)
    return node("OwnMovieSceneLoad", "OWN · Carregar cena", **{**base, **over})


def omnivoice(scene_ref):
    return node("OwnMovieOmniVoice", "OWN · OmniVoice", scene=scene_ref, backend="cli", voice="default", language="pt",
                model="k2-fsa/OmniVoice", cli_template="omnivoice-infer --model {model} --text {text} --output {out} --language {lang} {ref_args}",
                http_url="http://127.0.0.1:8001/tts", python_device="auto", keep_loaded=False, timeout_s=420)


# ---------------- 01_PLANO ----------------
plano = {
    "1": node("OwnMovieScriptSplitter", "Roteiro → cenas", text="Em 1969, o homem pisou na Lua.\n\nMas a corrida espacial começou muito antes.", mode="fragmentos", max_chars=180),
    "2": node("OwnMovieRouterConfig", "OmniRoute", base_url="http://127.0.0.1:20128/v1", planner_model=MODEL, emotion_model=MODEL, timeout_s=300, temperature=0.4),
    "3": node("OwnMovieAgentPlanner", "Agente Planner", router=["2", 0], scenes=["1", 0], overwrite=False, style_hint=""),
    "4": node("OwnMovieAgentEmotion", "Agente Emoção", router=["2", 0], scenes=["3", 0], allowed_tags="[laughter], [sigh]", min_similarity=0.85, on_fail="keep_original"),
    "5": node("OwnMovieProjectSave", "Salvar projeto", project_name=PROJECT, scenes=["4", 0]),
}

# ---------------- 02_VOZ ----------------
voz = {"1": scene_load(), "2": omnivoice(["1", 0])}

# ---------------- 03_FINAL ----------------
final = {"1": node("OwnMovieFinalConcat", "Filme final", project_name=PROJECT)}

# ---------------- 02_CENA (derivado do Wan) ----------------
# 201/202 = Emotion/TTS antigos (substituídos pela cadeia 300 SceneLoad + 301 OmniVoice)
REMOVE = ["115", "83", "82", "138:128", "139", "200", "201", "202", "104", "23"]
# 115 VHS_VideoCombine (substituído pelo SceneMux, que já leva o áudio) · 83/82/138:128 last frame antigo (→ LastFrameSave)
# 139 PreviewImage · 200 OwnMovieExcerpt (a cena já carrega o trecho) · 104 prefixo · 23 LoadImage (→ SceneLoad.prev_last_frame)
cena = copy.deepcopy(BASE)
for k in REMOVE:
    del cena[k]

cena["300"] = scene_load()
cena["301"] = omnivoice(["300", 0])
cena["302"] = node("OwnMovieAudioTiming", "OWN · Áudio → segundos", duration_s=["301", 1], fps=["74:66", 0], min_seconds=1, max_seconds=5)
cena["303"] = node("OwnMovieLastFrameSave", "OWN · Último frame", scene=["300", 0], frames=["7", 5])
cena["304"] = node("OwnMovieSceneMux", "OWN · Clipe da cena (vídeo+áudio)", scene=["300", 0], frames=["7", 5], audio=["301", 0], fps=["74:66", 0], sync="hold_last_frame")

cena["12"]["inputs"]["text"] = ["300", 1]        # prompt positivo
cena["127"]["inputs"]["text"] = ["300", 2]       # prompt negativo
cena["7"]["inputs"]["seed"] = ["300", 3]         # seed por cena
cena["59:44"]["inputs"]["value"] = ["300", 4]    # 1 = t2v · 2 = i2v (último frame da cena anterior)
cena["85"]["inputs"]["image"] = ["300", 5]       # imagem de entrada do i2v
cena["74:85"]["inputs"]["value"] = ["302", 0]    # segundos de vídeo = duração do áudio
# ATENÇÃO (inferido, ainda não testado em GPU): no export API original, 74:70.image e 74:72.start_image ficam sem fio.
# No canvas quem os alimenta é o "Anything Everywhere" 75 (85 → entradas IMAGE soltas), que o export não resolve.
# Ligamos explicitamente; no modo t2v o ramo i2v é descartado pelo ImpactSwitch (lazy).
cena["74:70"]["inputs"]["image"] = ["85", 0]         # CLIPVisionEncode.image (obrigatório)
cena["74:72"]["inputs"]["start_image"] = ["85", 0]   # WanImageToVideo.start_image

dangling = [(k, a, v[0]) for k, n in cena.items() for a, v in n["inputs"].items() if isinstance(v, list) and v[0] in REMOVE]
assert not dangling, f"referências a nós removidos: {dangling}"

out = {"01_PLANO.api.json": plano, "02_VOZ.api.json": voz, "02_CENA.api.json": cena, "03_FINAL.api.json": final}
FRONT = ROOT / "src/data/workflows"   # cópia que o front importa (mesmo conteúdo)
FRONT.mkdir(parents=True, exist_ok=True)
for name, g in out.items():
    txt = json.dumps(g, ensure_ascii=False, indent=1)
    (WF / name).write_text(txt, encoding="utf-8")
    (FRONT / name).write_text(txt, encoding="utf-8")
    print(f"{name}: {len(g)} nós")
