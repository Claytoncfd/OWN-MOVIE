import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFinal,
  generatePlan,
  getProject,
  renderAll,
  updateDraft,
} from "@/lib/pipeline";
import { DEFAULT_SETTINGS, setSettings } from "@/lib/settings";

type Scene = {
  index: number;
  id: string;
  has_audio: boolean;
  has_clip: boolean;
};
let queued: { kind: string; index: number | null }[];
let scenes: Scene[];
let failNext: string | null;

function kindOf(
  wf: Record<string, { class_type: string; inputs: Record<string, unknown> }>,
) {
  const cls = Object.values(wf).map((n) => n.class_type);
  const idx = Object.values(wf).find(
    (n) => n.class_type === "OwnMovieSceneLoad",
  )?.inputs["scene_index"] as number | undefined;
  if (cls.includes("OwnMovieSceneMux")) return ["video", idx ?? null] as const;
  if (cls.includes("OwnMovieOmniVoice")) return ["voz", idx ?? null] as const;
  if (cls.includes("OwnMovieFinalConcat")) return ["final", null] as const;
  return ["plano", null] as const;
}

beforeEach(() => {
  queued = [];
  scenes = [];
  failNext = null;
  setSettings({ ...DEFAULT_SETTINGS });
  updateDraft({ name: "p", text: "Um.\n\nDois.", mode: "fragmentos" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (o: unknown, status = 200) =>
        new Response(JSON.stringify(o), { status });
      if (url.endsWith("/prompt")) {
        const [kind, index] = kindOf(JSON.parse(String(init?.body)).prompt);
        queued.push({ kind, index });
        if (kind === "plano")
          scenes = [0, 1].map((i) => ({
            index: i,
            id: `c00${i + 1}`,
            has_audio: false,
            has_clip: false,
          }));
        if (kind === "voz") scenes[index!]!.has_audio = true;
        if (kind === "video") scenes[index!]!.has_clip = true;
        return json({ prompt_id: `id${queued.length}` });
      }
      if (url.includes("/history/")) {
        const id = url.split("/").pop()!;
        return json({
          [id]: {
            status: failNext
              ? {
                  status_str: "error",
                  messages: [
                    [
                      "execution_error",
                      { node_type: failNext, exception_message: "falhou" },
                    ],
                  ],
                }
              : { status_str: "success" },
          },
        });
      }
      if (url.includes("/own_movie/project/")) {
        if (!scenes.length)
          return json({ error: "Projeto 'p' não tem scenes.json" }, 404);
        return json({
          project: "p",
          final: null,
          scenes: scenes.map((s) => ({
            ...s,
            text: "",
            narration: "",
            prompt: "x",
            tone: "",
            pace: "",
            warnings: [],
            has_last_frame: false,
            audio: null,
            clip: null,
          })),
        });
      }
      return json({}, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("pipeline (ComfyUI simulado)", () => {
  it("plano → voz de todas → vídeo de cada cena → final, na ordem certa", async () => {
    await generatePlan();
    expect(getProject().scenes).toHaveLength(2);
    await renderAll();
    await buildFinal();
    expect(queued.map((q) => `${q.kind}${q.index ?? ""}`)).toEqual([
      "plano",
      "voz0",
      "voz1",
      "video0",
      "video1",
      "final",
    ]);
    expect(getProject().phase).toBe("idle");
  });

  it("retoma: cenas que já têm clipe não são refeitas", async () => {
    await generatePlan();
    scenes[0]!.has_audio = scenes[0]!.has_clip = true;
    queued = [];
    await renderAll();
    expect(queued.map((q) => `${q.kind}${q.index ?? ""}`)).toEqual([
      "voz1",
      "video1",
    ]);
  });

  it("erro de node vira mensagem na tela e o pipeline volta a ficar livre", async () => {
    await generatePlan();
    failNext = "OwnMovieOmniVoice";
    await renderAll();
    expect(getProject().error).toMatch(/OwnMovieOmniVoice: falhou/);
    expect(getProject().phase).toBe("idle");
  });
});
