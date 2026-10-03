import sys, types, pathlib
import numpy as np
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "custom_nodes"))


class FT:  # mini-tensor só para exercitar os wrappers sem instalar torch
    def __init__(s, a): s.a = np.asarray(a)
    def unsqueeze(s, d): return FT(np.expand_dims(s.a, d))
    def cpu(s): return s
    def numpy(s): return s.a
    def __getitem__(s, i): return FT(s.a[i])


torch = types.ModuleType("torch")
torch.from_numpy = lambda a: FT(a)
sys.modules.setdefault("torch", torch)


@pytest.fixture(autouse=True)
def out_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("OWN_MOVIE_OUT", str(tmp_path))
    return tmp_path
