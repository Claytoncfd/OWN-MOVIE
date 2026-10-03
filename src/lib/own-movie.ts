import { getSettings } from "./settings";
import type { FileRef } from "./comfy";

/** Rotas do pacote custom_nodes/OWN_MOVIE, servidas pelo próprio ComfyUI (substituem o bridge :8000). */
const base = () => getSettings().comfyUrl.replace(/\/$/, "");

export type ServerScene = {
  id: string;
  index: number;
  text: string;
  narration: string;
  prompt: string;
  tone: string;
  pace: string;
  warnings: string[];
  has_audio: boolean;
  has_clip: boolean;
  has_last_frame: boolean;
  audio: FileRef | null;
  clip: FileRef | null;
};
export type ProjectStatus = {
  project: string;
  scenes: ServerScene[];
  final: FileRef | null;
};
export type Health = {
  omniroute: { url: string; online: boolean };
  omnivoice: { online: boolean; hint?: string | null };
  ffmpeg: { online: boolean; hint?: string | null };
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base()}/own_movie${path}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

export const projectSlug = (name: string) =>
  name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);

export const listProjects = () =>
  call<{ projects: string[] }>(`/projects`).then((r) => r.projects);
export const getProjectStatus = (name: string) =>
  call<ProjectStatus>(`/project/${encodeURIComponent(projectSlug(name))}`);
export const getHealth = () => call<Health>(`/health`);
export const updateScene = (
  project: string,
  id: string,
  fields: Partial<Pick<ServerScene, "narration" | "prompt">>,
) =>
  call<{ ok: boolean }>(`/scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: projectSlug(project), id, fields }),
  });
