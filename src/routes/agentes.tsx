import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Panel } from "@/components/AppShell";
import { AGENTS } from "@/components/LogView";
import { useSettings } from "@/lib/settings";

export const Route = createFileRoute("/agentes")({
  head: () => ({
    meta: [
      { title: "Agentes IA — OWN MOVIE" },
      { name: "description", content: "Hermes, OmniRoute, OmniVoice, Vision, Project e File: os agentes da produção OWN MOVIE." },
      { property: "og:title", content: "Agentes IA — OWN MOVIE" },
      { property: "og:description", content: "Estado dos agentes locais." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Agentes,
});

async function ping(url: string) {
  try { await fetch(url, { mode: "no-cors" }); return true; } catch { return false; }
}

function Agentes() {
  const s = useSettings();
  const st = useQuery({
    queryKey: ["ping", s.routerUrl, s.voiceUrl, s.comfyUrl],
    queryFn: async () => ({
      OmniRoute: await ping(s.routerUrl), OmniVoice: await ping(new URL(s.voiceUrl).origin), ComfyUI: await ping(s.comfyUrl),
    }),
    refetchInterval: 8000,
  });
  const status = (n: string) => n === "OmniRoute" ? st.data?.OmniRoute : n === "OmniVoice" ? st.data?.OmniVoice : n === "Hermes Agent" ? st.data?.OmniRoute : true;
  return (
    <AppShell>
      <div className="grid gap-4 md:grid-cols-3">
        {AGENTS.map(([n, d, long]) => (
          <Panel key={n}>
            <div className="flex justify-between"><h3 className="font-display font-semibold">{n}</h3><span className={`text-xs ${status(n) ? "text-ok" : "text-destructive"}`}>{status(n) ? "● disponível" : "○ offline"}</span></div>
            <div className="text-xs text-cyan">{d}</div>
            <p className="mt-2 text-sm text-muted-foreground">{long}</p>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
