import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Panel } from "@/components/AppShell";
import { useProject } from "@/lib/pipeline";

export const Route = createFileRoute("/arquivos")({
  head: () => ({
    meta: [
      { title: "Arquivos — OWN MOVIE" },
      { name: "description", content: "Vídeos e áudios gerados no projeto ativo do OWN MOVIE." },
      { property: "og:title", content: "Arquivos — OWN MOVIE" },
      { property: "og:description", content: "Saídas do ComfyUI e do OmniVoice." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Arquivos,
});

function Arquivos() {
  const p = useProject();
  const vids = p.scenes.filter((s) => s.videoUrl);
  return (
    <AppShell>
      <Panel title={`output/videos · ${p.name}`}>
        {vids.length === 0 && <p className="text-sm text-muted-foreground">Nenhum vídeo gerado ainda.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {vids.map((s, i) => (
            <div key={s.id} className="rounded-md border p-2">
              <video src={s.videoUrl} controls loop muted className="w-full rounded" />
              <div className="mt-1 truncate text-xs">Cena {i + 1} · {s.narration}</div>
              <a href={s.videoUrl} download className="text-xs text-cyan underline">baixar MP4</a>
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
