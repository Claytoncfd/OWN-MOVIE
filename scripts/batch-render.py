#!/usr/bin/env python3
"""OWN MOVIE — render em lote de projetos grandes (ex.: 334 cenas), sem parar.

Distribuição real por estágio (não dá para fatiar 1 step de difusão entre GPU/CPU):
  CPU  : planejamento Hermes/OmniRoute, mux/concat FFmpeg, I/O e monitoramento
  GPU  : fase 1 = TTS de todas as cenas (modelo carregado 1x) · fase 2 = vídeos 1 a 1
  SSD  : modelos via mmap, output/, last frames encadeados

Uso:
  python3 scripts/batch-render.py --project NOME            # dry-run (padrão): estima tudo, não renderiza
  python3 scripts/batch-render.py --project NOME --go       # executa de verdade (pode levar dias: ~2.2min por segundo de vídeo)
  python3 scripts/batch-render.py --project NOME --go --ep 20  # episódios de 20 cenas
Retoma sozinho de onde parou (pula cena com MP4 pronto). Log: logs/batch-NOME.log
"""
import http.client
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMFY, BRIDGE, ROUTER = "http://127.0.0.1:8188", "http://127.0.0.1:8000", "http://127.0.0.1:20128/v1"
MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
STYLE = "Vox explainer style, flat editorial collage, paper texture, bold graphic shapes, archival cutouts, clean motion,"
NEG = "blurry, low quality, distorted, watermark, text artifacts, deformed"
W, H, FPS, STEPS, CFG, MAXS = 512, 512, 16, 4, 1.5, 5
MIN_PER_SEC = 2.2  # medido: 4s->546s, 5s->515s
VENV_PY = "/home/cfd/.venvs/omnivoice/bin/python"


