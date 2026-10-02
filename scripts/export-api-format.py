#!/usr/bin/env python3
"""OWN MOVIE — exporta workflows/WAN2.2.json (formato UI) para
workflows/WAN2.2.api.json (formato API do ComfyUI), igual ao
'Workflow → Export (API)' do frontend.

- Achata os 3 subgraphs com IDs compostos ("74:64"), como o export oficial.
- Resolve os 23 ue_links (Anything Everywhere) em links reais.
- Mapeia widgets_values → inputs pela ordem oficial de cada nó (input_order
  lido do próprio ComfyUI em http://127.0.0.1:8188/object_info).
- Pula nós sem classe no servidor (ex.: MarkdownNote) e widgets de controle.

Validação real: POST /prompt no ComfyUI (aceito = válido) + /interrupt imediato.
Uso: python3 scripts/export-api-format.py [--no-validate]
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UI_PATH = ROOT / "workflows/WAN2.2.json"
API_PATH = ROOT / "workflows/WAN2.2.api.json"
CACHE = ROOT / "workflows/.object_info_cache.json"
COMFY = "http://127.0.0.1:8188"

SKIP_TYPES = {"MarkdownNote", "Note", "Reroute"}
CONTROL_VALUES = {"fixed", "increment", "decrement", "randomize"}


def get(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def object_info(class_names):
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    for c in sorted(set(class_names) - set(cache)):
        try:
            info = get(f"{COMFY}/object_info/{urllib.parse.quote(c, safe='')}")
            cache[c] = info.get(c)
        except Exception as e:
            print(f"  ! object_info falhou para {c}: {e}")
            cache[c] = None
    CACHE.write_text(json.dumps(cache))
    return cache


def _is_widget(spec):
    t = spec[0] if isinstance(spec, list) and spec else spec
    if isinstance(t, list):
        return True  # combo
    return t in ("INT", "FLOAT", "STRING", "BOOLEAN")


def widget_inputs(info):
    """Nomes de inputs preenchidos por widgets, na ordem oficial.

    Inclui inputs ligados ou não: o litegraph mantém o widget (com valor
    sincronizado) mesmo quando há link — o link sobrescreve depois.
    Só tipos widgetáveis (COMBO/INT/FLOAT/STRING/BOOLEAN) viram widgets.
    """
    order = info.get("input_order") or {}
    req = info["input"].get("required", {})
    opt = info["input"].get("optional", {})
    out = [x for x in order.get("required", req.keys()) if x in req and _is_widget(req[x])]
    return out + [x for x in order.get("optional", opt.keys()) if x not in out and x in opt and _is_widget(opt[x])]


def convert_nodes(nodes, oi):
    """nodes: lista UI. Retorna {cid: {"class_type", "inputs"}} com widgets aplicados."""
    api = {}
    for n in nodes:
        t = n["type"]
        if t in SKIP_TYPES:
            continue
        info = oi.get(t)
        if info is None:
            print(f"  ! pulando {t} (id {n.get('id')}): sem classe no servidor")
            continue
        names = widget_inputs(info)
        inputs = {}
        vals = n.get("widgets_values")
        if isinstance(vals, dict):
            for k, v in vals.items():
                if v is None:
                    continue
                inputs[k] = v
        elif isinstance(vals, list):
            wi, prev = 0, None
            for v in vals:
                if v is None and prev == "seed":
                    continue  # controle do seed (fixed/increment/...)
                if wi >= len(names):
                    if v in CONTROL_VALUES or v is None:
                        continue
                    print(f"  ! sobra de widget em {t} id {n.get('id')}: {v!r}")
                    continue
                inputs[names[wi]] = v
                prev = names[wi]
                wi += 1
        api[str(n["id"])] = {"class_type": t, "inputs": inputs}
    return api


def in_name(node, idx):
    ins = node.get("inputs", [])
    return ins[idx]["name"] if isinstance(idx, int) and idx < len(ins) else idx


def main():
    validate = "--no-validate" not in sys.argv
    wf = json.loads(UI_PATH.read_text())
    nodes = {n["id"]: n for n in wf["nodes"]}
    defs = {s["id"]: s for s in wf["definitions"]["subgraphs"]}
    print(f"UI: {len(nodes)} nodes, {len(wf['links'])} links, {len(defs)} subgraphs")

    classes = {n["type"] for n in wf["nodes"]}
    for s in defs.values():
        classes.update(n["type"] for n in s["nodes"])
    oi = object_info(classes - SKIP_TYPES)

    # ---- links externos (array) + ue_links -> (src_id, src_slot, dst_id, dst_name)
    resolved = []
    for L in wf["links"]:
        _lid, o, os, t, ts, _typ = L
        if o in nodes and t in nodes:
            resolved.append((str(o), os, str(t), in_name(nodes[t], ts)))
    for ue in wf.get("extra", {}).get("ue_links", []):
        dn, up = int(ue["downstream"]), int(ue["upstream"])
        if dn in nodes and up in nodes:
            name = in_name(nodes[dn], ue["downstream_slot"])
            if name:
                resolved.append((str(up), ue["upstream_slot"], str(dn), name))
    linked_outer = {}
    for _o, _os, t, name in resolved:
        linked_outer.setdefault(t, set()).add(name)
    api = convert_nodes(wf["nodes"], oi)

    # ---- achata subgraphs com IDs compostos "outer:inner"
    sub_out_src = {}  # (outer_id, out_name) -> (inner_compound_id, slot)
    get_ids = {str(n["id"]) for n in wf["nodes"] if n["type"] == "GetNode"}
    set_ids = {str(n["id"]) for n in wf["nodes"] if n["type"] == "SetNode"}
    for n in wf["nodes"]:
        if n["type"] not in defs:
            continue
        outer = str(n["id"])
        sg = defs[n["type"]]
        inner = {x["id"]: x for x in sg["nodes"] if x["id"] >= 0}
        # fronteira via definition inputs/outputs (match por nome no slot externo)
        feed, drain = {}, {}
        for inp in sg.get("inputs", []):
            ext = next((L for L in wf["links"] if L[3] == n["id"] and in_name(n, L[4]) == inp["name"]), None)
            if ext:
                for ilid in inp.get("linkIds", []):
                    feed[ilid] = (str(ext[1]), ext[2])
        for out in sg.get("outputs", []):
            tgts = [(str(L[3]), in_name(nodes[L[3]], L[4]))
                    for L in wf["links"]
                    if L[1] == n["id"] and _out_name(n, L[2]) == out["name"]
                    and nodes[L[3]]["type"] not in ("SetNode", "GetNode")]
            for ilid in out.get("linkIds", []):
                drain[ilid] = tgts
        # links internos -> resolved com prefixo
        inner_resolved = []
        for L in sg["links"]:
            o, os, t, ts = L["origin_id"], L["origin_slot"], L["target_id"], L["target_slot"]
            srcs = [feed[L["id"]]] if o == -10 and L["id"] in feed else ([(f"{outer}:{o}", os)] if o != -10 else [])
            if not srcs:
                continue
            if t == -20:
                for (tt, tname) in drain.get(L["id"], []):
                    for s in srcs:
                        inner_resolved.append((s[0], s[1], tt, tname))
                continue
            inner_resolved.append((srcs[0][0], srcs[0][1], f"{outer}:{t}", in_name(inner[t], ts)))
        linked_inner = {}
        for _o, _os, t, name in inner_resolved:
            linked_inner.setdefault(t, set()).add(name)
        sub = convert_nodes([x for x in sg["nodes"] if x["id"] >= 0], oi)
        for cid, node in sub.items():
            api[f"{outer}:{cid}"] = node
        for (o, os, t, name) in inner_resolved:
            if t in api and o in api and name:
                api[t]["inputs"][name] = [o, os]
            elif o in get_ids or t in set_ids:
                pass  # Get/Set: resolvido na passada getset abaixo
            else:
                print(f"  ! link interno órfão: {o}:{os} -> {t}.{name}")
        # registra de onde sai cada output do subgraph (para Get/Set e links externos)
        for out in sg.get("outputs", []):
            for ilid in out.get("linkIds", []):
                src = next((L for L in sg["links"] if L["id"] == ilid), None)
                if src and src["origin_id"] != -10:
                    sub_out_src[(outer, out["name"])] = (f"{outer}:{src['origin_id']}", src["origin_slot"])

    # ---- GetNode/SetNode são só do frontend (Easy-Use): resolve em links diretos.
    # SetNode guarda o valor do seu input sob um nome; GetNode do mesmo nome o lê.
    def api_targets(nid, slot):
        """(node_id externo, slot) -> [(api_id, input_name)] atravessando subgraphs."""
        n = nodes[nid] if isinstance(nid, int) else nodes[int(nid)]
        name = in_name(n, slot)
        if n["type"] in defs:
            sg = defs[n["type"]]
            out = []
            for inp in sg.get("inputs", []):
                if inp["name"] != name:
                    continue
                for ilid in inp.get("linkIds", []):
                    L = next(x for x in sg["links"] if x["id"] == ilid)
                    out.append((f"{n['id']}:{L['target_id']}", in_name(inner_of(sg, L["target_id"]), L["target_slot"])))
            return out
        return [(str(n["id"]), name)] if str(n["id"]) in api else []

    setters = {}
    for n in wf["nodes"]:
        if n["type"] == "SetNode" and (n.get("widgets_values") or [None])[0]:
            for L in wf["links"]:
                if L[3] == n["id"]:
                    o, oname = L[1], _out_name(nodes[L[1]], L[2])
                    if nodes[o]["type"] in defs:
                        real = sub_out_src.get((str(o), oname))
                        if real:
                            setters[n["widgets_values"][0]] = real
                            print(f"  getset '{n['widgets_values'][0]}': {o}.{oname} -> {real[0]}:{real[1]}")
                    elif str(o) in api:
                        setters[n["widgets_values"][0]] = (str(o), L[2])
    for (o, os, t, name) in resolved:
        if o in get_ids:
            gname = next(n["widgets_values"][0] for n in wf["nodes"] if str(n["id"]) == o)
            src = setters.get(gname)
            for (tt, tname) in api_targets(int(t), _slot_index(nodes[int(t)], name)):
                if src and tt in api and tname:
                    api[tt]["inputs"][tname] = [src[0], src[1]]
                else:
                    print(f"  ! getset '{gname}' sem origem válida para {tt}.{tname}")
            continue
        if t in set_ids:
            continue  # SetNode consumido pelo getset acima
        if o in api and t in api and name:
            api[t]["inputs"][name] = [o, os]
            continue
        # origem é um subgraph: resolve pela saída registrada no flatten
        if t in api and name:
            oname = _out_name(nodes[int(o)], os) if o.isdigit() and int(o) in nodes else None
            real = sub_out_src.get((o, oname)) if oname else None
            if real:
                api[t]["inputs"][name] = [real[0], real[1]]
            else:
                print(f"  ! link órfão: {o}:{os} -> {t}.{name}")

    API_PATH.write_text(json.dumps(api, indent=1))
    print(f"API: {len(api)} nodes -> {API_PATH.relative_to(ROOT)}")

    if validate:
        _validate(api)


def _out_name(node, idx):
    outs = node.get("outputs", [])
    return outs[idx]["name"] if isinstance(idx, int) and idx < len(outs) else idx


def inner_of(sg, nid):
    return next(x for x in sg["nodes"] if x["id"] == nid)


def _slot_index(node, name):
    for i, x in enumerate(node.get("inputs", [])):
        if x.get("name") == name:
            return i
    return name


def _validate(api):
    body = json.dumps({"prompt": api, "client_id": "ownmovie-export-check"}).encode()
    req = urllib.request.Request(f"{COMFY}/prompt", data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            pid = json.loads(r.read()).get("prompt_id")
    except urllib.error.HTTPError as e:
        print(f"ComfyUI recusou (HTTP {e.code}):")
        print(e.read().decode()[:2000])
        sys.exit(2)
    print(f"ComfyUI ACEITOU o prompt ({pid[:8]}...) — interrompendo antes de executar")
    urllib.request.urlopen(urllib.request.Request(f"{COMFY}/interrupt", data=b"{}", headers={"Content-Type": "application/json"}), timeout=30)
    urllib.request.urlopen(urllib.request.Request(f"{COMFY}/queue", data=b'{"clear": true}', headers={"Content-Type": "application/json"}), timeout=30)
    print("Fila limpa. Export válido de verdade.")


if __name__ == "__main__":
    main()
