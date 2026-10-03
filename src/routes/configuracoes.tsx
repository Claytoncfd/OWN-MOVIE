import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_SETTINGS,
  setSettings,
  useSettings,
  type Settings,
} from "@/lib/settings";
import { ownMovieNodesInstalled, systemStats } from "@/lib/comfy";
import { getHealth } from "@/lib/own-movie";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — OWN MOVIE" },
      {
        name: "description",
        content:
          "Endereço do ComfyUI, modelo do OmniRoute, voz e parâmetros de render dos workflows OWN MOVIE.",
      },
      { property: "og:title", content: "Configurações — OWN MOVIE" },
      {
        property: "og:description",
        content: "Configure os serviços locais da plataforma OWN MOVIE.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Config,
});

function Field({
  k,
  label,
  type = "text",
}: {
  k: keyof Settings;
  label: string;
  type?: string;
}) {
  const s = useSettings();
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={String(s[k])}
        onChange={(e) =>
          setSettings({
            [k]: type === "number" ? Number(e.target.value) : e.target.value,
          } as Partial<Settings>)
        }
        className="mt-1 font-mono"
      />
    </label>
  );
}

function Config() {
  const s = useSettings();
  const [report, setReport] = useState<string[]>([]);

  async function diagnose() {
    const out: string[] = [];
    try {
      const st = await systemStats();
      out.push(`ComfyUI: OK · ${st.devices[0]?.name ?? "sem GPU"}`);
    } catch (e) {
      setReport([`ComfyUI: ${(e as Error).message}`]);
      return;
    }
    out.push(
      (await ownMovieNodesInstalled().catch(() => false))
        ? "Nodes OWN_MOVIE: instalados"
        : "Nodes OWN_MOVIE: NÃO encontrados — copie custom_nodes/OWN_MOVIE para o ComfyUI e reinicie",
    );
    try {
      const h = await getHealth();
      out.push(
        `OmniRoute (${h.omniroute.url}): ${h.omniroute.online ? "online" : "offline"}`,
      );
      out.push(
        `OmniVoice (omnivoice-infer): ${h.omnivoice.online ? "encontrado" : (h.omnivoice.hint ?? "não encontrado")}`,
      );
      out.push(
        `FFmpeg: ${h.ffmpeg.online ? "encontrado" : (h.ffmpeg.hint ?? "não encontrado")}`,
      );
    } catch {
      out.push("Rotas /own_movie indisponíveis: nodes não carregaram.");
    }
    setReport(out);
  }

  return (
    <AppShell>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Serviços locais (127.0.0.1)">
          <div className="space-y-3">
            <Field k="comfyUrl" label="ComfyUI" />
            <div className="grid grid-cols-2 gap-2">
              <Field k="routerUrl" label="OmniRoute (OpenAI compatível)" />
              <Field k="routerModel" label="Modelo (Planner e Emoção)" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field
                k="voiceName"
                label="Voz (default ou caminho de áudio de referência)"
              />
              <Field k="voiceLang" label="Idioma" />
            </div>
            <div className="flex items-start gap-2">
              <Button size="sm" variant="outline" onClick={diagnose}>
                Diagnosticar
              </Button>
              <div className="space-y-0.5 font-mono text-xs">
                {report.map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Suba o ComfyUI com{" "}
              <code className="font-mono">--enable-cors-header</code>. Defina{" "}
              <code className="font-mono">OMNIVOICE_BIN</code> (caminho do
              omnivoice-infer) e, se o OmniRoute pedir chave,{" "}
              <code className="font-mono">OMNIROUTE_API_KEY</code> no ambiente
              do ComfyUI. Não há mais bridge :8000.
            </p>
          </div>
        </Panel>
        <Panel title="Render e estilo">
          <div className="grid grid-cols-3 gap-2">
            <Field k="width" label="Largura" type="number" />
            <Field k="height" label="Altura" type="number" />
            <Field k="fps" label="FPS" type="number" />
            <Field k="steps" label="Steps" type="number" />
            <Field k="cfg" label="CFG" type="number" />
            <Field k="maxSeconds" label="Máx. segundos/cena" type="number" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.useEmotion}
              onChange={(e) => setSettings({ useEmotion: e.target.checked })}
            />
            Usar Agente Emoção (pausas e ênfases na narração)
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={s.chainLastFrame}
              onChange={(e) =>
                setSettings({ chainLastFrame: e.target.checked })
              }
            />
            Encadear último frame (i2v) entre cenas
          </label>
          <label className="mt-3 block text-sm">
            <span className="text-muted-foreground">Prefixo de estilo VOX</span>
            <Textarea
              rows={2}
              value={s.stylePrefix}
              onChange={(e) => setSettings({ stylePrefix: e.target.value })}
              className="mt-1"
            />
          </label>
          <label className="mt-3 block text-sm">
            <span className="text-muted-foreground">Prompt negativo</span>
            <Textarea
              rows={2}
              value={s.negative}
              onChange={(e) => setSettings({ negative: e.target.value })}
              className="mt-1"
            />
          </label>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setSettings({ ...DEFAULT_SETTINGS })}
          >
            Restaurar padrões
          </Button>
        </Panel>
      </div>
    </AppShell>
  );
}
