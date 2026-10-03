import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";

function routerAt(path: string) {
  const queryClient = new QueryClient();
  return createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// O shell (__root) renderiza <html>, que não monta dentro de div de teste.
// Aqui se valida o roteamento (path → rota) sem DOM.
describe("App routing", () => {
  it("renders the index route", async () => {
    const router = routerAt("/");
    await router.load();
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.matches.some((m) => m.routeId === "/")).toBe(true);
  });

  it("renders the not-found route", async () => {
    const router = routerAt("/this-route-does-not-exist");
    await router.load();
    expect(router.state.location.pathname).toBe("/this-route-does-not-exist");
    expect(router.state.matches.some((m) => m.routeId === "__root__")).toBe(true);
  });
});
