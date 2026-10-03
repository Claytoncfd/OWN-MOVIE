import plano from "@/data/workflows/01_PLANO.api.json";
import voz from "@/data/workflows/02_VOZ.api.json";
import cena from "@/data/workflows/02_CENA.api.json";
import final from "@/data/workflows/03_FINAL.api.json";
import { setInputs, type ApiWorkflow } from "./comfy";
import { getSettings } from "./settings";
import { projectSlug } from "./own-movie";

/** Os templates vêm de scripts/build-workflows.py. Aqui só se preenchem entradas; não há lógica de pipeline. */
const clone = (w: unknown) => JSON.parse(JSON.stringify(w)) as ApiWorkflow;

export function planWorkflow(p: {
  project: string;
  text: string;
  mode: "fragmentos" | "unico";
}) {
  const s = getSettings();
  const wf = clone(plano);
  setInputs(wf, "1", { text: p.text, mode: p.mode });
  setInputs(wf, "2", {
    base_url: s.routerUrl,
    planner_model: s.routerModel,
    emotion_model: s.routerModel,
  });
  setInputs(wf, "3", { style_hint: "" });
  setInputs(wf, "5", { project_name: projectSlug(p.project) });
  if (!s.useEmotion) {
    delete wf["4"];
    setInputs(wf, "5", { scenes: ["3", 0] });
  }
  return wf;
}

const sceneLoad = (
  wf: ApiWorkflow,
  project: string,
  index: number,
  seedBase: number,
) => {
  const s = getSettings();
  setInputs(wf, "300", {
    project_name: projectSlug(project),
    scene_index: index,
    style_prefix: s.stylePrefix,
    negative_default: s.negative,
    seed_base: seedBase,
    chain_last_frame: s.chainLastFrame,
  });
};

const voice = (wf: ApiWorkflow, id: string) => {
  const s = getSettings();
  setInputs(wf, id, { language: s.voiceLang, voice: s.voiceName });
};

/** Fase de áudio: só carrega a cena e gera a narração (cache em disco). Roda antes de ocupar a GPU com vídeo. */
export function voiceWorkflow(p: { project: string; index: number }) {
  const wf = clone(voz);
  const s = getSettings();
  setInputs(wf, "1", {
    project_name: projectSlug(p.project),
    scene_index: p.index,
    style_prefix: s.stylePrefix,
    negative_default: s.negative,
  });
  setInputs(wf, "2", { language: s.voiceLang, voice: s.voiceName });
  return wf;
}

/** Vídeo de uma cena: Wan 2.2 + OmniVoice (em cache) + mux. `seedBase` novo = "refazer". */
export function sceneWorkflow(p: {
  project: string;
  index: number;
  seedBase: number;
}) {
  const s = getSettings();
  const wf = clone(cena);
  sceneLoad(wf, p.project, p.index, p.seedBase);
  voice(wf, "301");
  setInputs(wf, "302", { max_seconds: s.maxSeconds });
  setInputs(wf, "74:64", { value: s.width });
  setInputs(wf, "74:65", { value: s.height });
  setInputs(wf, "74:66", { value: s.fps });
  setInputs(wf, "7", { steps: s.steps, cfg: s.cfg });
  return wf;
}

export function finalWorkflow(project: string) {
  const wf = clone(final);
  setInputs(wf, "1", { project_name: projectSlug(project) });
  return wf;
}
