import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
export type VoxScene = { url: string; narration: string };

const W = 1280, H = 720;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Player estilo VOX: fundo papel, clipe em moldura recortada, legenda com marca-texto palavra a palavra. O clipe já traz a narração (mux no ComfyUI); aqui só entra o visual VOX. Exporta WebM com áudio. */
export function VoxPlayer({ scenes, title }: { scenes: VoxScene[]; title: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  const ready = scenes;

  useEffect(() => () => stopRef.current(), []);

  async function play(record = false) {
    if (!ready.length) return;
    stopRef.current();
    const ctx2d = canvas.current!.getContext("2d")!;
    const paper = cssVar("--foreground"), ink = cssVar("--background"), mark = cssVar("--vox"), blue = cssVar("--primary");
    let ac: AudioContext | null = null, dest: MediaStreamAudioDestinationNode | null = null, rec: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    if (record) {
      ac = new AudioContext();
      dest = ac.createMediaStreamDestination();
      const stream = new MediaStream([...canvas.current!.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      rec = new MediaRecorder(stream, { mimeType: "video/webm" });
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
        a.download = `${title.replace(/\W+/g, "_")}_vox.webm`;
        a.click();
        setRecording(false);
      };
      rec.start();
      setRecording(true);
    }
    let cancelled = false, raf = 0;
    const cleanup: (() => void)[] = [];
    stopRef.current = () => { cancelled = true; cancelAnimationFrame(raf); cleanup.forEach((f) => f()); if (rec?.state === "recording") rec.stop(); setPlaying(false); };
    setPlaying(true);

    for (let i = 0; i < ready.length && !cancelled; i++) {
      setIdx(i);
      const sc = ready[i]!;
      const v = document.createElement("video");
      v.crossOrigin = "anonymous"; v.src = sc.url; v.playsInline = true;
      if (ac && dest) { const src = ac.createMediaElementSource(v); src.connect(dest); src.connect(ac.destination); }
      cleanup.push(() => { v.pause(); });
      await v.play().catch(() => {});
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
      const words = sc.narration.split(" ");
      await new Promise<void>((done) => {
        const draw = () => {
          if (cancelled) return done();
          const t = v.currentTime;
          if (v.ended || t >= dur) return done();
          // fundo papel
          ctx2d.fillStyle = paper; ctx2d.fillRect(0, 0, W, H);
          ctx2d.fillStyle = blue; ctx2d.fillRect(0, 0, W, 10);
          // moldura recortada, leve rotação
          const s = 470, x = W / 2 - s / 2, y = 60;
          ctx2d.save(); ctx2d.translate(x + s / 2, y + s / 2); ctx2d.rotate(-0.015 + 0.01 * Math.sin(t));
          ctx2d.fillStyle = ink; ctx2d.fillRect(-s / 2 - 10, -s / 2 - 10, s + 20, s + 20);
          const zoom = 1 + t * 0.015;
          try { ctx2d.drawImage(v, (-s / 2) * zoom, (-s / 2) * zoom, s * zoom, s * zoom); } catch { /* ignore */ }
          ctx2d.restore();
          // número da cena
          ctx2d.fillStyle = ink; ctx2d.font = "700 22px Sora"; ctx2d.fillText(`${String(i + 1).padStart(2, "0")} / ${String(ready.length).padStart(2, "0")}`, 40, 50);
          ctx2d.font = "500 16px 'IBM Plex Mono'"; ctx2d.fillText(title.toUpperCase(), 40, 76);
          // legenda com marca-texto progressivo
          const shown = Math.ceil((t / dur) * words.length);
          ctx2d.font = "700 30px Sora";
          const lines: string[][] = [[]];
          for (const w of words) {
            const cur = lines[lines.length - 1]!;
            if (ctx2d.measureText([...cur, w].join(" ")).width > W - 160) lines.push([w]); else cur.push(w);
          }
          const vis = lines.slice(-2 - 0);
          let wi = 0, ly = H - 120 + (vis.length === 1 ? 30 : 0);
          const startIdx = lines.slice(0, lines.length - vis.length).flat().length;
          wi = startIdx;
          for (const line of vis.slice(-2)) {
            let lx = (W - ctx2d.measureText(line.join(" ")).width) / 2;
            for (const w of line) {
              const ww = ctx2d.measureText(w + " ").width;
              if (wi < shown) { ctx2d.fillStyle = mark; ctx2d.fillRect(lx - 4, ly - 30, ww, 40); }
              ctx2d.fillStyle = ink; ctx2d.fillText(w, lx, ly);
              lx += ww; wi++;
            }
            ly += 48;
          }
          raf = requestAnimationFrame(draw);
        };
        draw();
      });
      v.pause();
    }
    if (!cancelled) stopRef.current();
  }

  return (
    <div className="space-y-3">
      <canvas ref={canvas} width={W} height={H} className="aspect-video w-full rounded-lg border bg-foreground" />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => (playing ? stopRef.current() : play(false))} disabled={!ready.length}>
          {playing ? "Parar" : "Reproduzir VOX"}
        </Button>
        <Button variant="outline" onClick={() => play(true)} disabled={!ready.length || recording}>
          {recording ? "Gravando…" : "Exportar WebM (vídeo + áudio)"}
        </Button>
        <span className="font-mono text-xs text-muted-foreground">
          {ready.length ? `cena ${idx + 1}/${ready.length}` : "nenhuma cena renderizada ainda"}
        </span>
      </div>
    </div>
  );
}
