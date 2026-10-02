import { useMemo, useRef, useState } from "react";
import { workflow, nodeTitle, widgetEntries, isSubgraph, type WfNode } from "@/lib/workflow";

const TITLE_H = 26;
const SLOT_H = 20;

const TYPE_COLORS: Record<string, string> = {
  MODEL: "#b39ddb", CLIP: "#ffd500", VAE: "#ff6e6e", CONDITIONING: "#ffa931",
  LATENT: "#ff9cf9", IMAGE: "#64b5f6", INT: "#29699c", STRING: "#77aa77",
};

export function WorkflowCanvas({ height = 1100 }: { height?: number }) {
  const bounds = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of workflow.groups) {
      const [x, y, w, h] = g.bounding;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    }
    for (const n of workflow.nodes) {
      x0 = Math.min(x0, n.pos[0]); y0 = Math.min(y0, n.pos[1] - TITLE_H);
      x1 = Math.max(x1, n.pos[0] + n.size[0]); y1 = Math.max(y1, n.pos[1] + n.size[1]);
    }
    return { x0: x0 - 40, y0: y0 - 40, w: x1 - x0 + 80, h: y1 - y0 + 80 };
  }, []);

  const nodeMap = useMemo(() => new Map(workflow.nodes.map((n) => [n.id, n])), []);
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 0.62 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [sel, setSel] = useState<WfNode | null>(null);

  const slotPos = (n: WfNode, idx: number, out: boolean) => {
    const collapsed = n.flags?.collapsed;
    const x = n.pos[0] + (out ? (collapsed ? 140 : n.size[0]) : 0);
    const y = collapsed ? n.pos[1] - TITLE_H / 2 : n.pos[1] + SLOT_H / 2 + 4 + idx * SLOT_H;
    return [x - bounds.x0, y - bounds.y0] as const;
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        className="canvas-grid relative cursor-grab overflow-hidden rounded-lg border active:cursor-grabbing"
        style={{ height }}
        onWheel={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const mx = e.clientX - r.left, my = e.clientY - r.top;
          const k = Math.min(2, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
          setView({ k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k });
        }}
        onMouseDown={(e) => (drag.current = { x: e.clientX - view.x, y: e.clientY - view.y })}
        onMouseMove={(e) => drag.current && setView((v) => ({ ...v, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y }))}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        <div style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`, transformOrigin: "0 0", width: bounds.w, height: bounds.h, position: "absolute" }}>
          {workflow.groups.map((g) => {
            const [x, y, w, h] = g.bounding;
            return (
              <div key={g.id} className="absolute rounded" style={{ left: x - bounds.x0, top: y - bounds.y0, width: w, height: h, background: `${g.color}44`, border: `1px solid ${g.color}aa` }}>
                <div className="px-2 py-1 font-display text-xl font-semibold text-foreground/90">{g.title}</div>
              </div>
            );
          })}
          <svg className="pointer-events-none absolute left-0 top-0" width={bounds.w} height={bounds.h}>
            {workflow.links.map(([id, o, os, t, ts, type]) => {
              const a = nodeMap.get(o), b = nodeMap.get(t);
              if (!a || !b) return null;
              const [x1, y1] = slotPos(a, os, true);
              const [x2, y2] = slotPos(b, ts, false);
              const dx = Math.max(60, Math.abs(x2 - x1) / 2);
              return <path key={id} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} stroke={TYPE_COLORS[type] ?? "#9aa"} strokeWidth={3} fill="none" opacity={0.85} />;
            })}
          </svg>
          {workflow.nodes.map((n) => {
            const collapsed = n.flags?.collapsed;
            const muted = n.mode === 2 || n.mode === 4;
            const ws = widgetEntries(n);
            const isNote = n.type === "MarkdownNote";
            return (
              <div
                key={n.id}
                onClick={(e) => { e.stopPropagation(); setSel(n); }}
                className="absolute overflow-hidden rounded-md shadow-lg"
                style={{
                  left: n.pos[0] - bounds.x0,
                  top: n.pos[1] - TITLE_H - bounds.y0,
                  width: collapsed ? 140 : n.size[0],
                  height: collapsed ? TITLE_H : n.size[1] + TITLE_H,
                  background: n.bgcolor ?? "#353535",
                  opacity: muted ? 0.4 : 1,
                  outline: sel?.id === n.id ? "2px solid var(--cyan)" : "1px solid #000",
                }}
              >
                <div className="flex items-center gap-1.5 truncate px-2 text-[12px] font-medium text-foreground" style={{ height: TITLE_H, background: n.color ?? "#222" }}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${isSubgraph(n) ? "bg-cyan" : "bg-ok"}`} />
                  {nodeTitle(n)}
                </div>
                {!collapsed && (
                  <div className="space-y-0.5 p-1.5 text-[10px] text-foreground/70">
                    {isNote ? (
                      <pre className="whitespace-pre-wrap font-mono text-[9px] leading-snug">{String((n.widgets_values as string[])?.[0] ?? "").slice(0, 1600)}</pre>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <div>{n.inputs?.filter((i) => i.link != null || !("widget" in i)).map((i) => <div key={i.name} style={{ height: SLOT_H - 4 }}>● {i.label ?? i.name}</div>)}</div>
                          <div className="text-right">{n.outputs?.map((o) => <div key={o.name} style={{ height: SLOT_H - 4, color: TYPE_COLORS[o.type] }}>{o.label ?? o.name} ●</div>)}</div>
                        </div>
                        {ws.slice(0, 12).map(([k, v], i) => (
                          <div key={i} className="flex justify-between gap-2 rounded-full bg-background/50 px-2 py-0.5 font-mono">
                            <span className="truncate">{k}</span>
                            <span className="truncate text-foreground">{v}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="absolute bottom-2 left-2 flex gap-1">
          {[["+", 1.2], ["−", 0.8]].map(([l, f]) => (
            <button key={l as string} className="h-7 w-7 rounded border bg-panel text-sm" onClick={() => setView((v) => ({ ...v, k: Math.min(2, Math.max(0.2, v.k * (f as number))) }))}>{l}</button>
          ))}
          <button className="rounded border bg-panel px-2 text-xs" onClick={() => setView({ x: 0, y: 0, k: 0.62 })}>reset</button>
        </div>
      </div>
      {sel && (
        <div className="absolute right-3 top-3 w-72 rounded-lg border bg-panel p-3 text-xs shadow-xl">
          <div className="mb-1 flex justify-between font-display text-sm"><span>{nodeTitle(sel)}</span><button onClick={() => setSel(null)}>✕</button></div>
          <div className="font-mono text-muted-foreground">id {sel.id} · {sel.type.slice(0, 30)} · {sel.mode === 2 ? "mutado" : "ativo"}</div>
          <div className="mt-2 space-y-1 font-mono">
            {widgetEntries(sel).map(([k, v], i) => <div key={i} className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="truncate">{v}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}
