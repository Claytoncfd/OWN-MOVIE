import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { VoxPlayer } from "@/components/VoxPlayer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  buildFinal,
  generatePlan,
  isRunning,
  refresh,
  renderAll,
  stopPipeline,
  updateDraft,
  useProject,
} from "@/lib/pipeline";
import { updateScene, listProjects, type ServerScene } from "@/lib/own-movie";
import { viewUrl } from "@/lib/comfy";
import { useLogs } from "@/lib/logs";
import { LogView } from "@/components/LogView";

export const Route = createFileRoute("/projetos")({
  head: () => ({
    meta: [
      { title: "Projetos — Texto para áudio e vídeo VOX | OWN MOVIE" },
      {
        name: "description",
        content:
          "Cole um texto único ou fragmentado e gere cenas, narração OmniVoice e clipes WAN 2.2 no estilo VOX, tudo executado por nodes no ComfyUI.",
      },
      { property: "og:title", content: "Projetos — OWN MOVIE" },
      {
        property: "og:description",
        content: "Texto → áudio → vídeo estilo VOX com ComfyUI local.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Projetos,
});

const PHASE: Record<string, string> = {
  plan: "Planejando cenas",
  voice: "Gerando narração",
  video: "Renderizando vídeo",
  final: "Montando filme",
};

function SceneCard({
  sc,
  project,
  busy,
}: {
  sc: ServerScene;
  project: string;
  busy: boolean;
}) {
  const [narration, setNarration] = useState(sc.narration);
  const [prompt, setPrompt] = useState(sc.prompt);
  const [err, setErr] = useState("");
  useEffect(() => {
    setNarration(sc.narration);
    setPrompt(sc.prompt);
  }, [sc.narration, sc.prompt]);
  const dirty = narration !== sc.narration || prompt !== sc.prompt;
  async function save() {
    setErr("");
    try {
      await updateScene(project, sc.id, { narration, prompt });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="mb-1 flex items-center justify-between font-mono text-xs">
        <span className="text-cyan">
          CENA {String(sc.index + 1).padStart(2, "0")}
        </span>
        <span>
          <span className={sc.has_audio ? "text-ok" : "text-muted-foreground"}>
            áudio: {sc.has_audio ? "pronto" : "pendente"}
          </span>{" "}
          ·{" "}
          <span className={sc.has_clip ? "text-ok" : "text-muted-foreground"}>
            vídeo: {sc.has_clip ? "pronto" : "pendente"}
          </span>
        </span>
      </div>
      <Textarea
        rows={2}
        value={narration}
        onChange={(e) => setNarration(e.target.value)}
        className="mb-1 text-sm"
      />
      <Input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="font-mono text-xs"
      />
      {sc.tone && (
        <div className="mt-1 text-xs text-muted-foreground">
          tom: {sc.tone} · ritmo: {sc.pace}
        </div>
      )}
      {sc.warnings.map((w) => (
        <div key={w} className="mt-1 text-xs text-warn">
          {w}
        </div>
      ))}
      {err && <div className="mt-1 text-xs text-destructive">{err}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {sc.audio && <audio src={viewUrl(sc.audio)} controls className="h-8" />}
        {sc.clip && (
          <video
            src={viewUrl(sc.clip)}
            controls
            loop
            className="h-24 rounded"
          />
        )}
        {dirty && (
          <Button size="sm" disabled={busy} onClick={save}>
            Salvar edição
          </Button>
        )}
        {sc.has_clip && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => renderAll(sc.index)}
          >
            Refazer vídeo
          </Button>
        )}
      </div>
    </div>
  );
}

function Projetos() {
  const p = useProject();
  const logs = useLogs();
  const busy = isRunning(p);
  const [known, setKnown] = useState<string[]>([]);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [p.name]);
  useEffect(() => {
    listProjects()
      .then((names) => setKnown(names))
      .catch(() => undefined);
  }, []);
  const ready = p.scenes.filter((s) => s.clip);
  const pending = p.scenes.filter((s) => !s.has_clip).length;

  return (
    <AppShell>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <Panel title="1 · Roteiro">
            <div className="mb-3 flex gap-2">
              <Input
                value={p.name}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder="Nome do projeto"
                className="flex-1"
              />
              <select
                aria-label="Abrir projeto existente"
                value=""
                onChange={(e) => e.target.value && updateDraft({ name: e.target.value })}
                className="max-w-44 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Abrir…</option>
                {known.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-2 flex gap-2">
              {(["fragmentos", "unico"] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={p.mode === m ? "default" : "outline"}
                  onClick={() => updateDraft({ mode: m })}
                >
                  {m === "fragmentos" ? "Texto fragmentado" : "Texto único"}
                </Button>
              ))}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              {p.mode === "fragmentos"
                ? "Cada bloco separado por linha em branco (ou ---) vira uma cena."
                : "O texto é dividido automaticamente em cenas por frases (~180 caracteres)."}
            </p>
            <Textarea
              rows={10}
              value={p.text}
              onChange={(e) => updateDraft({ text: e.target.value })}
              placeholder={
                "Em 1969, o homem pisou na Lua.\n\nMas a corrida espacial começou muito antes…"
              }
            />
            <Button
              className="mt-3"
              disabled={!p.text.trim() || busy}
              onClick={generatePlan}
            >
              {p.phase === "plan" ? "Planejando…" : "Gerar cenas"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">
              Roda o workflow 01_PLANO no ComfyUI (nodes: Dividir roteiro →
              Planner → Emoção → Salvar projeto).
            </p>
          </Panel>

          <Panel title={`2 · Cenas (${p.scenes.length})`}>
            {p.scenes.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma cena ainda. Gere o plano acima ou abra um projeto em
                “Abrir…”.
              </p>
            )}
            <div className="space-y-3">
              {p.scenes.map((sc) => (
                <SceneCard key={sc.id} sc={sc} project={p.name} busy={busy} />
              ))}
            </div>
            {p.scenes.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => renderAll()}
                  disabled={busy || pending === 0}
                >
                  {busy && p.phase !== "plan" && p.phase !== "final"
                    ? "Executando…"
                    : pending === 0
                      ? "Todas as cenas prontas"
                      : `Renderizar ${pending} cena(s): voz → vídeo`}
                </Button>
                <Button
                  variant="outline"
                  onClick={buildFinal}
                  disabled={busy || ready.length !== p.scenes.length}
                >
                  Montar filme final
                </Button>
                {busy && (
                  <Button variant="destructive" onClick={stopPipeline}>
                    Cancelar
                  </Button>
                )}
              </div>
            )}
            {busy && (
              <div className="mt-2 font-mono text-xs text-warn">
                {PHASE[p.phase]} · {p.busy}
              </div>
            )}
            {p.error && (
              <div className="mt-2 text-sm text-destructive">{p.error}</div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="3 · Resultado">
            {p.final && (
              <div className="mb-3">
                <video
                  src={viewUrl(p.final)}
                  controls
                  className="w-full rounded-lg border"
                />
                <a
                  href={viewUrl(p.final)}
                  download
                  className="text-xs text-cyan underline"
                >
                  baixar final.mp4
                </a>
              </div>
            )}
            <VoxPlayer
              scenes={ready.map((s) => ({
                url: viewUrl(s.clip!),
                narration: s.narration,
              }))}
              title={p.name}
            />
          </Panel>
          <Panel title="Logs">
            <LogView lines={logs} />
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
