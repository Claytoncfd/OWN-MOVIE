import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import logo from "@/assets/ownmovie_logo.png.asset.json";
import { systemStats } from "@/lib/comfy";
import { useSettings } from "@/lib/settings";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/projetos", label: "Projetos" },
  { to: "/agentes", label: "Agentes IA" },
  { to: "/", label: "ComfyUI" },
  { to: "/omnivoice", label: "OmniVoice" },
  { to: "/modelos", label: "Modelos" },
  { to: "/arquivos", label: "Arquivos" },
  { to: "/configuracoes", label: "Configurações" },
] as const;

const gb = (b?: number) => (b == null ? "—" : (b / 1024 ** 3).toFixed(1));

export function useHardware() {
  const s = useSettings();
  return useQuery({
    queryKey: ["system_stats", s.comfyUrl],
    queryFn: systemStats,
    refetchInterval: 4000,
    retry: false,
  });
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-panel px-3 py-1.5 font-mono text-[11px] leading-tight">
      <div className="text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const hw = useHardware();
  const dev = hw.data?.devices?.[0];
  const sys = hw.data?.system;
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-6 border-b px-4 py-3">
        <Link to="/" className="flex items-center gap-3">
          <img src={logo.url} alt="OWN MOVIE" className="h-11 w-11 rounded-md bg-foreground object-contain p-0.5" />
          <div>
            <div className="font-display text-xl font-bold tracking-wide text-cyan">OWN MOVIE</div>
            <div className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">AI VIDEO PRODUCTION PLATFORM</div>
          </div>
        </Link>
        <nav className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: true }}
              className="rounded-md border border-transparent px-3 py-2 text-sm text-foreground/80 hover:text-foreground"
              activeProps={{ className: "!border-primary bg-accent !text-foreground" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex gap-2">
          <Chip
            label="GPU · VRAM"
            value={dev ? `${gb(dev.vram_total - dev.vram_free)} / ${gb(dev.vram_total)} GB` : hw.isError ? "offline" : "…"}
          />
          <Chip
            label="RAM"
            value={sys?.ram_total ? `${gb(sys.ram_total - (sys.ram_free ?? 0))} / ${gb(sys.ram_total)} GB` : "—"}
          />
          <Chip label="CPU" value={dev ? dev.name.split(":")[0].slice(0, 14) : "—"} />
          <Chip label="ComfyUI" value={hw.isSuccess ? "● online" : "○ offline"} />
        </div>
      </header>
      <main className="p-4">{children}</main>
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border bg-panel p-4 ${className}`}>
      {title && <h3 className="panel-title mb-3">{title}</h3>}
      {children}
    </section>
  );
}
