import { useSyncExternalStore } from "react";

/** Só o que o navegador precisa saber. O resto (OmniVoice, OmniRoute, modelos) vira widget dos nodes no ComfyUI. */
export type Settings = {
  comfyUrl: string;
  routerUrl: string; // OmniRoute (OpenAI compatível), usado pelo node RouterConfig
  routerModel: string;
  voiceLang: string;
  voiceName: string; // "default" ou caminho de um áudio de referência (clonagem)
  useEmotion: boolean; // inclui o Agente Emoção no plano
  negative: string;
  stylePrefix: string;
  width: number;
  height: number;
  fps: number;
  maxSeconds: number;
  steps: number;
  cfg: number;
  chainLastFrame: boolean;
};

const DEFAULTS: Settings = {
  comfyUrl: "http://127.0.0.1:8188",
  routerUrl: "http://127.0.0.1:20128/v1",
  routerModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  voiceLang: "pt",
  voiceName: "default",
  useEmotion: true,
  negative:
    "blurry, low quality, distorted, watermark, text artifacts, deformed",
  stylePrefix:
    "Vox explainer style, flat editorial collage, paper texture, bold graphic shapes, archival cutouts, clean motion,",
  width: 512,
  height: 512,
  fps: 16,
  maxSeconds: 5,
  steps: 4,
  cfg: 1.5,
  chainLastFrame: false,
};

const KEY = "ownmovie.settings.v2";
let state: Settings = DEFAULTS;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
}

export function getSettings() {
  load();
  return state;
}
export function setSettings(patch: Partial<Settings>) {
  load();
  state = { ...state, ...patch };
  localStorage.setItem(KEY, JSON.stringify(state));
  subs.forEach((f) => f());
}
export function useSettings() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getSettings,
    () => DEFAULTS,
  );
}
export { DEFAULTS as DEFAULT_SETTINGS };
