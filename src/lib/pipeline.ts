import { useSyncExternalStore } from "react";
import { log } from "./logs";
import {
  cancelAll,
  queuePrompt,
  waitForPrompt,
  type ApiWorkflow,
} from "./comfy";
import { getProjectStatus, projectSlug, type ServerScene } from "./own-movie";
import {
  finalWorkflow,
  planWorkflow,
  sceneWorkflow,
  voiceWorkflow,
} from "./workflows";
import type { FileRef } from "./comfy";

/**
 * A página só DISPARA workflows no ComfyUI e LÊ o que está em disco.
 * Cenas, áudio, vídeo e último frame vivem em output/OWN_MOVIE/projects/<nome>/ — nada se perde ao recarregar.
 */
export type Phase = "idle" | "plan" | "voice" | "video" | "final";
export type Project = {
  name: string;
  text: string;
  mode: "fragmentos" | "unico";
  scenes: ServerScene[];
  final: FileRef | null;
  phase: Phase;
  busy: string; // o que está rodando agora (ex.: "cena 3 · vídeo · 120s")
  error: string;
};

const KEY = "ownmovie.draft.v2"; // só o que o usuário digitou (nome, texto, modo)
let state: Project = {
  name: "projeto_001",
  text: "",
  mode: "fragmentos",
  scenes: [],
  final: null,
  phase: "idle",
  busy: "",
  error: "",
};
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const r = JSON.parse(
      localStorage.getItem(KEY) ?? "null",
    ) as Partial<Project> | null;
    if (r)
      state = {
        ...state,
        name: r.name ?? state.name,
        text: r.text ?? "",
        mode: r.mode ?? "fragmentos",
      };
  } catch {
    /* ignore */
  }
}
function set(p: Partial<Project>) {
  state = { ...state, ...p };
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ name: state.name, text: state.text, mode: state.mode }),
    );
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}
export function getProject() {
  load();
  return state;
}
export function useProject() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getProject,
    () => state,
  );
}
export const updateDraft = (
  p: Partial<Pick<Project, "name" | "text" | "mode">>,
) => set(p);
export const isRunning = (p: Project) => p.phase !== "idle";

/** Relê o estado real do disco (via rota do próprio ComfyUI). Projeto ainda sem plano = lista vazia. */
export async function refresh() {
  try {
    const st = await getProjectStatus(getProject().name);
    set({ scenes: st.scenes, final: st.final });
  } catch (e) {
    if (/scenes\.json|404|não tem/i.test((e as Error).message))
      set({ scenes: [], final: null });
    else throw e;
  }
}

let abort: AbortController | null = null;

async function run(label: string, wf: ApiWorkflow) {
  const id = await queuePrompt(wf);
  log("ComfyUI", `${label} na fila (${id.slice(0, 8)})`);
  await waitForPrompt(id, {
    signal: abort!.signal,
    onTick: (t) => set({ busy: `${label} · ${t}s` }),
  });
}

async function guarded(phase: Phase, fn: () => Promise<void>) {
  if (isRunning(getProject())) return;
  abort = new AbortController();
  set({ phase, error: "", busy: "" });
  try {
    await fn();
  } catch (e) {
    const msg = (e as Error).message;
    set({ error: msg });
    log("ComfyUI", msg, "err");
  } finally {
    set({ phase: "idle", busy: "" });
    await refresh().catch(() => undefined);
  }
}

export function stopPipeline() {
  abort?.abort();
  void cancelAll();
  log("ComfyUI", "Cancelado: job interrompido e fila limpa", "err");
}

/** 01_PLANO: divide em cenas, Planner (prompt visual), Emoção, grava scenes.json. */
export const generatePlan = () =>
  guarded("plan", async () => {
    const p = getProject();
    await run(
      "Plano (cenas · Planner · Emoção)",
      planWorkflow({ project: p.name, text: p.text, mode: p.mode }),
    );
    await refresh();
    log(
      "ComfyUI",
      `Plano pronto: ${getProject().scenes.length} cenas em ${projectSlug(p.name)}/scenes.json`,
      "ok",
    );
  });

async function voicePass(name: string, scenes: ServerScene[]) {
  for (const sc of scenes.filter((s) => !s.has_audio)) {
    await run(
      `Cena ${sc.index + 1} · voz`,
      voiceWorkflow({ project: name, index: sc.index }),
    );
    await refresh();
  }
}

/** Só a narração (OmniVoice) das cenas que ainda não têm áudio. */
export const generateVoices = () =>
  guarded("voice", async () => {
    const name = getProject().name;
    await refresh();
    await voicePass(name, getProject().scenes);
    log("OmniVoice", "Narração gerada", "ok");
  });

/**
 * 02: fase de áudio de TODAS as cenas (OmniVoice) e depois fase de vídeo, uma cena por vez na GPU.
 * Retoma sozinho: pula o que já existe em disco. `redo` = refaz só essa cena com seed nova.
 */
export const renderAll = (redo?: number) =>
  guarded("voice", async () => {
    const name = getProject().name;
    await refresh();
    const todo = getProject().scenes.filter((s) =>
      redo === undefined ? !s.has_clip : s.index === redo,
    );
    if (!todo.length) {
      log("ComfyUI", "Nada a renderizar: todas as cenas já têm clipe.", "ok");
      return;
    }
    await voicePass(name, todo);
    set({ phase: "video" });
    for (const sc of todo) {
      const seedBase = redo === undefined ? 1 : Math.floor(Math.random() * 1e9);
      await run(
        `Cena ${sc.index + 1}/${getProject().scenes.length} · vídeo`,
        sceneWorkflow({ project: name, index: sc.index, seedBase }),
      );
      await refresh();
      log("ComfyUI", `Cena ${sc.index + 1} pronta (clipe com áudio)`, "ok");
    }
  });

/** 03_FINAL: junta os clipes em final.mp4. */
export const buildFinal = () =>
  guarded("final", async () => {
    await run("Filme final", finalWorkflow(getProject().name));
    await refresh();
    log("ComfyUI", "final.mp4 gerado", "ok");
  });
