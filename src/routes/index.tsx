import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { useSettings } from "@/lib/settings";
import { hideComfyFrame, setComfyHeight, showComfyFrame } from "@/lib/comfy-frame";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ComfyUI WAN2.2 — OWN MOVIE" },
      { name: "description", content: "ComfyUI nativo com o workflow WAN2.2 do OWN MOVIE." },
      { property: "og:title", content: "ComfyUI WAN2.2 — OWN MOVIE" },
      { property: "og:description", content: "Workflow real do ComfyUI dentro da plataforma OWN MOVIE." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Studio,
});

function Studio() {
  const s = useSettings();
  const slotRef = useRef<HTMLDivElement>(null);

  // O iframe é único e persistente: só muda de lugar, nunca recarrega.
  useEffect(() => {
    if (slotRef.current) showComfyFrame(slotRef.current, s.comfyUrl);
    return () => hideComfyFrame();
  }, [s.comfyUrl]);

  function onGripDown(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = slotRef.current?.offsetHeight ?? 500;
    const move = (m: MouseEvent) => {
      const h = Math.max(300, startH + (m.clientY - startY));
      const f = slotRef.current?.querySelector("iframe");
      if (f) (f as HTMLIFrameElement).style.height = `${h}px`;
    };
    const up = (m: MouseEvent) => {
      setComfyHeight(Math.max(300, startH + (m.clientY - startY)));
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <AppShell>
      <Panel>
        <div ref={slotRef} className="min-h-[480px]" />
        <div
          onMouseDown={onGripDown}
          title="Arrastar para redimensionar"
          className="mt-1 flex h-4 cursor-ns-resize items-center justify-center rounded-md border border-dashed text-muted-foreground hover:bg-accent"
        >
          <div className="h-1 w-16 rounded-full bg-muted-foreground/40" />
        </div>
      </Panel>
    </AppShell>
  );
}
