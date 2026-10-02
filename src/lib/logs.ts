import { useSyncExternalStore } from "react";

export type LogLine = { t: string; src: string; msg: string; level: "info" | "ok" | "err" };
let lines: LogLine[] = [];
const subs = new Set<() => void>();

export function log(src: string, msg: string, level: LogLine["level"] = "info") {
  lines = [...lines.slice(-300), { t: new Date().toLocaleTimeString(), src, msg, level }];
  subs.forEach((f) => f());
}
export function useLogs() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => lines,
    () => lines,
  );
}
