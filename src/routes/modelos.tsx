import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Panel } from "@/components/AppShell";
import { realValues } from "@/lib/workflow";

export const Route = createFileRoute("/modelos")({
  head: () => ({
    meta: [
      { title: "Modelos — OWN MOVIE" },
      { name: "description", content: "UNet, CLIP e VAE do workflow WAN2.2 e perfis por VRAM." },
      { property: "og:title", content: "Modelos — OWN MOVIE" },
      { property: "og:description", content: "Modelos usados pelo WAN2.2." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Modelos,
});

const PROFILES = [
  ["6 GB", "Q3_K", "Q3_K_M", "16 GB", "~4,6 min por 1 s (RTX 3050)"],
  ["8 GB", "Q4_K", "Q3_K_M", "32 GB", "Balanceado"],
  ["10 GB+", "Q5_K", "Q4_K_M", "32 GB+", "Mais qualidade"],
];

function Modelos() {
  return (
    <AppShell>
      <div className="grid gap-4 lg:grid-cols-2">
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
