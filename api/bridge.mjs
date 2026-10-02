// OWN MOVIE bridge — http://127.0.0.1:8000
// Ponte REAL entre a UI (TanStack Start) e as ferramentas em opensource/:
//   ComfyUI (8188) · OmniVoice (8001) · OmniRoute (20128)
// Sem mocks: se o serviço real estiver offline, responde 503 com o comando exato para subir.
// Zero dependências — só Node 18+ stdlib. Binda APENAS em 127.0.0.1.
import http from "node:http";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadConfig() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, "config/localhost.json"), "utf8"));
  } catch {
    return { services: {} };
  }
}
const cfg = loadConfig();
const PORT = Number(process.env.BRIDGE_PORT ?? 8000);
const COMFY = (process.env.COMFY_URL ?? cfg.services?.comfyui?.url ?? "http://127.0.0.1:8188").replace(/\/$/, "");
const VOICE = process.env.OMNIVOICE_URL ?? cfg.services?.omnivoice?.tts ?? "http://127.0.0.1:8001/tts";
const VOICE_ORIGIN = VOICE.replace(/\/tts\/?$/, "");
const ROUTER = (process.env.OMNIROUTE_URL ?? cfg.services?.omniroute?.openaiBase ?? "http://127.0.0.1:20128/v1").replace(/\/$/, "");

const VOICE_BIN = process.env.OMNIVOICE_BIN ?? "/home/cfd/.venvs/omnivoice/bin/omnivoice-infer";
const VOICE_MODEL = process.env.OMNIVOICE_MODEL ?? "k2-fsa/OmniVoice";

