import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { generateVoices, isRunning, refresh, useProject } from "@/lib/pipeline";
import { viewUrl } from "@/lib/comfy";
import { useSettings } from "@/lib/settings";

export const Route = createFileRoute("/omnivoice")({
  head: () => ({
    meta: [
      { title: "OmniVoice — Narração | OWN MOVIE" },
      {
        name: "description",
        content:
          "Ouça a narração OmniVoice de cada cena do projeto, gerada pelo node OWN · OmniVoice no ComfyUI.",
      },
      { property: "og:title", content: "OmniVoice — OWN MOVIE" },
      { property: "og:description", content: "Texto para fala local." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Voice,
});

function Voice() {
  const s = useSettings();
  const p = useProject();
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [p.name]);
  const withAudio = p.scenes.filter((x) => x.audio);
  return (
    <AppShell>
      <Panel title={`Narração · ${p.name}`} className="max-w-3xl">
        <p className="mb-3 font-mono text-xs text-muted-foreground">
          node OWN · OmniVoice (omnivoice-infer) · voz {s.voiceName} · idioma{" "}
          {s.voiceLang} · {withAudio.length}/{p.scenes.length} cenas com áudio
        </p>
        {p.scenes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Gere o plano em Projetos para criar as cenas.
          </p>
        )}
        <div className="space-y-3">
          {p.scenes.map((sc) => (
            <div key={sc.id} className="rounded-md border p-3">
              <div className="mb-1 text-sm">{sc.narration}</div>
              {sc.audio ? (
                <audio
                  src={viewUrl(sc.audio)}
                  controls
                  className="h-8 w-full"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  sem áudio ainda
                </span>
              )}
            </div>
          ))}
        </div>
        {p.scenes.some((x) => !x.has_audio) && (
          <Button
            className="mt-3"
            disabled={isRunning(p)}
            onClick={generateVoices}
          >
            {p.phase === "voice"
              ? `Gerando… ${p.busy}`
              : "Gerar narração das cenas pendentes"}
          </Button>
        )}
        {p.error && <p className="mt-2 text-sm text-destructive">{p.error}</p>}
      </Panel>
    </AppShell>
  );
}
