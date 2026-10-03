"""Valida os 4 workflows API contra (a) o object_info REAL exportado do ComfyUI do projeto e (b) os nodes OWN_MOVIE."""
import json, pathlib
import pytest
from OWN_MOVIE.nodes import NODE_CLASS_MAPPINGS as N

ROOT = pathlib.Path(__file__).resolve().parents[2]
WF = ROOT / "workflows"
OI = json.loads((WF / ".object_info_cache.json").read_text())


def spec(cls):
    """(entradas {nome: tipo}, obrigatórias, saídas) de um node, vindo do object_info real ou da classe OWN."""
    if cls in N:
        s = N[cls].INPUT_TYPES()
        ins = {**s["required"], **s.get("optional", {})}
        return {k: v[0] for k, v in ins.items()}, set(s["required"]), list(N[cls].RETURN_TYPES)
    info = OI[cls]
    req, opt = info["input"].get("required", {}), info["input"].get("optional", {})
    return {k: v[0] for k, v in {**req, **opt}.items()}, set(req), list(info["output"])


@pytest.mark.parametrize("fname", ["01_PLANO", "02_VOZ", "02_CENA", "03_FINAL"])
def test_workflow(fname):
    g = json.loads((WF / f"{fname}.api.json").read_text())
    for nid, n in g.items():
        ins, req, _ = spec(n["class_type"])
        for k, v in n["inputs"].items():
            if k not in ins and not k.startswith(("input", "anything", "lora_", "base_ctx", "clip", "optional")):
                pytest.fail(f"{fname}:{nid} ({n['class_type']}): input desconhecido '{k}'")
            if isinstance(v, list):
                assert v[0] in g, f"{fname}:{nid}.{k} aponta para nó inexistente {v[0]}"
                _, _, outs = spec(g[v[0]]["class_type"])
                assert v[1] < len(outs), f"{fname}:{nid}.{k}: saída {v[1]} inexistente em {g[v[0]]['class_type']}"
                want, got = ins.get(k), outs[v[1]]
                if isinstance(want, str) and want not in ("*",) and got not in ("*",):
                    assert want == got, f"{fname}:{nid}.{k}: tipo {got} ligado em entrada {want}"
        missing = [r for r in req if r not in n["inputs"] and not r.startswith("input")]
        # nós de terceiros (rgthree/impact) têm entradas dinâmicas: só exigimos completude nos nós OWN
        if n["class_type"] in N:
            assert not missing, f"{fname}:{nid}: faltam {missing}"


def test_02_cena_ligacoes_chave():
    g = json.loads((WF / "02_CENA.api.json").read_text())
    assert g["12"]["inputs"]["text"] == ["300", 1] and g["127"]["inputs"]["text"] == ["300", 2]
    assert g["74:85"]["inputs"]["value"] == ["302", 0]            # segundos vêm da duração do áudio
    assert g["304"]["inputs"]["frames"] == ["7", 5] and g["304"]["inputs"]["audio"] == ["301", 0]
    for gone in ("115", "83", "82", "200", "23"):
        assert gone not in g
