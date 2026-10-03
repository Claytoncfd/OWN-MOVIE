#!/usr/bin/env python3
"""OWN MOVIE — executa um projeto inteiro SEM navegador (lotes grandes, dias de render). Substitui batch-render.py.

Usa os mesmos workflows e nodes da página Projetos; o ComfyUI faz tudo, este script só enfileira e espera.
Retoma sozinho: lê output/OWN_MOVIE/projects/<nome>/ pelas rotas do ComfyUI e pula o que já existe.

  python3 scripts/run-project.py NOME --text roteiro.txt            # plano + voz + vídeo + filme final
  python3 scripts/run-project.py NOME                                # projeto já planejado: só renderiza o que falta
  python3 scripts/run-project.py NOME --only plan|voice|video|final  # uma fase
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WF = ROOT / "workflows"


def load(name):
    return json.loads((WF / f"{name}.api.json").read_text())


def call(base, path, body=None, timeout=120):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise SystemExit(f"HTTP {e.code} em {path}: {detail}")
    except urllib.error.URLError as e:
        raise SystemExit(f"ComfyUI inacessível em {base}: {e.reason}")


def run(base, wf, label, poll=3, timeout=90 * 60):
    pid = call(base, "/prompt", {"prompt": wf, "client_id": "ownmovie-cli"})["prompt_id"]
    t0 = time.time()
    print(f"[{time.strftime('%H:%M:%S')}] {label} …", flush=True)
    while time.time() - t0 < timeout:
        h = call(base, f"/history/{pid}").get(pid, {})
        st = h.get("status", {})
        if st.get("status_str") == "error":
            m = next((x[1] for x in st.get("messages", []) if x[0] == "execution_error"), {})
            raise SystemExit(f"{label}: {m.get('node_type')}: {str(m.get('exception_message', 'erro'))[:300]}")
        if st.get("status_str") == "success":
            print(f"[{time.strftime('%H:%M:%S')}] {label} OK em {time.time() - t0:.0f}s", flush=True)
            return
        time.sleep(poll)
    raise SystemExit(f"{label}: tempo esgotado")


def status(base, project):
    try:
        return call(base, f"/own_movie/project/{project}")
    except SystemExit:
        return {"scenes": [], "final": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--text", help="arquivo .txt do roteiro (gera o plano)")
    ap.add_argument("--mode", default="fragmentos", choices=["fragmentos", "unico"])
    ap.add_argument("--comfy", default="http://127.0.0.1:8188")
    ap.add_argument("--only", choices=["plan", "voice", "video", "final"])
    ap.add_argument("--max-seconds", type=int, default=5)
    ap.add_argument("--chain", action="store_true", help="encadear último frame (i2v)")
    ap.add_argument("--poll", type=float, default=3)
    a = ap.parse_args()
    base, proj = a.comfy.rstrip("/"), a.project
    want = lambda ph: a.only in (None, ph)

    if want("plan") and a.text:
        wf = load("01_PLANO")
        wf["1"]["inputs"].update(text=Path(a.text).read_text(encoding="utf-8"), mode=a.mode)
        wf["5"]["inputs"]["project_name"] = proj
        run(base, wf, "plano", a.poll)
    scenes = status(base, proj)["scenes"]
    if not scenes and a.only != "plan":
        sys.exit("Projeto sem cenas: passe --text roteiro.txt para gerar o plano.")
    print(f"{len(scenes)} cenas · {sum(1 for s in scenes if s['has_clip'])} já com clipe")

    if want("voice"):
        for s in (s for s in scenes if not s["has_audio"] and not s["has_clip"]):
            wf = load("02_VOZ")
            wf["1"]["inputs"].update(project_name=proj, scene_index=s["index"])
            run(base, wf, f"cena {s['index'] + 1}/{len(scenes)} voz", a.poll)
    if want("video"):
        for s in (s for s in scenes if not s["has_clip"]):
            wf = load("02_CENA")
            wf["300"]["inputs"].update(project_name=proj, scene_index=s["index"], chain_last_frame=a.chain)
            wf["302"]["inputs"]["max_seconds"] = a.max_seconds
            run(base, wf, f"cena {s['index'] + 1}/{len(scenes)} vídeo", a.poll)
    if want("final"):
        wf = load("03_FINAL")
        wf["1"]["inputs"]["project_name"] = proj
        run(base, wf, "filme final", a.poll)
        print("final:", status(base, proj)["final"])


if __name__ == "__main__":
    main()
