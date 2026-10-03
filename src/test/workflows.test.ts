import { beforeEach, describe, expect, it } from "vitest";
import { setInputs, type ApiWorkflow } from "@/lib/comfy";
import { setSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import {
  finalWorkflow,
  planWorkflow,
  sceneWorkflow,
  voiceWorkflow,
} from "@/lib/workflows";

beforeEach(() => setSettings({ ...DEFAULT_SETTINGS }));

describe("workflows", () => {
  it("plano preenche texto, modo, modelo e projeto", () => {
    const wf = planWorkflow({
      project: "Meu Filme!",
      text: "A\n\nB",
      mode: "fragmentos",
    });
    expect(wf["1"]?.inputs).toMatchObject({
      text: "A\n\nB",
      mode: "fragmentos",
    });
    expect(wf["2"]?.inputs["planner_model"]).toBe(DEFAULT_SETTINGS.routerModel);
    expect(wf["5"]?.inputs["project_name"]).toBe("Meu_Filme"); // mesmo slug que o servidor usa
    expect(wf["4"]?.class_type).toBe("OwnMovieAgentEmotion");
  });

  it("sem Agente Emoção, o projeto é salvo direto do Planner", () => {
    setSettings({ useEmotion: false });
    const wf = planWorkflow({ project: "p", text: "A", mode: "unico" });
    expect(wf["4"]).toBeUndefined();
    expect(wf["5"]?.inputs["scenes"]).toEqual(["3", 0]);
  });

  it("cena: parâmetros de render chegam nos nós certos e os fios do pipeline continuam ligados", () => {
    setSettings({
      width: 640,
      height: 384,
      fps: 24,
      steps: 6,
      cfg: 2,
      maxSeconds: 4,
      chainLastFrame: true,
    });
    const wf = sceneWorkflow({ project: "p", index: 3, seedBase: 99 });
    expect(wf["300"]?.inputs).toMatchObject({
      scene_index: 3,
      seed_base: 99,
      chain_last_frame: true,
    });
    expect(wf["74:64"]?.inputs["value"]).toBe(640);
    expect(wf["74:65"]?.inputs["value"]).toBe(384);
    expect(wf["74:66"]?.inputs["value"]).toBe(24);
    expect(wf["7"]?.inputs).toMatchObject({ steps: 6, cfg: 2 });
    expect(wf["302"]?.inputs["max_seconds"]).toBe(4);
    // fios: segundos vêm da duração do áudio, prompts vêm da cena, clipe usa o áudio do OmniVoice
    expect(wf["74:85"]?.inputs["value"]).toEqual(["302", 0]);
    expect(wf["12"]?.inputs["text"]).toEqual(["300", 1]);
    expect(wf["304"]?.inputs["audio"]).toEqual(["301", 0]);
  });

  it("voz e final", () => {
    expect(
      voiceWorkflow({ project: "p", index: 2 })["1"]?.inputs["scene_index"],
    ).toBe(2);
    expect(finalWorkflow("p")["1"]?.inputs["project_name"]).toBe("p");
  });

  it("não usa mais lógica herdada: sem VHS_VideoCombine, LoadImage nem nó 200", () => {
    const classes = Object.values(
      sceneWorkflow({ project: "p", index: 0, seedBase: 1 }),
    ).map((n) => n.class_type);
    expect(classes).not.toContain("VHS_VideoCombine");
    expect(classes).not.toContain("LoadImage");
    expect(classes).not.toContain("OwnMovieExcerpt");
  });

  it("setInputs falha alto com template desatualizado", () => {
    const wf: ApiWorkflow = { "1": { class_type: "X", inputs: { a: 1 } } };
    expect(() => setInputs(wf, "9", { a: 2 })).toThrow(/build-workflows/);
    expect(() => setInputs(wf, "1", { zzz: 2 })).toThrow(/zzz/);
  });
});
