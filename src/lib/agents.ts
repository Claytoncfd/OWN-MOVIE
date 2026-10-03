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
  const payload = {
    model: s.routerModel,
    messages: [
      {
        role: "system",
        content:
          "Você é o Hermes Planner do OWN MOVIE. Para cada narração recebida, escreva um prompt visual curto em inglês (máx 40 palavras) para o Wan 2.2 text-to-video, no estilo de explicador Vox (colagem editorial, recortes, formas gráficas, movimento de câmera suave). Responda APENAS um JSON array de strings, na mesma ordem.",
      },
      { role: "user", content: JSON.stringify(chunks) },
    ],
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(s.routerKey ? { Authorization: `Bearer ${s.routerKey}` } : {}),
  };
  const parsePlans = (txt: string): string[] =>
    JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1)) as string[];
  // 1) OmniRoute direto (opensource/omniroute :20128)
  try {
    const r = await fetch(`${s.routerUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`OmniRoute ${r.status}`);
    const j = await r.json();
    const txt: string = j.choices?.[0]?.message?.content ?? "";
    const arr = parsePlans(txt);
    onLog(`Hermes/OmniRoute planejou ${arr.length} prompts visuais`);
    return chunks.map((c, i) => ({ narration: c, prompt: arr[i] ?? c }));
  } catch (directErr) {
    // 2) Bridge real (:8000 → OmniRoute). Se o bridge também falhar, fallback local honesto.
    try {
      const r = await fetch("http://127.0.0.1:8000/api/router-chat", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`bridge ${r.status}`);
      const j = await r.json();
      const txt: string = j.choices?.[0]?.message?.content ?? "";
      const arr = parsePlans(txt);
      onLog(`Hermes/bridge planejou ${arr.length} prompts visuais`);
      return chunks.map((c, i) => ({ narration: c, prompt: arr[i] ?? c }));
    } catch {
      onLog(`OmniRoute indisponível (${(directErr as Error).message}) — usando prompt direto do texto. Suba com: bash scripts/start-localhost.sh router`);
      return chunks.map((c) => ({ narration: c, prompt: c }));
    }
  }
}

/** OmniVoice TTS real (opensource/omnivoice :8001). Aceita resposta binária de áudio,
 *  JSON {audio: base64} ou JSON {url}. Sem mock: offline retorna 503 com o comando real. */
export async function synthesize(text: string): Promise<{ url: string; blob: Blob; duration: number }> {
  const s = getSettings();
  const body = JSON.stringify({ text, voice: s.voiceName, language: s.voiceLang });
  let r: Response;
  async function viaBridge(): Promise<Response> {
    return fetch("http://127.0.0.1:8000/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  }
  try {
    r = await fetch(s.voiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    // Demo Gradio (:8001) não expõe POST /tts → cai para o bridge (CLI real).
    if (r.status === 404) r = await viaBridge();
  } catch {
    // Queda de rede/CORS → tenta o bridge real (:8000 → OmniVoice)
    try {
      r = await viaBridge();
    } catch {
      throw new Error("OmniVoice offline. Suba com: bash scripts/start-localhost.sh voice  (omnivoice-demo --ip 127.0.0.1 --port 8001)");
    }
  }
  if (r.status === 503 || r.status === 502) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j.hint as string) ?? (j.error as string) ?? `OmniVoice ${r.status}`);
  }
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
