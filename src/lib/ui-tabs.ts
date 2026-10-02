import { useSyncExternalStore } from "react";

export const STUDIO_TABS = ["Workflow", "Modelo", "Configurações", "Logs"] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];

let tab: StudioTab = "Workflow";
const subs = new Set<() => void>();

export function getStudioTab() {
  return tab;
}
export function setStudioTab(t: StudioTab) {
  tab = t;
  subs.forEach((f) => f());
}
export function useStudioTab() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getStudioTab,
    () => "Workflow" as StudioTab,
  );
}
