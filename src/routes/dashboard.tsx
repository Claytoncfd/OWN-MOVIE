import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Panel, useHardware } from "@/components/AppShell";
import { queueInfo } from "@/lib/comfy";
import { useProject } from "@/lib/pipeline";
import { useSettings } from "@/lib/settings";

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

function Bar({ label, used, total, unit }: { label: string; used?: number; total?: number; unit: string }) {
  const pct = used != null && total ? (used / total) * 100 : 0;
  return (
    <Panel>
      <div className="flex justify-between text-sm"><span className="font-display font-semibold">{label}</span><span className="font-mono">{total ? `${used!.toFixed(1)} / ${total.toFixed(1)} ${unit}` : "—"}</span></div>
      <div className="mt-3 h-2 rounded-full bg-background"><div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
    </Panel>
  );
}

function Dashboard() {
  const hw = useHardware();
  const s = useSettings();
  const q = useQuery({ queryKey: ["queue", s.comfyUrl], queryFn: queueInfo, refetchInterval: 3000, retry: false });
  const p = useProject();
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
        <Panel title="Projeto ativo"><div className="text-lg">{p.name}</div><div className="text-xs text-muted-foreground">{p.scenes.filter((x) => x.videoUrl).length}/{p.scenes.length} cenas renderizadas</div></Panel>
        <Panel title="Sistema"><div className="font-mono text-xs">ComfyUI {hw.data?.system.comfyui_version ?? "—"}<br />Python {hw.data?.system.python_version?.split(" ")[0] ?? "—"}<br />{hw.data?.system.os ?? ""}</div></Panel>
      </div>
    </AppShell>
  );
}
