import { useSyncExternalStore } from "react";
import { getSettings } from "./settings";
import { log } from "./logs";
import { planScenes, splitText, synthesize } from "./agents";
import { patchWorkflow, queuePrompt, reuploadImage, waitForResult } from "./comfy";

export type StepState = "idle" | "run" | "ok" | "err";
export type Scene = {
  id: string;
  narration: string;
  prompt: string;
  audioUrl?: string | undefined;
  duration?: number | undefined;
  seconds?: number | undefined;
  videoUrl?: string | undefined;
  lastFrame?: { filename: string; subfolder: string; type: string } | undefined;
  audio: StepState;
  video: StepState;
  error?: string | undefined;
  elapsed?: number | undefined;
};
export type Project = { name: string; text: string; mode: "fragmentos" | "unico"; scenes: Scene[]; running: boolean };

const KEY = "ownmovie.project.v1";
let state: Project = { name: "Projeto 001", text: "", mode: "fragmentos", scenes: [], running: false };
let loaded = false;
const subs = new Set<() => void>();
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const r = localStorage.getItem(KEY);
    if (r) {
      const p = JSON.parse(r) as Project;
      state = { ...p, running: false, scenes: p.scenes.map((s) => ({ ...s, audioUrl: undefined, audio: s.audio === "ok" ? "idle" : s.audio, video: s.video === "run" ? "idle" : s.video })) };
    }
  } catch { /* ignore */ }
}
function set(p: Partial<Project>) {
  state = { ...state, ...p };
  localStorage.setItem(KEY, JSON.stringify({ ...state, scenes: state.scenes.map((s) => ({ ...s, audioUrl: undefined })) }));
  subs.forEach((f) => f());
}
function patchScene(id: string, p: Partial<Scene>) {
  set({ scenes: state.scenes.map((s) => (s.id === id ? { ...s, ...p } : s)) });
}
export function getProject() { load(); return state; }
export function useProject() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, getProject, () => state);
}
export const updateProject = set;
export { patchScene };

export async function buildScenes() {
  const p = getProject();
  const chunks = splitText(p.text, p.mode);
  log("Hermes", `Texto ${p.mode === "unico" ? "único" : "fragmentado"} → ${chunks.length} cenas`);
  const plans = await planScenes(chunks, (m) => log("OmniRoute", m));
  set({ scenes: plans.map((pl, i) => ({ id: `${Date.now()}-${i}`, narration: pl.narration, prompt: pl.prompt, audio: "idle", video: "idle" })) });
}

let abort: AbortController | null = null;
export function stopPipeline() { abort?.abort(); set({ running: false }); log("API", "Pipeline cancelado", "err"); }

/**
 * Distribuição por estágio: TTS (CPU/OmniVoice) roda em paralelo para todas as cenas,
 * enquanto a GPU (ComfyUI) recebe um job de vídeo por vez (fila única).
 */
export async function runPipeline() {
  const s = getSettings();
  if (!s.apiWorkflow) { log("API", "Carregue o WAN2.2.api.json em Configurações antes de executar.", "err"); return; }
  abort = new AbortController();
  set({ running: true });
  const scenes = getProject().scenes;

  const audioJobs = scenes.map(async (sc) => {
    if (sc.audioUrl) return;
    patchScene(sc.id, { audio: "run", error: undefined });
    try {
      const a = await synthesize(sc.narration);
      patchScene(sc.id, { audio: "ok", audioUrl: a.url, duration: a.duration });
      log("OmniVoice", `Cena ${scenes.indexOf(sc) + 1}: ${a.duration.toFixed(1)}s de narração`, "ok");
    } catch (e) {
      patchScene(sc.id, { audio: "err", error: (e as Error).message });
      log("OmniVoice", (e as Error).message, "err");
    }
  });

  let prevFrame: Scene["lastFrame"];
  for (let i = 0; i < scenes.length; i++) {
    if (abort.signal.aborted) break;
    await audioJobs[i]; // precisa da duração do áudio para definir os segundos
    const sc = getProject().scenes.find((x) => x.id === scenes[i].id)!;
    if (sc.video === "ok" && sc.videoUrl) { prevFrame = sc.lastFrame; continue; }
    const seconds = Math.max(1, Math.min(s.maxSeconds, Math.ceil(sc.duration ?? 2)));
    patchScene(sc.id, { video: "run", seconds, elapsed: 0 });
    try {
      let image: string | undefined;
      if (s.chainLastFrame && prevFrame) image = await reuploadImage(prevFrame);
      const wf = patchWorkflow(s.apiWorkflow, {
        positive: `${s.stylePrefix} ${sc.prompt}`.trim(),
        negative: s.negative,
        seed: Math.floor(Math.random() * 1e15),
        seconds,
        prefix: `OwnMovie/${getProject().name.replace(/\W+/g, "_")}_c${i + 1}`,
        image,
      });
      const id = await queuePrompt(wf);
      log("ComfyUI", `Cena ${i + 1} na fila GPU (${seconds}s · ${s.fps}fps · ${seconds * s.fps + 1} frames) id ${id.slice(0, 8)}`);
      const res = await waitForResult(id, (t) => patchScene(sc.id, { elapsed: t }), abort.signal);
      prevFrame = res.lastFrame;
      patchScene(sc.id, { video: "ok", videoUrl: res.video, lastFrame: res.lastFrame });
      log("ComfyUI", `Cena ${i + 1} renderizada`, "ok");
    } catch (e) {
      patchScene(sc.id, { video: "err", error: (e as Error).message });
      log("ComfyUI", (e as Error).message, "err");
    }
  }
  await Promise.all(audioJobs);
  set({ running: false });
  log("API", "Pipeline concluído — abra o Player VOX para assistir/exportar", "ok");
}