/** Síntese REAL via CLI do OmniVoice (opensource/omnivoice). Sem mock. */
function cliSynthesize(text, language) {
  if (!existsSync(VOICE_BIN)) {
    return { error: `CLI do OmniVoice ausente (${VOICE_BIN}). Suba com: bash scripts/start-localhost.sh voice` };
  }
  const dir = mkdtempSync(join(tmpdir(), "ownmovie-tts-"));
  const out = join(dir, "voz.wav");
  try {
    const args = ["--model", VOICE_MODEL, "--text", text.slice(0, 2000), "--output", out];
    if (language) args.push("--language", language);
    const ref = process.env.OMNIVOICE_REF_AUDIO;
    if (ref && existsSync(ref)) args.push("--ref_audio", ref);
    const r = spawnSync(VOICE_BIN, args, { timeout: 420000, encoding: "utf8" });
    if (r.status !== 0 || !existsSync(out)) {
      return { error: `omnivoice-infer falhou: ${(r.stderr ?? "").slice(-300) || `exit ${r.status}`}` };
    }
    return { file: out, dir };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const HINTS = {
  comfy: "Suba o ComfyUI real: cd opensource/comfyui && python3 main.py --listen 127.0.0.1 --port 8188 --enable-cors-header",
  voice: "Suba o OmniVoice real: omnivoice-demo --ip 127.0.0.1 --port 8001  (ou uvx/pip em opensource/omnivoice)",
  router: "Suba o OmniRoute real: bash scripts/start-localhost.sh router  (cd opensource/omniroute && npm start)",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function check(url, ms = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    // 401 no OmniRoute = serviço no ar pedindo chave (ok). Demais 4xx/5xx = problema real.
    const online = r.ok || r.status === 401;
    return { online, status: r.status };
  } catch (e) {
    return { online: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1:8000");
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- GET /api/health — estado REAL dos 3 serviços ----
  if (req.method === "GET" && u.pathname === "/api/health") {
    const [comfy, voice, router] = await Promise.all([
      check(`${COMFY}/system_stats`),
      check(VOICE_ORIGIN),
      check(`${ROUTER}/models`),
    ]);
    return json(res, 200, {
      ok: true,
      bridge: "http://127.0.0.1:8000",
      comfy: { url: COMFY, ...comfy, hint: comfy.online ? undefined : HINTS.comfy },
      omnivoice: { url: VOICE, ...voice, hint: voice.online ? undefined : HINTS.voice },
      omniroute: { url: ROUTER, ...router, hint: router.online ? undefined : HINTS.router },
    });
  }

  // ---- GET /api/workflow-api — export API local gerado por scripts/export-api-format.py ----
  if (req.method === "GET" && u.pathname === "/api/workflow-api") {
    const p = resolve(ROOT, "workflows/WAN2.2.api.json");
    if (!existsSync(p)) {
      return json(res, 404, {
        error: "workflows/WAN2.2.api.json ainda não gerado",
        hint: "Rode: python3 scripts/export-api-format.py",
      });
    }
    cors(res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(readFileSync(p));
    return;
  }

  // ---- POST /api/tts — OmniVoice REAL: HTTP direto, senão CLI local (sem áudio falso) ----
  if (req.method === "POST" && u.pathname === "/api/tts") {
    const body = await readBody(req);
    let wantCli = false;
    try {
      const r = await fetch(VOICE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        cors(res);
        res.writeHead(200, { "Content-Type": r.headers.get("content-type") ?? "audio/wav" });
        res.end(buf);
        return;
      }
      if (r.status !== 404) {
        const t = await r.text().catch(() => "");
        return json(res, 502, { error: `OmniVoice ${r.status}: ${t.slice(0, 200)}`, voice: VOICE });
      }
      wantCli = true; // demo Gradio não expõe POST /tts → usa o CLI real
    } catch {
      wantCli = true; // offline/conexão recusada → usa o CLI real
    }
    let text = "", language = "";
    try {
      const j = JSON.parse(body.toString("utf8"));
      text = String(j.text ?? "");
      language = String(j.language ?? j.voiceLang ?? "");
    } catch { /* corpo inválido */ }
    if (!text.trim()) return json(res, 400, { error: "campo text vazio" });
    const out = cliSynthesize(text, language);
    if (out.error) return json(res, 503, { error: out.error, hint: HINTS.voice, voice: VOICE });
    try {
      const buf = readFileSync(out.file);
      cors(res);
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end(buf);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
    return;
  }

  // ---- POST /api/router-chat — repasse REAL para OmniRoute /v1/chat/completions ----
  if (req.method === "POST" && u.pathname === "/api/router-chat") {
    const body = await readBody(req);
    try {
      const r = await fetch(`${ROUTER}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.headers.authorization ? { Authorization: String(req.headers.authorization) } : {}),
        },
        body,
      });
      const buf = Buffer.from(await r.arrayBuffer());
      cors(res);
      res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") ?? "application/json" });
      res.end(buf);
    } catch {
      return json(res, 503, { error: "OmniRoute offline", hint: HINTS.router, router: ROUTER });
    }
    return;
  }

  // ---- Proxy REAL do ComfyUI (resolve CORS do navegador → 8188) ----
  if (u.pathname.startsWith("/api/comfy/")) {
    const target = `${COMFY}${u.pathname.slice("/api/comfy".length)}${u.search}`;
    try {
      const headers = { "Content-Type": req.headers["content-type"] ?? "application/json" };
      const init = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") init.body = await readBody(req);
      const r = await fetch(target, init);
      const buf = Buffer.from(await r.arrayBuffer());
      cors(res);
      res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") ?? "application/json" });
      res.end(buf);
    } catch {
      return json(res, 503, { error: "ComfyUI offline", hint: HINTS.comfy, comfy: COMFY });
    }
    return;
  }

  if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/api")) {
    const hasWorkflow = existsSync(resolve(ROOT, "workflows/WAN2.2.json"));
    return json(res, 200, {
      ok: true,
      name: "OWN MOVIE bridge",
      docs: "UI :3000 → bridge :8000 → ComfyUI :8188 · OmniVoice :8001 · OmniRoute :20128",
      workflow: hasWorkflow ? "workflows/WAN2.2.json" : "ausente",
      endpoints: ["GET /api/health", "GET /api/workflow-api", "POST /api/tts", "POST /api/router-chat", "ALL /api/comfy/*"],
    });
  }
  return json(res, 404, { error: "rota desconhecida" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ownmovie-bridge] http://127.0.0.1:${PORT} → comfy ${COMFY} · voice ${VOICE} · router ${ROUTER}`);
});
