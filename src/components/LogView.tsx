export const AGENTS = [
  ["Hermes Agent", "Planejamento e decisões", "Divide o roteiro em cenas e escreve os prompts visuais"],
  ["OmniRoute", "Roteamento de LLM · :20128", "Endpoint único compatível com OpenAI, fallback entre modelos"],
  ["OmniVoice", "Voz / TTS · :8001", "Narração por cena, clonagem de voz zero-shot"],
  ["Vision Agent", "Análise de frames", "Avalia o last frame e sugere correções de prompt"],
  ["Project Agent", "Cenas, prompts, versões", "Mantém o projeto e o histórico de prompts"],
  ["File Agent", "Arquivos e limpeza", "Organiza output/ e valida modelos"],
] as const;

export function LogView({ lines }: { lines: { t: string; src: string; msg: string; level: string }[] }) {
  return (
    <div className="h-80 overflow-auto rounded-md border bg-background p-3 font-mono text-xs">
      {lines.length === 0 && <div className="text-muted-foreground">Sem eventos ainda.</div>}
      {lines.map((l, i) => (
        <div key={i} className={l.level === "err" ? "text-destructive" : l.level === "ok" ? "text-ok" : ""}>
          [{l.t}] <span className="text-cyan">{l.src}</span> {l.msg}
        </div>
      ))}
    </div>
  );
}
