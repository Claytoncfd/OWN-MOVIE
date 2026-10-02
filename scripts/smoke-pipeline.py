#!/usr/bin/env python3
"""OWN MOVIE — smoke test real do pipeline ponta a ponta.

Texto (2 cenas) → Hermes/OmniRoute (plano) → OmniVoice via bridge (áudio) →
ComfyUI WAN2.2 (cena 1 t2v, cena 2 i2v encadeada) → ffmpeg mux → output/.

A chave do OmniRoute é lida em runtime de ~/.hermes/config.yaml (fora do
repositório) ou da env OMNIROUTE_API_KEY — nunca commitada.
Uso: python3 scripts/smoke-pipeline.py [--text "frase1 --- frase2"]
Log: logs/smoke-pipeline.log
"""
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_V, OUT_A, OUT_R = (ROOT / "output" / d for d in ("videos", "audio", "renders"))
LOG = ROOT / "logs" / "smoke-pipeline.log"
COMFY, BRIDGE, ROUTER = "http://127.0.0.1:8188", "http://127.0.0.1:8000", "http://127.0.0.1:20128/v1"
MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
STYLE = "Vox explainer style, flat editorial collage, paper texture, bold graphic shapes, archival cutouts, clean motion,"
NEG = "blurry, low quality, distorted, watermark, text artifacts, deformed"
W, H, FPS, STEPS, CFG = 512, 512, 16, 4, 1.5


def log(m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def api_key():
    if os.environ.get("OMNIROUTE_API_KEY"):
        return os.environ["OMNIROUTE_API_KEY"]
    cfg = Path.home() / ".hermes" / "config.yaml"
    for line in cfg.read_text().splitlines():
        if "api_key" in line and "sk-" in line:
            return "sk-" + line.split("sk-")[1].split()[0].strip("\"'")
    raise RuntimeError("sem chave: exporte OMNIROUTE_API_KEY")


def post(url, payload, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def plan(text, key):
    chunks = [c.strip() for c in text.split("---") if c.strip()]
    body = {"model": MODEL, "messages": [
        {"role": "system", "content": "Você é o Hermes Planner do OWN MOVIE. Para cada narração recebida, escreva um prompt visual curto em inglês (máx 40 palavras) para o Wan 2.2 text-to-video, no estilo de explicador Vox (colagem editorial, recortes, formas gráficas, movimento de câmera suave). Responda APENAS um JSON array de strings, na mesma ordem."},
        {"role": "user", "content": json.dumps(chunks)}]}
    st, raw = post(f"{ROUTER}/chat/completions", body, {"Authorization": f"Bearer {key}"})
    txt = json.loads(raw)["choices"][0]["message"]["content"]
    prompts = json.loads(txt[txt.index("["):txt.rindex("]") + 1])
    return list(zip(chunks, prompts))


def tts(text, wav):
    st, raw = post(f"{BRIDGE}/api/tts", {"text": text, "language": "pt"}, timeout=600)
    if st != 200:
        raise RuntimeError(f"TTS {st}: {raw[:200]}")
    wav.write_bytes(raw)
    info = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                           "-of", "csv=p=0", str(wav)], capture_output=True, text=True)
    return float(info.stdout.strip() or 3.0)


