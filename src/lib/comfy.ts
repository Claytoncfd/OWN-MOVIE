import { getSettings } from "./settings";

export type ApiNode = {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
};
export type ApiWorkflow = Record<string, ApiNode>;
export type FileRef = { filename: string; subfolder: string; type: string };

const base = () => getSettings().comfyUrl.replace(/\/$/, "");

/** Fala direto com o ComfyUI (suba com --enable-cors-header). Sem proxy: o bridge :8000 deixou de existir. */
async function comfyFetch(path: string, init?: RequestInit) {
  try {
    return await fetch(`${base()}${path}`, init);
  } catch {
    throw new Error(
      `ComfyUI inacessível em ${base()}. Suba com: python3 main.py --listen 127.0.0.1 --port 8188 --enable-cors-header`,
    );
  }
}

export async function systemStats() {
  const r = await comfyFetch(`/system_stats`);
  if (!r.ok) throw new Error(`ComfyUI ${r.status}`);
  return (await r.json()) as {
    system: {
      ram_total?: number;
      ram_free?: number;
      os?: string;
      comfyui_version?: string;
      python_version?: string;
    };
    devices: {
      name: string;
      type: string;
      vram_total: number;
      vram_free: number;
    }[];
  };
}

export async function queueInfo() {
  const r = await comfyFetch(`/queue`);
  if (!r.ok) throw new Error(`ComfyUI ${r.status}`);
  const j = await r.json();
  return {
    running: j.queue_running?.length ?? 0,
    pending: j.queue_pending?.length ?? 0,
  };
}

/** O pacote custom_nodes/OWN_MOVIE está carregado neste ComfyUI? */
export async function ownMovieNodesInstalled() {
  const r = await comfyFetch(`/object_info/OwnMovieSceneLoad`);
  if (!r.ok) return false;
  const j = (await r.json()) as Record<string, unknown>;
  return "OwnMovieSceneLoad" in j;
}

/** Define entradas de um nó do template. Falha alto se o nó/entrada não existir (template desatualizado). */
export function setInputs(
  wf: ApiWorkflow,
  nodeId: string,
  values: Record<string, unknown>,
) {
  const n = wf[nodeId];
  if (!n)
    throw new Error(
      `Template sem o nó ${nodeId}. Rode: python3 scripts/build-workflows.py`,
    );
  for (const [k, v] of Object.entries(values)) {
    if (!(k in n.inputs))
      throw new Error(
        `Nó ${nodeId} (${n.class_type}) não tem a entrada "${k}".`,
      );
    n.inputs[k] = v;
  }
}

export async function queuePrompt(wf: ApiWorkflow) {
  const r = await comfyFetch(`/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: wf, client_id: "ownmovie" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const nodeErrs = Object.values(
      (j.node_errors ?? {}) as Record<
        string,
        { errors?: { message?: string; details?: string }[] }
      >,
    )
      .flatMap((e) => e.errors ?? [])
      .map((e) => `${e.message}${e.details ? `: ${e.details}` : ""}`);
    throw new Error(
      `ComfyUI recusou o workflow: ${(nodeErrs[0] ?? j.error?.message ?? JSON.stringify(j)).slice(0, 300)}`,
    );
  }
  return j.prompt_id as string;
}

/** Cancela de verdade: interrompe o job em execução e esvazia a fila pendente. */
export async function cancelAll() {
  await comfyFetch(`/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clear: true }),
  }).catch(() => undefined);
  await comfyFetch(`/interrupt`, { method: "POST" }).catch(() => undefined);
}

export function viewUrl(f: FileRef) {
  const q = new URLSearchParams({
    filename: f.filename,
    subfolder: f.subfolder,
    type: f.type,
  });
  return `${base()}/view?${q}`;
}

type HistoryEntry = {
  status?: {
    status_str?: string;
    messages?: [string, Record<string, unknown>][];
  };
  outputs?: Record<string, unknown>;
};

/** Espera o job terminar. Erro do node vem com a mensagem real; tem timeout e respeita o cancelamento. */
export async function waitForPrompt(
  promptId: string,
  opts: {
    onTick?: (sec: number) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
) {
  const { onTick, signal, timeoutMs = 90 * 60_000 } = opts;
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error("Cancelado");
    if (Date.now() - t0 > timeoutMs)
      throw new Error(
        `Tempo esgotado (${Math.round(timeoutMs / 60000)} min) esperando o ComfyUI.`,
      );
    const r = await comfyFetch(`/history/${promptId}`);
    const h = ((await r.json()) as Record<string, HistoryEntry>)[promptId];
    if (h?.status?.status_str === "error") {
      const m = h.status.messages?.find(
        (x) => x[0] === "execution_error",
      )?.[1] as { node_type?: string; exception_message?: string } | undefined;
      throw new Error(
        m
          ? `${m.node_type}: ${String(m.exception_message ?? "")
              .trim()
              .slice(0, 300)}`
          : "ComfyUI retornou erro na execução",
      );
    }
    if (h?.status?.status_str === "success") return h;
    onTick?.(Math.round((Date.now() - t0) / 1000));
    await new Promise((res) => setTimeout(res, 2000));
  }
}
