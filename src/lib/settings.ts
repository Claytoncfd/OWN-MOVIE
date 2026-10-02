import { useSyncExternalStore } from "react";

export type Settings = {
  comfyUrl: string;
  voiceUrl: string; // OmniVoice HTTP endpoint (POST JSON -> audio)
  voiceName: string;
  voiceLang: string;
  routerUrl: string; // OmniRoute OpenAI-compatible base
  routerModel: string;
  routerKey: string;
  apiWorkflow: string; // WAN2.2.api.json contents (Save API Format)
  negative: string;
  width: number;
  height: number;
  fps: number;
  maxSeconds: number;
  steps: number;
  cfg: number;
  chainLastFrame: boolean;
  stylePrefix: string;
};

const DEFAULTS: Settings = {
  comfyUrl: "http://127.0.0.1:8188",
  voiceUrl: "http://127.0.0.1:8001/tts",
  voiceName: "default",
  voiceLang: "pt",
  routerUrl: "http://127.0.0.1:20128/v1",
  routerModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  routerKey: "",
  apiWorkflow: "",
  negative:
    "blurry, low quality, distorted, watermark, text artifacts, deformed",
  width: 512,
  height: 512,
  fps: 16,
  maxSeconds: 5,
  steps: 4,
  cfg: 1.5,
  chainLastFrame: false,
  stylePrefix:
    "Vox explainer style, flat editorial collage, paper texture, bold graphic shapes, archival cutouts, clean motion,",
};

const KEY = "ownmovie.settings.v1";
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