def comfy(wf, prefix):
    req = urllib.request.Request(f"{COMFY}/prompt", data=json.dumps({"prompt": wf, "client_id": "ownmovie-smoke"}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        pid = json.loads(r.read())["prompt_id"]
    log(f"ComfyUI fila: {pid[:8]} ({prefix})")
    t0 = time.time()
    while True:
        time.sleep(5)
        with urllib.request.urlopen(f"{COMFY}/history/{pid}", timeout=30) as r:
            h = json.loads(r.read()).get(pid, {})
        if h.get("status", {}).get("status_str") == "error":
            raise RuntimeError("ComfyUI erro na execução")
        if h.get("outputs"):
            for nid, o in h["outputs"].items():
                vids = o.get("gifs") or o.get("videos")
                if vids:
                    v = vids[0]
                    q = f"filename={v['filename']}&subfolder={v.get('subfolder','')}&type={v.get('type','output')}"
                    with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as r:
                        mp4 = r.read()
                    last = None
                    if str(nid).endswith("82") and o.get("images"):
                        last = o["images"][0]
                    return mp4, last, int(time.time() - t0)


def view_blob(f):
    q = f"filename={f['filename']}&subfolder={f.get('subfolder','')}&type={f.get('type','output')}"
    with urllib.request.urlopen(f"{COMFY}/view?{q}", timeout=120) as r:
        return r.read()


def main():
    text = sys.argv[sys.argv.index("--text") + 1] if "--text" in sys.argv else (
        "Em 1969, o homem pisou na Lua pela primeira vez. --- "
        "Mas a corrida espacial começou muito antes, com foguetes, satélites e sonhos.")
    for d in (OUT_V, OUT_A, OUT_R):
        d.mkdir(parents=True, exist_ok=True)
    LOG.write_text("")
    key = api_key()
    scenes = plan(text, key)
    log(f"Hermes planejou {len(scenes)} cenas")
    base = json.loads((ROOT / "workflows" / "WAN2.2.api.json").read_text())
    prev_frame = None
    import random
    for i, (narr, prompt) in enumerate(scenes):
        wav = OUT_A / f"cena{i+1}.wav"
        dur = tts(narr, wav)
        secs = max(1, min(5, math.ceil(dur)))
        log(f"cena {i+1}: áudio {dur:.1f}s -> vídeo {secs}s")
        wf = json.loads(json.dumps(base))
        img = None
        if i > 0 and prev_frame:
            blob = view_blob(prev_frame)
            import http.client
            conn = http.client.HTTPConnection("127.0.0.1", 8188, timeout=120)
            b = (f"--B\r\nContent-Disposition: form-data; name=\"image\"; filename=\"chain{i}.png\"\r\n"
                 f"Content-Type: image/png\r\n\r\n").encode() + blob + b"\r\n--B--\r\n"
            conn.request("POST", "/upload/image", b, {"Content-Type": "multipart/form-data; boundary=B"})
            up = json.loads(conn.getresponse().read())
            img = (up.get("subfolder") + "/" if up.get("subfolder") else "") + up["name"]
            log(f"cena {i+1}: last frame reenviado ({img})")
        wf["12"]["inputs"]["text"] = f"{STYLE} {prompt}".strip()
        wf["127"]["inputs"]["text"] = NEG
        wf["7"]["inputs"].update({"seed": random.randint(0, 10**15), "steps": STEPS, "cfg": CFG})
        wf["74:64"]["inputs"]["value"] = W
        wf["74:65"]["inputs"]["value"] = H
        wf["74:66"]["inputs"]["value"] = FPS
        wf["74:85"]["inputs"]["value"] = secs
        wf["115"]["inputs"].update({"frame_rate": FPS, "filename_prefix": f"OwnMovie/smoke_c{i+1}"})
        wf["104"]["inputs"]["value"] = f"OwnMovie/smoke_c{i+1}"
        if img:
            wf["59:44"]["inputs"]["value"] = 2
            wf["23"]["inputs"]["image"] = img
        mp4, last, took = comfy(wf, f"cena{i+1}")
        (OUT_V / f"cena{i+1}.mp4").write_bytes(mp4)
        prev_frame = last
        log(f"cena {i+1}: MP4 {len(mp4)//1024}KB em {took}s")
        mux = OUT_R / f"cena{i+1}_vox.mp4"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(OUT_V / f"cena{i+1}.mp4"),
                        "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-shortest", str(mux)], check=True)
        log(f"cena {i+1}: mux OK -> {mux.name}")
    log("SMOKE COMPLETO — player: output/renders/")


if __name__ == "__main__":
    main()
