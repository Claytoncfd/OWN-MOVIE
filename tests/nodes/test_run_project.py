"""run-project.py contra um ComfyUI falso: ordem das fases, retomada e erro de node."""
import json, subprocess, sys, threading, pathlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "run-project.py"


class Fake(BaseHTTPRequestHandler):
    log, scenes, fail = [], [], False
    def log_message(self, *a): pass
    def send(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        wf = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["prompt"]
        kinds = {"OwnMovieScriptSplitter": "plano", "OwnMovieOmniVoice": "voz", "OwnMovieSceneMux": "video", "OwnMovieFinalConcat": "final"}
        kind = next(v for n in wf.values() for k, v in kinds.items() if n["class_type"] == k)
        # 02_CENA contém OmniVoice e Mux: Mux vence
        if any(n["class_type"] == "OwnMovieSceneMux" for n in wf.values()): kind = "video"
        idx = next((n["inputs"]["scene_index"] for n in wf.values() if n["class_type"] == "OwnMovieSceneLoad"), None)
        Fake.log.append((kind, idx))
        if kind == "plano":
            Fake.scenes = [dict(index=i, id=f"c{i+1:03d}", has_audio=False, has_clip=False) for i in range(2)]
        if kind == "voz": Fake.scenes[idx]["has_audio"] = True
        if kind == "video": Fake.scenes[idx]["has_clip"] = True
        self.send({"prompt_id": f"p{len(Fake.log)}"})
    def do_GET(self):
        if self.path.startswith("/history/"):
            pid = self.path.split("/")[-1]
            st = {"status_str": "error", "messages": [["execution_error", {"node_type": "OwnMovieOmniVoice", "exception_message": "sem binário"}]]} if Fake.fail else {"status_str": "success"}
            return self.send({pid: {"status": st}})
        if self.path.startswith("/own_movie/project/"):
            return self.send({"scenes": Fake.scenes, "final": None})
        self.send({}, 404)


@pytest.fixture
def comfy():
    Fake.log, Fake.scenes, Fake.fail = [], [], False
    srv = HTTPServer(("127.0.0.1", 0), Fake); threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def run(comfy, *args):
    return subprocess.run([sys.executable, str(SCRIPT), "proj", "--comfy", comfy, "--poll", "0.05", *args], capture_output=True, text=True, timeout=60)


def test_fluxo_completo_e_retomada(comfy, tmp_path):
    txt = tmp_path / "r.txt"; txt.write_text("Um.\n\nDois.")
    r = run(comfy, "--text", str(txt))
    assert r.returncode == 0, r.stderr + r.stdout
    assert Fake.log == [("plano", None), ("voz", 0), ("voz", 1), ("video", 0), ("video", 1), ("final", None)]  # voz de todas antes do vídeo
    Fake.log.clear(); Fake.scenes[0]["has_clip"] = True; Fake.scenes[1]["has_clip"] = False
    r = run(comfy)                                                       # retoma: só a cena 2
    assert [k for k, _ in Fake.log] == ["video", "final"] and Fake.log[0][1] == 1

def test_erro_de_node_aparece(comfy, tmp_path):
    Fake.scenes = [dict(index=0, id="c001", has_audio=False, has_clip=False)]; Fake.fail = True
    r = run(comfy, "--only", "voice")
    assert r.returncode != 0 and "sem binário" in (r.stderr + r.stdout)

def test_sem_cenas_pede_texto(comfy):
    r = run(comfy)
    assert r.returncode != 0 and "--text" in (r.stderr + r.stdout)
