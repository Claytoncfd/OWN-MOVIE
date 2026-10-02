import { getSettings } from "./settings";

export type ScenePlan = { narration: string; prompt: string };

/** Fragmenta o texto: blocos separados por linha em branco ou '---' viram cenas; texto único é dividido por frases. */
export function splitText(text: string, mode: "fragmentos" | "unico"): string[] {
  const t = text.trim();
  if (!t) return [];
  if (mode === "fragmentos") {
    return t.split(/\n\s*(?:---+)?\s*\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  const sentences = t.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*/g) ?? [t];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > 180 && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Hermes (planner) via OmniRoute: gera o prompt visual de cada fala. Fallback local se indisponível. */
export async function planScenes(chunks: string[], onLog: (m: string) => void): Promise<ScenePlan[]> {
  const s = getSettings();
  try {
    const r = await fetch(`${s.routerUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(s.routerKey ? { Authorization: `Bearer ${s.routerKey}` } : {}),
      },
      body: JSON.stringify({
        model: s.routerModel,
        messages: [
          {
            role: "system",
            content:
              "Você é o Hermes Planner do OWN MOVIE. Para cada narração recebida, escreva um prompt visual curto em inglês (máx 40 palavras) para o Wan 2.2 text-to-video, no estilo de explicador Vox (colagem editorial, recortes, formas gráficas, movimento de câmera suave). Responda APENAS um JSON array de strings, na mesma ordem.",
          },
          { role: "user", content: JSON.stringify(chunks) },
        ],
      }),
    });
    if (!r.ok) throw new Error(`OmniRoute ${r.status}`);
    const j = await r.json();
    const txt: string = j.choices?.[0]?.message?.content ?? "";
    const arr = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1)) as string[];
    onLog(`Hermes/OmniRoute planejou ${arr.length} prompts visuais`);
    return chunks.map((c, i) => ({ narration: c, prompt: arr[i] ?? c }));
  } catch (e) {
    onLog(`OmniRoute indisponível (${(e as Error).message}) — usando prompt direto do texto`);
    return chunks.map((c) => ({ narration: c, prompt: c }));
  }
}

/** OmniVoice TTS. Aceita resposta binária de áudio, JSON {audio: base64} ou JSON {url}. */
export async function synthesize(text: string): Promise<{ url: string; blob: Blob; duration: number }> {
  const s = getSettings();
  const r = await fetch(s.voiceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: s.voiceName, language: s.voiceLang }),
  });
  if (!r.ok) throw new Error(`OmniVoice ${r.status}: ${(await r.text()).slice(0, 200)}`);
  let blob: Blob;
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("json")) {
    const j = await r.json();
    if (j.url) blob = await (await fetch(j.url)).blob();
    else if (j.audio) blob = await (await fetch(`data:audio/wav;base64,${j.audio}`)).blob();
    else throw new Error("Resposta do OmniVoice sem áudio");
  } else blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const duration = await new Promise<number>((res) => {
    const a = new Audio(url);
    a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : 3);
    a.onerror = () => res(3);
  });
  return { url, blob, duration };
}
