import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { synthesize } from "@/lib/agents";
import { useSettings } from "@/lib/settings";

export const Route = createFileRoute("/omnivoice")({
  head: () => ({
    meta: [
      { title: "OmniVoice — Narração | OWN MOVIE" },
      { name: "description", content: "Teste a narração local do OmniVoice antes de gerar as cenas." },
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
  const [text, setText] = useState("Bem-vindo ao OWN MOVIE. Esta é a voz da sua narração.");
  const [url, setUrl] = useState<string>();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AppShell>
      <Panel title="Teste de voz" className="max-w-2xl">
        <p className="mb-2 font-mono text-xs text-muted-foreground">{s.voiceUrl} · voz {s.voiceName} · {s.voiceLang}</p>
        <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <Button className="mt-3" disabled={busy} onClick={async () => {
          setBusy(true); setErr("");
          try { setUrl((await synthesize(text)).url); } catch (e) { setErr((e as Error).message); }
          setBusy(false);
        }}>{busy ? "Gerando…" : "Gerar áudio"}</Button>
        {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
        {url && <audio src={url} controls autoPlay className="mt-3 w-full" />}
      </Panel>
    </AppShell>
  );
}
