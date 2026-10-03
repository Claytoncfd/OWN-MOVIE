#!/usr/bin/env node
// Verifica o caminho localhost REAL sem subir nada: arquivos + portas.
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const need = [
  "config/localhost.json",
  "custom_nodes/OWN_MOVIE/__init__.py",
  "workflows/02_CENA.api.json",
  "workflows/WAN2.2.json",
  "workflows/WAN2.2.api.json",
  "src/data/WAN2.2.json",
  "opensource/comfyui/main.py",
  "opensource/comfyui/user/workflows/WAN2.2.json",
  "opensource/ComfyUI-Wan2.2-workflow-main/WAN2.2.json",
  "opensource/omnivoice/pyproject.toml",
  "opensource/omniroute/package.json",
  "opensource/hermes-agent/cli.py",
];
async function probe(name, url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(t);
    return `${r.ok ? "ONLINE" : `HTTP ${r.status}`}  ${url}`;
  } catch (e) {
    return `OFFLINE  ${url} (${e instanceof Error ? e.message : e})`;
  }
}
let fail = 0;
for (const f of need) {
  const ok = existsSync(resolve(ROOT, f));
  console.log(`${ok ? "OK      " : "FALTA   "} ${f}`);
  if (!ok) fail++;
}
for (const [n, u] of [
  ["comfy", "http://127.0.0.1:8188/system_stats"],
  ["omnivoice", "http://127.0.0.1:8001/"],
  ["omniroute", "http://127.0.0.1:20128/v1/models"],
  ["ui", "http://127.0.0.1:3000/"],
]) console.log(`${n.padEnd(9)} ${await probe(n, u)}`);
if (fail) {
  console.log(`\nFaltam ${fail} arquivo(s).`);
  process.exit(1);
}
console.log("\nArquivos OK. Suba o que estiver OFFLINE com: bash scripts/start-localhost.sh");
