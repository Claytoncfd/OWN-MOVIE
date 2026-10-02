import raw from "@/data/WAN2.2.json";

export type WfNode = {
  id: number;
  type: string;
  title?: string;
  pos: [number, number];
  size: [number, number];
  mode: number;
  color?: string;
  bgcolor?: string;
  flags?: { collapsed?: boolean };
  inputs?: { name: string; label?: string; type: string; link: number | null }[];
  outputs?: { name: string; label?: string; type: string; links?: number[] | null }[];
  widgets_values?: unknown;
};
export type WfGroup = { id: number; title: string; bounding: [number, number, number, number]; color: string };
export type WfLink = [number, number, number, number, number, string];

type Raw = {
  nodes: WfNode[];
  links: WfLink[];
  groups: WfGroup[];
  definitions: { subgraphs: { id: string; name: string; nodes: WfNode[] }[] };
  extra?: { frontendVersion?: string };
  version: number;
};

export const workflow = raw as unknown as Raw;

const subgraphNames = Object.fromEntries(
  workflow.definitions.subgraphs.map((s) => [s.id, s.name]),
);

export function nodeTitle(n: WfNode) {
  return n.title || subgraphNames[n.type] || n.type;
}
export function isSubgraph(n: WfNode) {
  return n.type in subgraphNames;
}

export function widgetEntries(n: WfNode): [string, string][] {
  const v = n.widgets_values;
  if (!v) return [];
  if (Array.isArray(v)) {
    if (n.type === "KSampler (Efficient)") {
      const k = ["seed", "control", "steps", "cfg", "sampler_name", "scheduler", "denoise", "preview_method", "vae_decode"];
      return v.map((x, i) => [k[i] ?? `w${i}`, String(x)] as [string, string]).filter(([k]) => k !== "control");
    }
    return v
      .filter((x) => x !== null && typeof x !== "object")
      .map((x, i) => [n.inputs?.filter((s) => (s as { widget?: unknown }).widget)[i]?.name ?? `value`, String(x)]);
  }
  return Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => typeof x !== "object")
    .map(([k, x]) => [k, String(x)]);
}

export const stats = {
  nodes: workflow.nodes.length,
  links: workflow.links.length,
  groups: workflow.groups.length,
  subgraphs: workflow.definitions.subgraphs.length,
  frontend: workflow.extra?.frontendVersion ?? "1.37.11",
  format: workflow.version,
};

/** Real values pulled from the file */
export const realValues = (() => {
  const by = (id: number) => workflow.nodes.find((n) => n.id === id);
  const ks = (by(7)?.widgets_values ?? []) as unknown[];
  return {
    unet: ((by(2)?.widgets_values as string[]) ?? [])[0],
    clip: ((by(4)?.widgets_values as string[]) ?? [])[0],
    vae: ((by(6)?.widgets_values as string[]) ?? [])[0],
    shift: ((by(5)?.widgets_values as number[]) ?? [])[0],
    seed: ks[0],
    steps: ks[2],
    cfg: ks[3],
    sampler: ks[4],
    scheduler: ks[5],
    prompt: ((by(12)?.widgets_values as string[]) ?? [])[0],
  };
})();