def log(fh, m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    fh.write(line + "\n")
    fh.flush()


def api_key():
    if os.environ.get("OMNIROUTE_API_KEY"):
        return os.environ["OMNIROUTE_API_KEY"]
    for line in (Path.home() / ".hermes" / "config.yaml").read_text().splitlines():
        if "api_key" in line and "sk-" in line:
            return "sk-" + line.split("sk-")[1].split()[0].strip("\"'")
    raise RuntimeError("sem chave OMNIROUTE (~/.hermes/config.yaml ou env)")


def post(url, payload, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def plan_hermes(chunks, key, fh):
    out = []
    for g in range(0, len(chunks), 25):
        grp = chunks[g:g + 25]
        body = {"model": MODEL, "messages": [
            {"role": "system", "content": "Você é o Hermes Planner do OWN MOVIE. Para cada narração recebida, escreva um prompt visual curto em inglês (máx 40 palavras) para o Wan 2.2 text-to-video, no estilo de explicador Vox (colagem editorial, recortes, formas gráficas, movimento de câmera suave). Responda APENAS um JSON array de strings, na mesma ordem."},
            {"role": "user", "content": json.dumps(grp)}]}
        st, raw = post(f"{ROUTER}/chat/completions", body, {"Authorization": f"Bearer {key}"}, timeout=300)
        txt = json.loads(raw)["choices"][0]["message"]["content"]
        arr = json.loads(txt[txt.index("["):txt.rindex("]") + 1])
        out += arr
        log(fh, f"Hermes: grupo {g//25+1} ({len(arr)} prompts)")
    return out


def gpu_mem():
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=15)
        return r.stdout.strip().replace("\n", " ")
    except Exception:
        return "?"


def main():
    ap = __import__("argparse").ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--go", action="store_true")
    ap.add_argument("--ep", type=int, default=10)
    a = ap.parse_args()
    name = a.project
    pdir = ROOT / "projects" / name
    doc = json.loads((pdir / "project.json").read_text())
    text = doc.get("text", "")
    scenes = doc.get("scenes") or []
    logf = open(ROOT / "logs" / f"batch-{name}.log", "a")
    statef = pdir / "batch-state.json"
    state = json.loads(statef.read_text()) if statef.exists() else {}

    chunks = [s["narration"] for s in scenes if s.get("narration")] or \
             [b.strip() for b in text.replace("---", "\n\n").split("\n\n") if b.strip()]
    if not chunks:
        log(logf, "projeto sem texto/cenas. Salve no servidor primeiro.")
        return
    if len(scenes) != len(chunks) or not all(s.get("prompt") for s in scenes):
        log(logf, f"planejando {len(chunks)} prompts via Hermes/OmniRoute (CPU)...")
        prompts = plan_hermes(chunks, api_key(), logf) if a.go else [""] * len(chunks)
        scenes = [{"narration": c, "prompt": p} for c, p in zip(chunks, prompts)]
        doc["scenes"] = scenes
        (pdir / "project.json").write_text(json.dumps(doc))

    adir, vdir, rdir = (ROOT / "output" / d / name for d in ("audio", "videos", "renders"))
    for d in (adir, vdir, rdir):
        d.mkdir(parents=True, exist_ok=True)
    (pdir / "scenes.tsv").write_text("".join(f"c{i+1:04d}\t{s['narration']}\n" for i, s in enumerate(scenes)), encoding="utf-8")

    # estima durações (rápido: usa durations.tsv se existir, senão estima 150 chars/s)
    durs = {}
    if (adir / "durations.tsv").exists():
        for line in (adir / "durations.tsv").read_text(encoding="utf-8").splitlines():
            if "\t" in line:
                k, v = line.split("\t")
                durs[k] = float(v)
    secs = [max(1, min(MAXS, math.ceil(durs.get(f"c{i+1:04d}", len(s["narration"]) / 15)))) for i, s in enumerate(scenes)]
    tot_v = sum(secs)
    log(logf, f"{len(scenes)} cenas · vídeo total ~{tot_v}s · ETA GPU ~{tot_v * MIN_PER_SEC / 60:.0f}min · VRAM agora: {gpu_mem()} MB")
    if not a.go:
        log(logf, "DRY-RUN: nada renderizado. Rode com --go para executar.")
        return

    # fase 1 (GPU): TTS em lote, modelo 1x
    log(logf, "fase 1/3: TTS em lote (GPU, modelo 1x)...")
    subprocess.run([VENV_PY, "scripts/batch-tts.py", "--list", str(pdir / "scenes.tsv"),
                    "--outdir", str(adir), "--lang", "pt"], check=True, cwd=ROOT)
    for line in (adir / "durations.tsv").read_text(encoding="utf-8").splitlines():
        if "\t" in line:
            k, v = line.split("\t")
            durs[k] = float(v)
    secs = [max(1, min(MAXS, math.ceil(durs[f"c{i+1:04d}"]))) for i in range(len(scenes))]

    # fase 2 (GPU): vídeos 1 a 1 com encadeamento
    base = json.loads((ROOT / "workflows" / "WAN2.2.api.json").read_text())
    import random
    prev = state.get("last_frame")
    start = state.get("done", 0)
    log(logf, f"fase 2/3: vídeos de {start+1} até {len(scenes)} (retomando)...")
    for i in range(start, len(scenes)):
        mp4 = vdir / f"c{i+1:04d}.mp4"
        if mp4.exists() and mp4.stat().st_size > 0 and (rdir / f"c{i+1:04d}_vox.mp4").exists():
            log(logf, f"cena {i+1}: já pronta, pulando")
            prev = state.get(f"lf{i+1}", prev)
            continue
        wf = json.loads(json.dumps(base))
        img = None
        if i > 0 and prev:
            q = f"filename={prev['filename']}&subfolder={prev.get('subfolder','')}&type={prev.get('type','output')}"
            with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as r:
                blob = r.read()
            conn = http.client.HTTPConnection("127.0.0.1", 8188, timeout=120)
            b = (f"--B\r\nContent-Disposition: form-data; name=\"image\"; filename=\"chain{i}.png\"\r\n"
                 f"Content-Type: image/png\r\n\r\n").encode() + blob + b"\r\n--B--\r\n"
            conn.request("POST", "/upload/image", b, {"Content-Type": "multipart/form-data; boundary=B"})
            up = json.loads(conn.getresponse().read())
            img = (up.get("subfolder") + "/" if up.get("subfolder") else "") + up["name"]
        wf["12"]["inputs"]["text"] = f"{STYLE} {scenes[i]['prompt']}".strip()
        wf["127"]["inputs"]["text"] = NEG
        if "200" in wf:
            wf["200"]["inputs"]["value"] = scenes[i]["narration"]
        wf["7"]["inputs"].update({"seed": random.randint(0, 10**15), "steps": STEPS, "cfg": CFG})
        wf["74:64"]["inputs"]["value"] = W
        wf["74:65"]["inputs"]["value"] = H
        wf["74:66"]["inputs"]["value"] = FPS
        wf["74:85"]["inputs"]["value"] = secs[i]
        wf["115"]["inputs"].update({"frame_rate": FPS, "filename_prefix": f"OwnMovie/{name}_c{i+1:04d}"})
        wf["104"]["inputs"]["value"] = f"OwnMovie/{name}_c{i+1:04d}"
        if img:
            wf["59:44"]["inputs"]["value"] = 2
            wf["23"]["inputs"]["image"] = img
        req = urllib.request.Request(f"{COMFY}/prompt", data=json.dumps({"prompt": wf, "client_id": "ownmovie-batch"}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            pid = json.loads(r.read())["prompt_id"]
        t0 = time.time()
        while True:
            time.sleep(10)
            with urllib.request.urlopen(f"{COMFY}/history/{pid}", timeout=60) as r:
                h = json.loads(r.read()).get(pid, {})
            if h.get("status", {}).get("status_str") == "error":
                raise RuntimeError(f"cena {i+1}: ComfyUI erro")
            if h.get("outputs"):
                video = None
                for nid, o in h["outputs"].items():
                    vids = o.get("gifs") or o.get("videos")
                    if vids and not video:
                        v = vids[0]
                        q = f"filename={v['filename']}&subfolder={v.get('subfolder','')}&type={v.get('type','output')}"
                        with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=300) as r:
                            video = r.read()
                    if str(nid).endswith("82") and o.get("images"):
                        prev = o["images"][0]
                        state[f"lf{i+1}"] = prev
                        state["last_frame"] = prev
                if video:
                    mp4.write_bytes(video)
                    break
        # fase 3 (CPU): mux imediato
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(mp4), "-i", str(adir / f"c{i+1:04d}.wav"),
                        "-c:v", "copy", "-c:a", "aac", "-shortest", str(rdir / f"c{i+1:04d}_vox.mp4")], check=True)
        state["done"] = i + 1
        statef.write_text(json.dumps(state))
        log(logf, f"cena {i+1}/{len(scenes)} OK em {(time.time()-t0)/60:.1f}min · VRAM: {gpu_mem()} MB")

    # episódios (CPU): concatena de --ep em --ep cenas
    log(logf, "fase 3/3: episódios (CPU)...")
    for e in range(0, len(scenes), a.ep):
        ep = rdir / f"{name}_ep{e//a.ep+1:03d}.mp4"
        lst = rdir / "concat.txt"
        lst.write_text("".join(f"file '{rdir / f'c{i+1:04d}_vox.mp4'}'\n" for i in range(e, min(e + a.ep, len(scenes)))))
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-c", "copy", str(ep)], check=True)
        log(logf, f"episódio {e//a.ep+1}: {ep.name} ({ep.stat().st_size//1024//1024}MB)")
    log(logf, "LOTE COMPLETO")


if __name__ == "__main__":
    main()
