import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { refresh, useProject } from "@/lib/pipeline";
import { viewUrl } from "@/lib/comfy";

export const Route = createFileRoute("/arquivos")({
  head: () => ({
    meta: [
      { title: "Arquivos — OWN MOVIE" },
      {
        name: "description",
        content:
          "Clipes, áudios e filme final do projeto ativo, direto de output/OWN_MOVIE/projects.",
      },
      { property: "og:title", content: "Arquivos — OWN MOVIE" },
      {
        property: "og:description",
        content: "Saídas do ComfyUI e do OmniVoice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Arquivos,
});

function Arquivos() {
  const p = useProject();
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [p.name]);
  const clips = p.scenes.filter((s) => s.clip);
  return (
    <AppShell>
      <Panel title={`output/OWN_MOVIE/projects/${p.name}`}>
        {p.final && (
          <div className="mb-4 max-w-xl">
            <video src={viewUrl(p.final)} controls className="w-full rounded" />
            <a
              href={viewUrl(p.final)}
              download
              className="text-xs text-cyan underline"
            >
              baixar final.mp4
            </a>
          </div>
        )}
        {clips.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhum clipe gerado ainda.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {clips.map((s) => (
            <div key={s.id} className="rounded-md border p-2">
              <video
                src={viewUrl(s.clip!)}
                controls
                loop
                className="w-full rounded"
              />
              <div className="mt-1 truncate text-xs">
                Cena {s.index + 1} · {s.narration}
              </div>
              <a
                href={viewUrl(s.clip!)}
                download
                className="text-xs text-cyan underline"
              >
                baixar MP4
              </a>
            </div>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
