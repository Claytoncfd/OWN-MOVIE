import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { VoxPlayer } from "@/components/VoxPlayer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { buildScenes, patchScene, runPipeline, stopPipeline, updateProject, useProject, type StepState } from "@/lib/pipeline";
import { useLogs } from "@/lib/logs";
import { useSettings } from "@/lib/settings";
import { LogView } from "./index";

export const Route = createFileRoute("/projetos")({
  head: () => ({
    meta: [
      { title: "Projetos — Texto para áudio e vídeo VOX | OWN MOVIE" },
      { name: "description", content: "Cole um texto único ou fragmentado e transforme em narração OmniVoice e clipes WAN 2.2 no estilo VOX." },
      { property: "og:title", content: "Projetos — OWN MOVIE" },
      { property: "og:description", content: "Texto → áudio → vídeo estilo VOX com ComfyUI local." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Projetos,
});

const badge: Record<StepState, string> = { idle: "text-muted-foreground", run: "text-warn animate-pulse", ok: "text-ok", err: "text-destructive" };
const label: Record<StepState, string> = { idle: "aguardando", run: "processando", ok: "pronto", err: "erro" };

function Projetos() {
  const p = useProject();
  const s = useSettings();
  const logs = useLogs();
  const [planning, setPlanning] = useState(false);

  return (
    <AppShell>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Panel title="1 · Roteiro">
            <Input value={p.name} onChange={(e) => updateProject({ name: e.target.value })} className="mb-3" />
            <div className="mb-2 flex gap-2">
              {(["fragmentos", "unico"] as const).map((m) => (
                <Button key={m} size="sm" variant={p.mode === m ? "default" : "outline"} onClick={() => updateProject({ mode: m })}>
                  {m === "fragmentos" ? "Texto fragmentado" : "Texto único"}
                </Button>
              ))}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              {p.mode === "fragmentos" ? "Cada bloco separado por linha em branco (ou ---) vira uma cena." : "O texto é dividido automaticamente em cenas por frases (~180 caracteres)."}
            </p>
            <Textarea rows={10} value={p.text} onChange={(e) => updateProject({ text: e.target.value })} placeholder={"Em 1969, o homem pisou na Lua.\n\nMas a corrida espacial começou muito antes…"} />
            <Button className="mt-3" disabled={!p.text.trim() || planning || p.running} onClick={async () => { setPlanning(true); await buildScenes(); setPlanning(false); }}>
              {planning ? "Hermes planejando…" : "Gerar cenas"}
            </Button>
          </Panel>

          <Panel title={`2 · Cenas (${p.scenes.length})`}>
            {!s.apiWorkflow && (
              <div className="mb-3 rounded-md border border-warn/50 p-2 text-xs text-warn">
                Carregue o WAN2.2.api.json em <Link to="/configuracoes" className="underline">Configurações</Link> para executar no ComfyUI.
              </div>
            )}
            <div className="space-y-3">
              {p.scenes.map((sc, i) => (
                <div key={sc.id} className="rounded-lg border bg-background/40 p-3">
                  <div className="mb-1 flex items-center justify-between font-mono text-xs">
                    <span className="text-cyan">CENA {String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <span className={badge[sc.audio]}>áudio: {label[sc.audio]}{sc.duration ? ` ${sc.duration.toFixed(1)}s` : ""}</span> ·{" "}
                      <span className={badge[sc.video]}>vídeo: {label[sc.video]}{sc.video === "run" ? ` ${sc.elapsed ?? 0}s` : ""}</span>
                    </span>
                  </div>
                  <Textarea rows={2} value={sc.narration} onChange={(e) => patchScene(sc.id, { narration: e.target.value, audioUrl: undefined, audio: "idle" })} className="mb-1 text-sm" />
                  <Input value={sc.prompt} onChange={(e) => patchScene(sc.id, { prompt: e.target.value, video: "idle", videoUrl: undefined })} className="font-mono text-xs" />
                  {sc.error && <div className="mt-1 text-xs text-destructive">{sc.error}</div>}
                  <div className="mt-2 flex gap-2">
                    {sc.audioUrl && <audio src={sc.audioUrl} controls className="h-8" />}
                    {sc.videoUrl && <video src={sc.videoUrl} controls loop muted className="h-24 rounded" />}
                    {(sc.video === "err" || sc.video === "ok") && (
                      <Button size="sm" variant="outline" onClick={() => patchScene(sc.id, { video: "idle", videoUrl: undefined })}>Refazer vídeo</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {p.scenes.length > 0 && (
              <div className="mt-3 flex gap-2">
                <Button onClick={runPipeline} disabled={p.running}>{p.running ? "Executando…" : "Executar: áudio → vídeo"}</Button>
                {p.running && <Button variant="destructive" onClick={stopPipeline}>Cancelar</Button>}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="3 · Player VOX">
            <VoxPlayer scenes={p.scenes} title={p.name} />
          </Panel>
          <Panel title="Distribuição de hardware">
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              {[["GPU", "UNet Wan 2.2 + VAE tiled · 1 job por vez"], ["CPU", "OmniVoice TTS em paralelo, Hermes/OmniRoute, export"], ["RAM", "Offload GGUF, cache CLIP, buffers"], ["SSD", "Modelos mmap, output/, last frames"]].map(([k, v]) => (
                <div key={k} className="rounded-md border p-2"><div className="font-display font-semibold text-cyan">{k}</div><div className="text-muted-foreground">{v}</div></div>
              ))}
            </div>
          </Panel>
          <Panel title="Logs"><LogView lines={logs} /></Panel>
        </div>
      </div>
    </AppShell>
  );
}
