import json, subprocess, threading, sys, shlex, wave
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np
import pytest

import OWN_MOVIE as pkg
from OWN_MOVIE import common, media, router, scenes, voice
from OWN_MOVIE.nodes import NODE_CLASS_MAPPINGS as N


def sine(sec=1.0, sr=16000):
    t = np.arange(int(sec * sr)) / sr
    return (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)[None, :], sr


def wav_bytes(sec=1.0):
    import io
    a, sr = sine(sec)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((a[0] * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


def probe(path, entry="format=duration", stream=None):
    args = ["ffprobe", "-v", "error", "-show_entries", entry, "-of", "csv=p=0"]
    if stream: args += ["-select_streams", stream]
    return subprocess.run(args + [str(path)], capture_output=True, text=True).stdout.strip()


# ---------- divisão ----------
def test_split_fragmentos():
    assert scenes.split_text("A  b\nc\n\nD e\n---\nF", "fragmentos") == ["A b c", "D e", "F"]

def test_split_unico_agrupa_ate_max():
    txt = "Frase um é curta. " * 20
    out = scenes.split_text(txt, "unico", 60)
    assert len(out) > 1 and all(len(o) <= 80 for o in out)

def test_split_vazio():
    assert scenes.split_text("   ", "unico") == []

def test_slug_bloqueia_traversal():
    assert common.slug("../../etc") == "etc"
    with pytest.raises(ValueError):
        common.slug("../..")


# ---------- agentes ----------
def test_extract_json_ignora_think_e_colchetes():
    t = '<think>talvez [1,2] e {"x":1}</think> ok ```json\n{"prompt": "a cat"}\n```'
    assert router.extract_json(t, "prompt")["prompt"] == "a cat"

def test_extract_json_falha_clara():
    with pytest.raises(ValueError):
        router.extract_json("sem json aqui", "prompt")

def test_same_words_ignora_marcadores():
    assert router.same_words("Ela riu muito", "Ela... [laughter] riu, muito!") == 1.0
    assert router.same_words("Ela riu muito", "Ele chorou pouco") < 0.5


class FakeRouter(BaseHTTPRequestHandler):
    mode = "ok"
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        system, user = body["messages"][0]["content"], body["messages"][1]["content"]
        if "Planner" in system:
            content = '<think>[pensando]</think>{"prompt": "paper cutout moon, slow zoom"}'
        elif FakeRouter.mode == "ok":
            content = json.dumps({"narration": user.replace("pisou", "pisou...") + " [sigh]", "tone": "solene", "pace": "slow"})
        else:
            content = json.dumps({"narration": "Texto totalmente diferente agora", "tone": "x", "pace": "fast"})
        out = json.dumps({"choices": [{"message": {"content": content}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(out)


@pytest.fixture
def fake_server():
    srv = HTTPServer(("127.0.0.1", 0), FakeRouter)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def build_project(url, name="proj"):
    (rt,) = N["OwnMovieRouterConfig"]().run(url + "/v1", "m-plan", "m-emo", 10, 0.2)
    raw, n = N["OwnMovieScriptSplitter"]().run("O homem pisou na Lua.\n\nA corrida começou antes.", "fragmentos", 180)
    assert n == 2
    (raw,) = N["OwnMovieAgentPlanner"]().run(rt, raw, False, "")
    (raw,) = N["OwnMovieAgentEmotion"]().run(rt, raw, "[sigh]", 0.85, "error")
    N["OwnMovieProjectSave"]().run(name, raw)
    return raw


def test_plano_completo_e_projeto_em_disco(fake_server):
    FakeRouter.mode = "ok"
    raw = build_project(fake_server)
    sc = scenes.load_scenes(raw)
    assert sc[0]["prompt"] == "paper cutout moon, slow zoom"
    assert "..." in sc[0]["narration"] and sc[0]["text"] == "O homem pisou na Lua."
    st = common.project_status("proj")
    assert [s["id"] for s in st["scenes"]] == ["c001", "c002"] and st["final"] is None

def test_emocao_que_muda_sentido_e_barrada(fake_server):
    FakeRouter.mode = "bad"
    with pytest.raises(RuntimeError, match="alterou o sentido"):
        build_project(fake_server)

def test_emocao_keep_original(fake_server):
    FakeRouter.mode = "bad"
    (rt,) = N["OwnMovieRouterConfig"]().run(fake_server + "/v1", "a", "b", 10, 0.2)
    raw, _ = N["OwnMovieScriptSplitter"]().run("Um dois três quatro.", "unico", 180)
    (out,) = N["OwnMovieAgentEmotion"]().run(rt, raw, "", 0.85, "keep_original")
    sc = scenes.load_scenes(out)[0]
    assert sc["narration"] == "Um dois três quatro." and sc["warnings"]

def test_router_offline_da_erro_claro():
    (rt,) = N["OwnMovieRouterConfig"]().run("http://127.0.0.1:9/v1", "a", "b", 5, 0.2)
    with pytest.raises(RuntimeError, match="OmniRoute indisponível"):
        router.chat(rt, "planner", "s", "u")

def test_router_config_exige_modelos():
    with pytest.raises(ValueError):
        N["OwnMovieRouterConfig"]().run("http://x/v1", "", "", 5, 0.2)


# ---------- voz ----------
def fake_infer(out_dir):
    """Falso `omnivoice-infer`: grava 1,5 s de WAV em --output e registra os argumentos recebidos."""
    f = out_dir / "fake-omnivoice-infer"
    f.write_text("#!" + sys.executable + """
import sys, wave, json, pathlib
a = sys.argv[1:]
pathlib.Path(__file__).with_suffix('.args').write_text(json.dumps(a))
out = a[a.index('--output') + 1]
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(b'\\x00\\x01' * 24000); w.close()
""")
    f.chmod(0o755)
    return f


def run_voice(sc_raw, **kw):
    a = dict(backend="cli", voice="default", language="pt", model="k2-fsa/OmniVoice", cli_template=voice.DEFAULT_CLI,
             http_url="", python_device="auto", keep_loaded=False, timeout_s=30)
    a.update(kw)
    return N["OwnMovieOmniVoice"]().run(sc_raw, **a)["result"]


def test_voz_cli_flags_reais_e_cache(out_dir, fake_server, monkeypatch):
    FakeRouter.mode = "ok"
    build_project(fake_server)
    (sc_raw, pos, neg, seed, mode, img) = N["OwnMovieSceneLoad"]().run("proj", 0, "VOX,", "bad", 7, False)
    assert pos.startswith("VOX, paper cutout") and seed == 7 and mode == 1
    fake = fake_infer(out_dir)
    monkeypatch.setenv("OMNIVOICE_BIN", str(fake))
    audio, dur, wavp = run_voice(sc_raw)
    assert abs(dur - 1.5) < 0.01
    args = json.loads(fake.with_suffix(".args").read_text())
    # mesmos flags que api/bridge.mjs usa com o omnivoice-infer real
    assert args[:2] == ["--model", "k2-fsa/OmniVoice"] and "--text" in args and args[args.index("--language") + 1] == "pt"
    assert "--ref_audio" not in args
    monkeypatch.setenv("OMNIVOICE_BIN", "/nao/existe")
    run_voice(sc_raw)  # cache em disco: não chama o CLI de novo


def test_voz_cli_clonagem_com_ref_audio(out_dir, fake_server, monkeypatch):
    FakeRouter.mode = "ok"
    build_project(fake_server)
    sc_raw = N["OwnMovieSceneLoad"]().run("proj", 1, "s", "n", 1, False)[0]
    fake = fake_infer(out_dir)
    monkeypatch.setenv("OMNIVOICE_BIN", str(fake))
    ref = out_dir / "ref.wav"; ref.write_bytes(wav_bytes(1.0))
    run_voice(sc_raw, voice=str(ref))
    args = json.loads(fake.with_suffix(".args").read_text())
    assert args[args.index("--ref_audio") + 1] == str(ref)

def test_voz_cli_sem_binario_da_erro_claro(out_dir, fake_server, monkeypatch):
    build_project(fake_server)
    sc_raw = N["OwnMovieSceneLoad"]().run("proj", 0, "s", "n", 1, False)[0]
    monkeypatch.setenv("OMNIVOICE_BIN", "/nao/existe")
    with pytest.raises(RuntimeError, match="OMNIVOICE_BIN"):
        run_voice(sc_raw)

def test_voz_python_sem_pacote_da_erro_claro(out_dir, fake_server):
    build_project(fake_server)
    sc_raw = N["OwnMovieSceneLoad"]().run("proj", 0, "s", "n", 1, False)[0]
    with pytest.raises(RuntimeError, match="omnivoice"):
        run_voice(sc_raw, backend="python")

def test_voz_http_converte_mp3_para_wav(out_dir):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            mp3 = out_dir / "t.mp3"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=1", str(mp3)], check=True)
            self.send_response(200); self.send_header("Content-Type", "audio/mpeg"); self.end_headers(); self.wfile.write(mp3.read_bytes())
    srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        p = voice.synthesize_to_wav(out_dir / "a.wav", "http", "oi", "default", "pt", f"http://127.0.0.1:{srv.server_port}/tts", "", 30)
    finally:
        srv.shutdown()
    a, sr = media.read_wav(p.read_bytes())
    assert 0.9 < a.shape[1] / sr < 1.2

def test_voz_offline_erro_claro(out_dir):
    with pytest.raises(RuntimeError, match="OmniVoice indisponível"):
        voice.synthesize_to_wav(out_dir / "x.wav", "http", "oi", "d", "pt", "http://127.0.0.1:9/tts", "", 3)

def test_timing():
    assert media.compute_timing(2.1, 16, 1, 5) == (3, 49)
    assert media.compute_timing(0.2, 16, 1, 5) == (1, 17)   # = 17 frames do WAN2.2.json
    assert media.compute_timing(9.0, 16, 1, 5) == (5, 81)


# ---------- vídeo (ffmpeg real) ----------
def frames(n=16, size=64):
    f = np.zeros((n, size, size, 3), np.float32)
    f[..., 0] = np.linspace(0, 1, n)[:, None, None]
    return f


def make_scene_json():
    return scenes.dump_scenes([{**scenes.new_scene(0, "x"), "_project": "proj", "prompt": "p"}])


@pytest.mark.parametrize("a_dur,expected", [(2.5, 2.5), (0.4, 1.0)])
def test_mux_hold_nunca_corta_a_fala(a_dur, expected, out_dir):
    a, sr = sine(a_dur)
    sj = make_scene_json()
    (path,) = N["OwnMovieSceneMux"]().run(sj, frames(16), media.to_audio_dict(a, sr), 16, "hold_last_frame")["result"]
    assert abs(float(probe(path)) - expected) < 0.15
    assert probe(path, "stream=codec_name", "a") == "aac" and probe(path, "stream=codec_name", "v") == "h264"

def test_mux_trim_to_shortest(out_dir):
    a, sr = sine(2.5)
    (path,) = N["OwnMovieSceneMux"]().run(make_scene_json(), frames(16), media.to_audio_dict(a, sr), 16, "trim_to_shortest")["result"]
    assert float(probe(path)) < 1.2

def test_last_frame_e_encadeamento(out_dir, fake_server):
    FakeRouter.mode = "ok"
    build_project(fake_server)
    sj = scenes.dump_scenes([{**scenes.new_scene(0, "x"), "id": "c001", "_project": "proj"}])
    N["OwnMovieLastFrameSave"]().run(sj, frames(4, 32))
    assert (common.project_dir("proj") / "frames" / "c001_last.png").exists()
    *_, mode, _img = N["OwnMovieSceneLoad"]().run("proj", 1, "s", "n", 1, True)
    assert mode == 2          # cena 2 usa o último frame da cena 1 (i2v)
    *_, mode0, _ = N["OwnMovieSceneLoad"]().run("proj", 0, "s", "n", 1, True)
    assert mode0 == 1         # primeira cena é sempre t2v

def test_scene_load_indice_invalido(fake_server):
    build_project(fake_server)
    with pytest.raises(ValueError, match="fora do intervalo"):
        N["OwnMovieSceneLoad"]().run("proj", 9, "s", "n", 1, False)

def test_concat_final_e_ausentes(out_dir, fake_server):
    build_project(fake_server)
    with pytest.raises(RuntimeError, match="c001, c002"):
        N["OwnMovieFinalConcat"]().run("proj")
    a, sr = sine(1.0)
    for i, sid in enumerate(("c001", "c002")):
        sj = scenes.dump_scenes([{**scenes.new_scene(i, "x"), "_project": "proj"}])
        N["OwnMovieSceneMux"]().run(sj, frames(16), media.to_audio_dict(a, sr), 16, "hold_last_frame")
    (final,) = N["OwnMovieFinalConcat"]().run("proj")["result"]
    assert 1.8 < float(probe(final)) < 2.3
    assert common.project_status("proj")["final"]["filename"] == "final.mp4"


# ---------- edição de cena e health (rotas do ComfyUI) ----------
def test_update_scene_invalida_so_o_velho(out_dir, fake_server):
    FakeRouter.mode = "ok"
    build_project(fake_server)
    d = common.project_dir("proj", create=True)
    (d / "audio" / "c001_abc.wav").write_bytes(wav_bytes()); (d / "clips" / "c001.mp4").write_bytes(b"x")
    (d / "clips" / "c002.mp4").write_bytes(b"y"); (d / "final.mp4").write_bytes(b"f")
    common.update_scene("proj", "c001", {"prompt": "novo prompt"})        # só o visual mudou
    assert (d / "audio" / "c001_abc.wav").exists() and not (d / "clips" / "c001.mp4").exists()
    assert (d / "clips" / "c002.mp4").exists() and not (d / "final.mp4").exists()
    common.update_scene("proj", "c001", {"narration": "outra fala"})      # a fala mudou: áudio velho sai
    assert not (d / "audio" / "c001_abc.wav").exists()
    st = common.project_status("proj")["scenes"][0]
    assert st["prompt"] == "novo prompt" and st["narration"] == "outra fala" and st["audio"] is None

def test_update_scene_rejeita_campo_e_cena_invalidos(fake_server):
    build_project(fake_server)
    with pytest.raises(ValueError):
        common.update_scene("proj", "c001", {"id": "hack"})
    with pytest.raises(KeyError):
        common.update_scene("proj", "c999", {"prompt": "x"})

def test_health_ffmpeg_e_router(fake_server, monkeypatch, out_dir):
    from OWN_MOVIE import health
    monkeypatch.setenv("OMNIROUTE_URL", fake_server + "/v1")
    monkeypatch.setenv("OMNIVOICE_BIN", "/nao/existe")
    h = health.check()
    assert h["ffmpeg"]["online"] and h["omnivoice"]["online"] is False and h["omnivoice"]["hint"]
    assert "online" in h["omniroute"]
    monkeypatch.setenv("OMNIROUTE_URL", "http://127.0.0.1:9/v1")
    assert health.check()["omniroute"]["online"] is False
