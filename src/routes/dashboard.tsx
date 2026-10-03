import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Panel, useHardware } from "@/components/AppShell";
import { ownMovieNodesInstalled, queueInfo } from "@/lib/comfy";
import { getHealth, type Health } from "@/lib/own-movie";
import { useProject } from "@/lib/pipeline";
import { useSettings } from "@/lib/settings";
import { AGENTS } from "@/components/LogView";
import { realValues } from "@/lib/workflow";

const PROFILES = [
  ["6 GB", "Q3_K", "Q3_K_M", "16 GB", "~4,6 min por 1 s (RTX 3050)"],
  ["8 GB", "Q4_K", "Q3_K_M", "32 GB", "Balanceado"],
  ["10 GB+", "Q5_K", "Q4_K_M", "32 GB+", "Mais qualidade"],
];

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — OWN MOVIE" },
      { name: "description", content: "Uso de GPU, RAM e fila do ComfyUI em tempo real na produção OWN MOVIE." },
      { property: "og:title", content: "Dashboard — OWN MOVIE" },
      { property: "og:description", content: "Métricas de hardware e jobs ativos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Bar({ label, used, total, unit }: { label: string; used?: number | undefined; total?: number | undefined; unit: string }) {
  const pct = used != null && total ? (used / total) * 100 : 0;
  return (
    <Panel>
      <div className="flex justify-between text-sm"><span className="font-display font-semibold">{label}</span><span className="font-mono">{total && used != null ? `${used.toFixed(1)} / ${total.toFixed(1)} ${unit}` : "—"}</span></div>
      <div className="mt-3 h-2 rounded-full bg-background"><div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
    </Panel>
  );
}

function Dashboard() {
  const hw = useHardware();
  const s = useSettings();
  const q = useQuery({ queryKey: ["queue", s.comfyUrl], queryFn: queueInfo, refetchInterval: 3000, retry: false });
  const p = useProject();
  const nodes = useQuery({ queryKey: ["own-nodes", s.comfyUrl], queryFn: ownMovieNodesInstalled, refetchInterval: 15000, retry: false });
  const health = useQuery({ queryKey: ["own-health", s.comfyUrl], queryFn: getHealth, refetchInterval: 8000, retry: false });
  const up = (key: string) => !!health.data?.[key as keyof Health]?.online;
  const d = hw.data?.devices?.[0];
  const G = 1024 ** 3;
  return (
    <AppShell>
      <div className="grid gap-4 md:grid-cols-2">
        <Bar label={`GPU · ${d?.name ?? "offline"}`} used={d ? (d.vram_total - d.vram_free) / G : undefined} total={d ? d.vram_total / G : undefined} unit="GB" />
        <Bar label="RAM" used={hw.data?.system.ram_total ? (hw.data.system.ram_total - (hw.data.system.ram_free ?? 0)) / G : undefined} total={hw.data?.system.ram_total ? hw.data.system.ram_total / G : undefined} unit="GB" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Panel title="Fila GPU (ComfyUI)"><div className="font-mono text-3xl">{q.data ? `${q.data.running} / ${q.data.pending}` : "—"}</div><div className="text-xs text-muted-foreground">executando / pendentes</div></Panel>
        <Panel title="Projeto ativo"><div className="text-lg">{p.name}</div><div className="text-xs text-muted-foreground">{p.scenes.filter((x) => x.has_clip).length}/{p.scenes.length} cenas renderizadas</div></Panel>
        <Panel title="Sistema"><div className="font-mono text-xs">Nodes OWN_MOVIE {nodes.data ? "● instalados" : "○ não encontrados"}<br />ComfyUI {hw.data?.system.comfyui_version ?? "—"}<br />Python {hw.data?.system.python_version?.split(" ")[0] ?? "—"}<br />{hw.data?.system.os ?? ""}</div></Panel>
      </div>
      <Panel title="Agentes IA" className="mt-4">
        <div className="grid gap-4 md:grid-cols-3">
          {AGENTS.map(([n, desc, long, key]) => (
            <div key={n} className="rounded-lg border bg-background/40 p-3">
              <div className="flex justify-between"><h3 className="font-display font-semibold">{n}</h3><span className={`text-xs ${up(key) ? "text-ok" : "text-destructive"}`}>{up(key) ? "● disponível" : "○ offline"}</span></div>
              <div className="text-xs text-cyan">{desc}</div>
              <p className="mt-2 text-sm text-muted-foreground">{long}</p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Instalados no workflow">
          {[["UNet (GGUF) · models/unet", realValues.unet], ["Text encoder · models/clip", realValues.clip], ["VAE · models/vae", realValues.vae], ["ModelSamplingSD3 shift", realValues.shift]].map(([k, v]) => (
            <div key={String(k)} className="border-b py-2 text-sm last:border-0"><div className="text-muted-foreground">{k}</div><div className="font-mono">{String(v)}</div></div>
          ))}
        </Panel>
        <Panel title="Perfis por VRAM">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th>VRAM</th><th>UNet</th><th>Encoder</th><th>RAM</th><th>Obs.</th></tr></thead>
            <tbody className="font-mono">{PROFILES.map((r) => <tr key={r[0]} className="border-t">{r.map((c) => <td key={c} className="py-2">{c}</td>)}</tr>)}</tbody>
          </table>
        </Panel>
      </div>
    </AppShell>
  );
}
