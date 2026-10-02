import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_SETTINGS, setSettings, useSettings, type Settings } from "@/lib/settings";
import { systemStats } from "@/lib/comfy";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — OWN MOVIE" },
      { name: "description", content: "Portas locais do ComfyUI, OmniVoice e OmniRoute, workflow API e parâmetros de render." },
      { property: "og:title", content: "Configurações — OWN MOVIE" },
      { property: "og:description", content: "Configure os serviços locais da plataforma OWN MOVIE." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Config,
});

function Field({ k, label, type = "text" }: { k: keyof Settings; label: string; type?: string }) {
  const s = useSettings();
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={String(s[k])}
        onChange={(e) => setSettings({ [k]: type === "number" ? Number(e.target.value) : e.target.value } as Partial<Settings>)}
        className="mt-1 font-mono"
      />
    </label>
  );
}

function Config() {
  const s = useSettings();
  const [test, setTest] = useState("");
  let apiInfo = "";
  try {
    if (s.apiWorkflow) apiInfo = `${Object.keys(JSON.parse(s.apiWorkflow)).length} nodes no formato API`;
  } catch {
    apiInfo = "JSON inválido";
  }
  return (
    <AppShell>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Serviços locais (127.0.0.1)">
          <div className="space-y-3">
            <Field k="comfyUrl" label="ComfyUI" />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={async () => {
                try { const r = await systemStats(); setTest(`OK · ${r.devices[0]?.name ?? "sem GPU"}`); } catch (e) { setTest(`Falhou: ${(e as Error).message}`); }
              }}>Testar ComfyUI</Button>
              <span className="font-mono text-xs">{test}</span>
            </div>
            <Field k="voiceUrl" label="OmniVoice (POST JSON {text, voice, language} → áudio)" />
            <div className="grid grid-cols-2 gap-2"><Field k="voiceName" label="Voz" /><Field k="voiceLang" label="Idioma" /></div>
            <Field k="routerUrl" label="OmniRoute (OpenAI compatível)" />
            <div className="grid grid-cols-2 gap-2"><Field k="routerModel" label="Modelo" /><Field k="routerKey" label="Chave (opcional)" type="password" /></div>
            <p className="text-xs text-muted-foreground">Inicie o ComfyUI com <code className="font-mono">--enable-cors-header</code> para o navegador acessar a porta 8188.</p>
          </div>
        </Panel>
        <Panel title="Workflow WAN2.2 (API Format)">
          <p className="mb-2 text-sm text-muted-foreground">
            No ComfyUI: abra WAN2.2.json → menu Workflow → Export (API). Para i2v/encadeamento, des-mute LoadImage (23) e ImageResizeKJv2 (85) antes de exportar.
          </p>
          <input type="file" accept=".json" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSettings({ apiWorkflow: await f.text() }); }} />
          <div className="mt-2 font-mono text-xs">{s.apiWorkflow ? <span className="text-ok">{apiInfo}</span> : <span className="text-warn">nenhum arquivo carregado</span>}</div>
          <h3 className="panel-title mb-2 mt-5">Render</h3>
          <div className="grid grid-cols-3 gap-2">
            <Field k="width" label="Largura" type="number" /><Field k="height" label="Altura" type="number" /><Field k="fps" label="FPS" type="number" />
            <Field k="steps" label="Steps" type="number" /><Field k="cfg" label="CFG" type="number" /><Field k="maxSeconds" label="Máx. segundos/cena" type="number" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.chainLastFrame} onChange={(e) => setSettings({ chainLastFrame: e.target.checked })} />
            Encadear last frame (i2v) entre cenas
          </label>
          <label className="mt-3 block text-sm"><span className="text-muted-foreground">Prefixo de estilo VOX</span>
            <Textarea rows={2} value={s.stylePrefix} onChange={(e) => setSettings({ stylePrefix: e.target.value })} className="mt-1" /></label>
          <label className="mt-3 block text-sm"><span className="text-muted-foreground">Prompt negativo</span>
            <Textarea rows={2} value={s.negative} onChange={(e) => setSettings({ negative: e.target.value })} className="mt-1" /></label>
          <Button variant="outline" className="mt-3" onClick={() => setSettings({ ...DEFAULT_SETTINGS, apiWorkflow: s.apiWorkflow })}>Restaurar padrões do arquivo</Button>
        </Panel>
      </div>
    </AppShell>
  );
}
