import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { WorkflowCanvas } from "@/components/WorkflowCanvas";
import { Button } from "@/components/ui/button";
import { stats, realValues } from "@/lib/workflow";
import { useLogs } from "@/lib/logs";
import { useProject } from "@/lib/pipeline";
import { setSettings, useSettings } from "@/lib/settings";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ComfyUI WAN2.2 — OWN MOVIE" },
      { name: "description", content: "Canvas real do workflow WAN2.2 do ComfyUI: 55 nodes, 37 links, 11 grupos, integrado aos agentes do OWN MOVIE." },
      { property: "og:title", content: "ComfyUI WAN2.2 — OWN MOVIE" },
      { property: "og:description", content: "Workflow real do ComfyUI dentro da plataforma OWN MOVIE." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Studio,
});

const TABS = ["Workflow", "Modelo", "Configurações", "Logs"] as const;

export const AGENTS = [
  ["Hermes Agent", "Planejamento e decisões"],
  ["OmniRoute", "Roteamento de LLM · :20128"],
  ["OmniVoice", "Voz / TTS · :8001"],
  ["Vision Agent", "Análise de frames"],
  ["Project Agent", "Cenas, prompts, versões"],
  ["File Agent", "Arquivos e limpeza"],
];

function Studio() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Workflow");
  const logs = useLogs();
  const project = useProject();
  const s = useSettings();
  const last = [...project.scenes].reverse().find((x) => x.videoUrl);

  function loadFile() {
    const i = document.createElement("input");
    i.type = "file"; i.accept = ".json";
    i.onchange = async () => { const f = i.files?.[0]; if (f) setSettings({ apiWorkflow: await f.text() }); };
    i.click();
  }

  return (
    <AppShell>
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold">ComfyUI — WAN2.2.json (posições, grupos e links originais)</h1>
          <span className="font-mono text-xs text-muted-foreground">{stats.nodes} nodes · {stats.links} links · {stats.groups} grupos · {stats.subgraphs} subgraphs</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={loadFile}>Carregar</Button>
            <Button variant="outline" asChild><a href={`data:application/json,${encodeURIComponent(s.apiWorkflow || "{}")}`} download="WAN2.2.api.json">Salvar</a></Button>
            <Button asChild><Link to="/projetos">Executar</Link></Button>
          </div>
        </div>
        <div className="mt-3 flex gap-1 border-b">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm ${tab === t ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}>{t}</button>
          ))}
        </div>
        <div className="mt-3">
          {tab === "Workflow" && <WorkflowCanvas />}
          {tab === "Modelo" && (
            <div className="grid gap-2 font-mono text-sm md:grid-cols-2">
              {Object.entries(realValues).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 rounded border px-3 py-2"><span className="text-muted-foreground">{k}</span><span className="truncate">{String(v)}</span></div>
              ))}
            </div>
          )}
          {tab === "Configurações" && (
            <div className="space-y-2 text-sm">
              <p>Workflow API: {s.apiWorkflow ? <span className="text-ok">carregado ({(s.apiWorkflow.length / 1024).toFixed(0)} KB)</span> : <span className="text-warn">não carregado</span>}</p>
              <p className="text-muted-foreground">No ComfyUI, abra o WAN2.2.json e use “Export (API)”. Carregue o arquivo aqui ou em Configurações.</p>
              <Button variant="outline" asChild><Link to="/configuracoes">Abrir configurações</Link></Button>
            </div>
          )}
          {tab === "Logs" && <LogView lines={logs} />}
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <Panel title="Agentes IA">
          <div className="grid grid-cols-2 gap-2">
            {AGENTS.map(([n, d]) => (
              <div key={n} className="rounded-md bg-background/50 p-2"><div className="text-sm font-semibold">{n}</div><div className="text-xs text-muted-foreground">{d}</div></div>
            ))}
          </div>
        </Panel>
        <Panel title="Ferramentas e modelos">
          <ul className="space-y-1.5 text-sm text-foreground/80">
            <li>ComfyUI · Wan 2.2 GGUF</li><li>OmniVoice (TTS)</li><li>LLM local via OmniRoute</li><li>Player VOX / export no navegador</li>
          </ul>
          <h3 className="panel-title mb-2 mt-4">Projetos</h3>
          <p className="text-sm text-foreground/80">{project.name} · {project.scenes.length} cenas</p>
          <Button className="mt-3 w-full" asChild><Link to="/projetos">Novo projeto</Link></Button>
        </Panel>
        <Panel title="Preview / Saída">
          <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md border border-dashed text-center text-sm text-muted-foreground">
            {last?.videoUrl ? <video src={last.videoUrl} controls loop className="h-full" /> : "[Preview do MP4 gerado]\nWan/Video_00001.mp4"}
          </div>
          <Button variant="outline" className="mt-3 w-full" asChild><Link to="/projetos">Abrir Player VOX</Link></Button>
        </Panel>
        <Panel title="Informações do workflow">
          {[["Arquivo", "WAN2.2.json"], ["Formato", `ComfyUI ${stats.format}`], ["Frontend", stats.frontend], ["Modos", "t2v · i2v"], ["Tamanho", "142 KB"], ["Subgraphs", String(stats.subgraphs)], ["Sampler", `${realValues.sampler} / ${realValues.scheduler}`], ["Steps / CFG", `${realValues.steps} / ${realValues.cfg}`]].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 text-sm"><span className="text-muted-foreground">{k}</span><span className="font-mono">{v}</span></div>
          ))}
        </Panel>
      </div>
    </AppShell>
  );
}

export function LogView({ lines }: { lines: { t: string; src: string; msg: string; level: string }[] }) {
  return (
    <div className="h-80 overflow-auto rounded-md border bg-background p-3 font-mono text-xs">
      {lines.length === 0 && <div className="text-muted-foreground">Sem eventos ainda.</div>}
      {lines.map((l, i) => (
        <div key={i} className={l.level === "err" ? "text-destructive" : l.level === "ok" ? "text-ok" : ""}>[{l.t}] <span className="text-cyan">{l.src}</span> {l.msg}</div>
      ))}
    </div>
  );
}
