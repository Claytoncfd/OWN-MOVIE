import { getSettings } from "./settings";

type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ApiWorkflow = Record<string, ApiNode>;

const base = () => getSettings().comfyUrl.replace(/\/$/, "");
const BRIDGE = "http://127.0.0.1:8000";

/** Busca no ComfyUI direto; em falha de rede/CORS tenta o proxy real do bridge (:8000). */
async function comfyFetch(path: string, init?: RequestInit) {
  const direct = `${base()}${path}`;
  try {
    return await fetch(direct, init);
  } catch (e) {
    if (typeof window === "undefined") throw e;
    const via = `${BRIDGE}/api/comfy${path}`;
    try {
      return await fetch(via, init);
    } catch {
      throw e;
    }
  }
}

export async function systemStats() {
  const r = await comfyFetch(`/system_stats`);
  if (!r.ok) throw new Error(`ComfyUI ${r.status}`);
  return (await r.json()) as {
    system: { ram_total?: number; ram_free?: number; os?: string; comfyui_version?: string; python_version?: string };
    devices: { name: string; type: string; vram_total: number; vram_free: number }[];
  };
}

export async function queueInfo() {
  const r = await comfyFetch(`/queue`);
  if (!r.ok) throw new Error(`ComfyUI ${r.status}`);
  const j = await r.json();
  return { running: j.queue_running?.length ?? 0, pending: j.queue_pending?.length ?? 0 };
}

