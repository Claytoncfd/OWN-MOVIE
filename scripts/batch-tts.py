#!/usr/bin/env python3
"""OWN MOVIE — TTS em lote com modelo carregado UMA vez (rápido p/ 334 cenas).

Entrada: TSV "id<TAB>texto" (gerado pelo batch-render).
Saída: wavs + durations.tsv (id<TAB>segundos).
Uso: /home/cfd/.venvs/omnivoice/bin/python scripts/batch-tts.py --list L --outdir O [--lang pt]
"""
import argparse
import sys
import time

import soundfile as sf
import torch

from omnivoice import OmniVoice


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--lang", default="pt")
    ap.add_argument("--model", default="k2-fsa/OmniVoice")
    a = ap.parse_args()

    import os
    os.makedirs(a.outdir, exist_ok=True)
    items = []
    for line in open(a.list, encoding="utf-8"):
        line = line.rstrip("\n")
        if "\t" in line:
            sid, text = line.split("\t", 1)
            if text.strip():
                items.append((sid.strip(), text.strip()))
    print(f"TTS lote: {len(items)} textos", flush=True)

    from omnivoice.utils.common import get_best_device
    device = get_best_device()
    print(f"loading {a.model} on {device} ...", flush=True)
    t0 = time.time()
    model = OmniVoice.from_pretrained(a.model, device_map=device, dtype=torch.float16)
    print(f"modelo ok em {time.time()-t0:.0f}s", flush=True)

    out = open(f"{a.outdir}/durations.tsv", "w", encoding="utf-8")
    for i, (sid, text) in enumerate(items):
        if os.path.exists(f"{a.outdir}/{sid}.wav") and os.path.getsize(f"{a.outdir}/{sid}.wav") > 0:
            print(f"[{i+1}/{len(items)}] {sid} já existe, pulando", flush=True)
        else:
            aud = model.generate(text=text, language=a.lang)
            sf.write(f"{a.outdir}/{sid}.wav", aud[0], model.sampling_rate)
            print(f"[{i+1}/{len(items)}] {sid} ok", flush=True)
        info = sf.info(f"{a.outdir}/{sid}.wav")
        out.write(f"{sid}\t{info.duration:.2f}\n")
        out.flush()
    out.close()
    print("TTS LOTE COMPLETO", flush=True)


if __name__ == "__main__":
    sys.exit(main())
