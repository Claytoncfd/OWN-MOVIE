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
    };
  } catch {
    return { app: 0, frame: 0 };
  }
}

// Instância única do ComfyUI embutido: criada uma vez e MOVIDA entre o slot
// da página e um esconderijo — mover nó dentro do mesmo documento NÃO
// recarrega o iframe. É isso que mantém o ComfyUI contínuo ao trocar de
// aba ou de página (antes ele desmontava e bootava do zero a cada clique).
let frame: HTMLIFrameElement | null = null;
let currentUrl = "";
let stash: HTMLDivElement | null = null;

export function setFrameStash(el: HTMLDivElement | null) {
  stash = el;
  if (frame && el && frame.parentElement !== el) el.appendChild(frame);
}

export function showComfyFrame(slot: HTMLDivElement, url: string) {
  if (typeof document === "undefined") return;
  if (!frame || currentUrl !== url) {
    frame?.remove();
    frame = document.createElement("iframe");
    frame.src = url;
    frame.title = "ComfyUI nativo";
    frame.className = "h-[calc(100vh-220px)] min-h-[480px] w-full rounded-lg border bg-background";
    frame.addEventListener("load", () => frameLoadCount());
    currentUrl = url;
  }
  if (frame.parentElement !== slot) slot.appendChild(frame);
}

export function hideComfyFrame() {
  if (frame && stash && frame.parentElement !== stash) stash.appendChild(frame);
}
