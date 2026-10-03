"""Áudio/vídeo: WAV, conversão de tensores e ffmpeg. Funções puras aceitam numpy (torch só é importado
dentro dos wrappers de tensor), o que permite testar fora do ComfyUI."""
from __future__ import annotations

import io
import math
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np


# ---------- ffmpeg ----------
def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as e:
        raise RuntimeError("ffmpeg não encontrado. Instale o FFmpeg e coloque no PATH (ou: pip install imageio-ffmpeg).") from e


def run_ffmpeg(args: list[str], stdin: bytes | None = None) -> None:
    p = subprocess.run([find_ffmpeg(), "-y", "-loglevel", "error", *args], input=stdin, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou: {p.stderr.decode(errors='replace')[:500]}")


# ---------- WAV ----------
def read_wav(data: bytes) -> tuple[np.ndarray, int]:
    """bytes WAV (PCM) -> (float32 [canais, amostras], sample_rate)."""
    with wave.open(io.BytesIO(data)) as w:
        ch, width, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if width == 1:
        a = (np.frombuffer(raw, np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 2:
        a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
    elif width == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        i = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        i = np.where(i & 0x800000, i - 0x1000000, i)
        a = i.astype(np.float32) / 8388608.0
    elif width == 4:
        a = np.frombuffer(raw, np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"WAV com {width * 8} bits não suportado.")
    return a.reshape(-1, ch).T.copy(), sr


def write_wav(path: Path, samples: np.ndarray, sr: int) -> None:
    pcm = (np.clip(samples, -1, 1).T * 32767.0).round().astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(samples.shape[0])
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def ensure_wav(data: bytes) -> bytes:
    """Aceita WAV PCM direto; qualquer outro formato (mp3, flac, WAV float) é convertido via ffmpeg."""
    if data[:4] == b"RIFF":
        try:
            read_wav(data)
            return data
        except (wave.Error, ValueError):
            pass
    p = subprocess.run(
        [find_ffmpeg(), "-loglevel", "error", "-i", "pipe:0", "-f", "wav", "-acodec", "pcm_s16le", "pipe:1"],
        input=data, capture_output=True,
    )
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError(f"Áudio do OmniVoice não pôde ser convertido para WAV: {p.stderr.decode(errors='replace')[:300]}")
    return p.stdout


# ---------- tensores ComfyUI (torch só aqui) ----------
def to_audio_dict(samples: np.ndarray, sr: int) -> dict:
    import torch  # type: ignore

    return {"waveform": torch.from_numpy(samples).unsqueeze(0), "sample_rate": sr}  # [1, C, T]


def audio_to_numpy(audio: dict) -> tuple[np.ndarray, int]:
    wf = audio["waveform"][0]
    return np.asarray(wf.cpu().numpy() if hasattr(wf, "cpu") else wf, dtype=np.float32), int(audio["sample_rate"])


def image_to_numpy(img) -> np.ndarray:
    """IMAGE [B,H,W,C] float 0..1 -> uint8 [B,H,W,3]."""
    a = img.cpu().numpy() if hasattr(img, "cpu") else np.asarray(img)
    return (np.clip(a[..., :3], 0, 1) * 255.0).round().astype(np.uint8)


def numpy_to_image(arr: np.ndarray):
    import torch  # type: ignore

    return torch.from_numpy(arr.astype(np.float32) / 255.0).unsqueeze(0)


# ---------- temporização ----------
def compute_timing(duration: float, fps: int, min_s: int, max_s: int) -> tuple[int, int]:
    seconds = max(min_s, min(max_s, math.ceil(duration)))
    return seconds, fps * seconds + 1  # mesma fórmula do workflow Wan: FPS × segundos + 1


# ---------- mux ----------
SYNC_MODES = ["hold_last_frame", "trim_to_shortest"]


def build_mux_cmd(w: int, h: int, fps: int, wav: Path, out: Path, v_dur: float, a_dur: float, sync: str, crf: int = 19) -> list[str]:
    vf = ["scale=trunc(iw/2)*2:trunc(ih/2)*2"]
    cmd = ["-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-", "-i", str(wav)]
    if sync == "hold_last_frame":
        # Nunca corta a fala: se o áudio é maior, congela o último frame; se é menor, completa com silêncio.
        extra = max(0.0, a_dur - v_dur)
        if extra > 0:
            vf.insert(0, f"tpad=stop_mode=clone:stop_duration={extra:.3f}")
        cmd += ["-af", "apad", "-t", f"{max(a_dur, v_dur):.3f}"]
    else:
        cmd += ["-shortest"]
    cmd += ["-vf", ",".join(vf), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(crf), "-c:a", "aac", "-b:a", "192k", str(out)]
    return cmd


def mux_scene(frames_u8: np.ndarray, fps: int, wav: Path, a_dur: float, out: Path, sync: str) -> float:
    n, h, w, _ = frames_u8.shape
    v_dur = n / fps
    run_ffmpeg(build_mux_cmd(w, h, fps, wav, out, v_dur, a_dur, sync), stdin=frames_u8.tobytes())
    return max(a_dur, v_dur) if sync == "hold_last_frame" else min(a_dur, v_dur)


def concat_clips(clips: list[Path], out: Path) -> None:
    lst = out.with_suffix(".txt")
    lst.write_text("".join("file '{}'\n".format(str(c.resolve()).replace("'", "'\\''")) for c in clips), encoding="utf-8")
    try:
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)])
    finally:
        lst.unlink(missing_ok=True)
