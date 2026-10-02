import { getSettings } from "./settings";

type ApiNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
export type ApiWorkflow = Record<string, ApiNode>;

const base = () => getSettings().comfyUrl.replace(/\/$/, "");

export async function systemStats() {
  const r = await fetch(`${base()}/system_stats`);
  if (!r.ok) throw new Error(`ComfyUI ${r.status}`);
  return (await r.json()) as {
    system: { ram_total?: number; ram_free?: number; os?: string; comfyui_version?: string; python_version?: string };
    devices: { name: string; type: string; vram_total: number; vram_free: number }[];
  };
}

export async function queueInfo() {
  const r = await fetch(`${base()}/queue`);
  if (!r.ok) throw new Error(`ComfyUI ${r.status}`);
  const j = await r.json();
  return { running: j.queue_running?.length ?? 0, pending: j.queue_pending?.length ?? 0 };
}

function find(wf: ApiWorkflow, id: string) {
  const key = Object.keys(wf).find((k) => k === id || k.endsWith(`:${id}`));
  return key ? wf[key] : undefined;
}
function setIn(wf: ApiWorkflow, id: string, input: string, value: unknown) {
  const n = find(wf, id);
  if (n && input in n.inputs && !Array.isArray(n.inputs[input])) n.inputs[input] = value;
  return !!n;
}

export type PatchParams = {
  positive: string;
  negative: string;
  seed: number;
  seconds: number;
  prefix: string;
  image?: string | undefined; // uploaded filename -> i2v
};

/** Patches the exported WAN2.2.api.json using the node IDs of the real workflow */
export function patchWorkflow(apiJson: string, p: PatchParams) {
  const s = getSettings();
  const wf = JSON.parse(apiJson) as ApiWorkflow;
  if (!find(wf, "12") || !find(wf, "7")) {
    throw new Error("JSON API inválido: nodes 12 (CLIPTextEncode) e 7 (KSampler) não encontrados.");
  }
  setIn(wf, "12", "text", p.positive);
  setIn(wf, "127", "text", p.negative);
  setIn(wf, "7", "seed", p.seed);
  setIn(wf, "7", "steps", s.steps);
  setIn(wf, "7", "cfg", s.cfg);
  setIn(wf, "64", "value", s.width); // Width (INT Constant)
  setIn(wf, "65", "value", s.height); // Height (INT Constant)
  setIn(wf, "66", "value", s.fps); // Frames/FPS (INT Constant)
  setIn(wf, "85", "value", p.seconds); // Seconds (PrimitiveInt)
  setIn(wf, "115", "frame_rate", s.fps); // VHS_VideoCombine
  setIn(wf, "115", "filename_prefix", p.prefix);
  setIn(wf, "104", "value", p.prefix);
  if (p.image) {
    setIn(wf, "44", "value", 2); // 1=t2v, 2=i2v
    setIn(wf, "23", "image", p.image);
  } else {
    setIn(wf, "44", "value", 1);
  }
  return wf;
}

export async function queuePrompt(wf: ApiWorkflow) {
  const r = await fetch(`${base()}/prompt`, {
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
    const r = await fetch(`${base()}/history/${promptId}`);
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
  const blob = await (await fetch(viewUrl(f))).blob();
  const fd = new FormData();
  fd.append("image", blob, `ownmovie_${Date.now()}.png`);
  fd.append("overwrite", "true");
  const r = await fetch(`${base()}/upload/image`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Upload falhou ${r.status}`);
  const j = await r.json();
  return (j.subfolder ? `${j.subfolder}/` : "") + j.name;
}
