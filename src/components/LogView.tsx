/** Papéis reais: cada um corresponde a um node do pacote custom_nodes/OWN_MOVIE. */
export const AGENTS = [
  [
    "Agente Planner",
    "Node OWN · Agente Planner",
    "Escreve o prompt visual (Wan 2.2, estilo Vox) de cada cena via OmniRoute",
    "omniroute",
  ],
  [
    "Agente Emoção",
    "Node OWN · Agente Emoção",
    "Adiciona pausas e ênfases à narração sem mudar as palavras (validado)",
    "omniroute",
  ],
  [
    "OmniRoute",
    "Roteamento de LLM · :20128",
    "Endpoint único compatível com OpenAI, fallback entre modelos",
    "omniroute",
  ],
  [
    "OmniVoice",
    "Node OWN · OmniVoice",
    "Narração por cena (omnivoice-infer), com cache em disco",
    "omnivoice",
  ],
  [
    "FFmpeg",
    "Nodes Clipe da cena / Filme final",
    "Junta vídeo + áudio por cena e concatena o filme",
    "ffmpeg",
  ],
] as const;

export function LogView({
  lines,
}: {
  lines: { t: string; src: string; msg: string; level: string }[];
}) {
  return (
    <div className="h-80 overflow-auto rounded-md border bg-background p-3 font-mono text-xs">
      {lines.length === 0 && (
        <div className="text-muted-foreground">Sem eventos ainda.</div>
      )}
      {lines.map((l, i) => (
        <div
          key={i}
          className={
            l.level === "err"
              ? "text-destructive"
              : l.level === "ok"
                ? "text-ok"
                : ""
          }
        >
          [{l.t}] <span className="text-cyan">{l.src}</span> {l.msg}
        </div>
      ))}
    </div>
  );
}