function find(wf: ApiWorkflow, id: string) {
  const key = Object.keys(wf).find((k) => k === id || k.endsWith(`:${id}`));
  return key ? wf[key] : undefined;
}
function findAll(wf: ApiWorkflow, ids: string[]) {
  const out: ApiNode[] = [];
  for (const id of ids) {
    const n = find(wf, id);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
function byClass(wf: ApiWorkflow, match: RegExp) {
  return Object.values(wf).filter((n) => match.test(n.class_type));
}
function byTitle(wf: ApiWorkflow, match: RegExp) {
  return Object.values(wf).filter((n) => match.test(n._meta?.title ?? ""));
}
function setIn(wf: ApiWorkflow, id: string, input: string, value: unknown) {
  const n = find(wf, id);
  if (n && input in n.inputs && !Array.isArray(n.inputs[input])) n.inputs[input] = value;
  return !!n;
}
function setFirst(nodes: ApiNode[], input: string, value: unknown) {
  for (const n of nodes) {
    if (input in n.inputs && !Array.isArray(n.inputs[input])) {
      n.inputs[input] = value;
      return true;
    }
  }
  return false;
}

export type PatchParams = {
  positive: string;
  negative: string;
  excerpt: string; // narração da cena → nó CENA_EXCERTO (200)
  seed: number;
  seconds: number;
  prefix: string;
  image?: string | undefined; // uploaded filename -> i2v
};

/** Patches the exported WAN2.2.api.json. Localiza nodes por class_type/título
 *  (robusto a subgraphs com IDs compostos) em vez de depender só de IDs fixos. */
export function patchWorkflow(apiJson: string, p: PatchParams) {
  const s = getSettings();
  let wf: ApiWorkflow;
  try {
    wf = JSON.parse(apiJson) as ApiWorkflow;
  } catch {
    throw new Error("JSON API inválido: não foi possível ler o WAN2.2.api.json.");
  }
  if (Array.isArray(wf) || typeof wf !== "object") {
    throw new Error("JSON inválido: exporte no ComfyUI via Workflow → Export (API), não o WAN2.2.json do canvas.");
  }
  const clips = byClass(wf, /CLIPTextEncode/);
  const samplers = byClass(wf, /KSampler/);
  if (!clips.length || !samplers.length) {
    throw new Error("JSON API inválido: nodes CLIPTextEncode e KSampler não encontrados. Exporte o formato API no ComfyUI.");
  }
  // Positivo = primeiro CLIPTextEncode (id 12 no arquivo real); negativo = segundo (id 127).
  const pos = find(wf, "12") ?? clips[0]!;
  const neg = find(wf, "127") ?? clips[1] ?? clips[0]!;
  if ("text" in pos.inputs) pos.inputs.text = p.positive;
  if ("text" in neg.inputs) neg.inputs.text = p.negative;

  const sampler = find(wf, "7") ?? samplers[0]!;
  if ("seed" in sampler.inputs) sampler.inputs.seed = p.seed;
  if ("steps" in sampler.inputs) sampler.inputs.steps = s.steps;
  if ("cfg" in sampler.inputs) sampler.inputs.cfg = s.cfg;

  // Nós verificados do WAN2.2.api.json gerado por scripts/export-api-format.py
  // (subgraphs achatados: "74:*" = dimensões, "59:44" = seletor t2v/i2v).
  // Fallbacks por título/classe cobrem re-exports manuais com IDs diferentes.
  const widthTargets = [...findAll(wf, ["74:64", "64", "74"]), ...byTitle(wf, /width/i)];
  const heightTargets = [...findAll(wf, ["74:65", "65", "74"]), ...byTitle(wf, /height/i)];
  const fpsTargets = [...findAll(wf, ["74:66", "66", "74"]), ...byTitle(wf, /fps|frame/i)];
  const secTargets = [...findAll(wf, ["74:85", "85", "74"]), ...byTitle(wf, /second|length|duration/i)];
  setFirst(widthTargets, "value", s.width);
  setFirst(widthTargets, "width", s.width);
  setFirst(heightTargets, "value", s.height);
  setFirst(heightTargets, "height", s.height);
  setFirst(fpsTargets, "value", s.fps);
  setFirst(secTargets, "value", p.seconds);
  setFirst(secTargets, "seconds", p.seconds);

  const combiner = find(wf, "115") ?? byClass(wf, /VideoCombine/)[0];
  if (combiner) {
    if ("frame_rate" in combiner.inputs) combiner.inputs.frame_rate = s.fps;
    if ("filename_prefix" in combiner.inputs) combiner.inputs.filename_prefix = p.prefix;
  }
  const prefixPrim = find(wf, "104") ?? byTitle(wf, /filename_prefix/i)[0];
  if (prefixPrim && "value" in prefixPrim.inputs) prefixPrim.inputs.value = p.prefix;
  const excerptNode = find(wf, "200") ?? byTitle(wf, /CENA_EXCERTO/i)[0];
  if (excerptNode && "value" in excerptNode.inputs) excerptNode.inputs.value = p.excerpt;

  const loadImage = find(wf, "23") ?? byClass(wf, /LoadImage/)[0];
  const modeSwitch = find(wf, "59:44") ?? find(wf, "44") ?? find(wf, "59") ?? byTitle(wf, /t2v|i2v|mode/i)[0];
  if (p.image) {
    if (loadImage && "image" in loadImage.inputs) loadImage.inputs.image = p.image;
    if (modeSwitch && "value" in modeSwitch.inputs) modeSwitch.inputs.value = 2; // 1=t2v, 2=i2v
  } else if (modeSwitch && "value" in modeSwitch.inputs) {
    modeSwitch.inputs.value = 1;
  }
  return wf;
}

export async function queuePrompt(wf: ApiWorkflow) {
  const r = await comfyFetch(`/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: wf, client_id: "ownmovie" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ComfyUI recusou o prompt: ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j.prompt_id as string;
}

type OutFile = { filename: string; subfolder: string; type: string };

export function viewUrl(f: OutFile) {
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
  return `${base()}/view?${q}`;
}

export async function waitForResult(promptId: string, onTick?: (sec: number) => void, signal?: AbortSignal) {
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error("Cancelado");
    const r = await comfyFetch(`/history/${promptId}`);
    const j = await r.json();
    const h = j[promptId];
    if (h?.status?.status_str === "error") throw new Error("ComfyUI retornou erro na execução");
    if (h?.outputs && Object.keys(h.outputs).length) {
      let video: string | undefined;
      let lastFrame: OutFile | undefined;
      for (const [nid, o] of Object.entries(h.outputs as Record<string, Record<string, OutFile[]>>)) {
        const vids = o["gifs"] ?? o["videos"];
        if (vids?.[0]) video = viewUrl(vids[0]);
        if ((nid === "82" || nid.endsWith(":82")) && o["images"]?.[0]) lastFrame = o["images"][0];
      }
      if (video) return { video, lastFrame };
    }
    onTick?.(Math.round((Date.now() - t0) / 1000));
    await new Promise((res) => setTimeout(res, 2000));
  }
}

/** Uploads the last frame of the previous scene back as input image (chaining) */
export async function reuploadImage(f: OutFile) {
  const blob = await (await comfyFetch(viewUrl(f))).blob();
  const fd = new FormData();
  fd.append("image", blob, `ownmovie_${Date.now()}.png`);
  fd.append("overwrite", "true");
  const r = await comfyFetch(`/upload/image`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Upload falhou ${r.status}`);
  const j = await r.json();
  return (j.subfolder ? `${j.subfolder}/` : "") + j.name;
}
