// Diagnóstico visível: quantas vezes o app e o quadro bootaram.
// Se o nº do quadro subir ao clicar = remontagem indevida (bug meu).
// Se só o do app subir = reload da página. Se nenhum subir = sem reboot.
function bump(key: string): number {
  try {
    const n = Number(localStorage.getItem(key) ?? 0) + 1;
    localStorage.setItem(key, String(n));
    return n;
  } catch {
    return 0;
  }
}

export function appBootCount() {
  return bump("ownmovie.appboots");
}

export function frameLoadCount() {
  return bump("ownmovie.frameboots");
}

export function readCounts() {
  try {
    return {
      app: Number(localStorage.getItem("ownmovie.appboots") ?? 0),
      frame: Number(localStorage.getItem("ownmovie.frameboots") ?? 0),
      last: localStorage.getItem("ownmovie.framelast") ?? "—",
    };
  } catch {
    return { app: 0, frame: 0, last: "—" };
  }
}

// Instância única do ComfyUI embutido: criada uma vez e MOVIDA entre o slot
// da página e um esconderijo — mover nó dentro do mesmo documento NÃO
// recarrega o iframe. É isso que mantém o ComfyUI contínuo ao trocar de
// aba ou de página (antes ele desmontava e bootava do zero a cada clique).
let frame: HTMLIFrameElement | null = null;
let currentUrl = "";
let stash: HTMLDivElement | null = null;
let customH: number | null = null;

function loadCustomH() {
  try {
    const v = Number(localStorage.getItem("ownmovie.comfyH") ?? 0);
    customH = v >= 300 ? v : null;
  } catch {
    customH = null;
  }
}

export function setComfyHeight(px: number | null) {
  customH = px && px >= 300 ? Math.round(px) : null;
  try {
    if (customH) localStorage.setItem("ownmovie.comfyH", String(customH));
    else localStorage.removeItem("ownmovie.comfyH");
  } catch { /* ignore */ }
  if (frame) frame.style.height = customH ? `${customH}px` : "";
}

function applyHeight() {
  if (frame) frame.style.height = customH ? `${customH}px` : "";
}

export function setFrameStash(el: HTMLDivElement | null) {
  stash = el;
  if (frame && el && frame.parentElement !== el) el.appendChild(frame);
}

export function showComfyFrame(slot: HTMLDivElement, url: string) {
  if (typeof document === "undefined") return;
  const norm = url.replace(/\/+$/, "");
  if (customH === null) loadCustomH();
  if (!frame || currentUrl !== norm) {
    try {
      localStorage.setItem("ownmovie.framelast", `${new Date().toLocaleTimeString()} ${currentUrl || "(nenhum)"} -> ${norm}`);
    } catch { /* ignore */ }
    frame?.remove();
    frame = document.createElement("iframe");
    frame.src = norm;
    frame.title = "ComfyUI nativo";
  frame.className = "h-[calc(100vh-200px)] min-h-[500px] w-full rounded-lg border bg-background";
    frame.addEventListener("load", () => frameLoadCount());
    currentUrl = norm;
  }
  if (frame.parentElement !== slot) slot.appendChild(frame);
  frame.className = "h-[calc(100vh-200px)] min-h-[500px] w-full rounded-lg border bg-background";
  applyHeight();
}

export function hideComfyFrame() {
  if (frame && stash && frame.parentElement !== stash) stash.appendChild(frame);
}
