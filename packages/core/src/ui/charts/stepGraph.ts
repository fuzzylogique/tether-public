import { CHART, GREEN, GREY, RED, AMBER } from "../tokens.js";
import type { StepGraphSpec } from "./types.js";
import { circle, doc, fit, g, glyph, n, path, rect, text, title } from "./svg.js";

const STATUS_COLOR: Record<string, string> = { done: GREEN, failed: RED, running: AMBER, skipped: GREY, pending: CHART.muted };

/** Plan DAG: dependency levels as columns, nodes in agent colours, lock badge, dashed when disabled. */
export function stepGraph(spec: StepGraphSpec) {
  const W = 1200, nodeH = 96, rowGap = 26, colGap = 70;
  const head = title(spec.title, W);
  // With no dependencies at all (one level), a single tall column wastes the card: lay the
  // independent steps out side by side instead, wrapping at three per row.
  const flat = spec.nodes.length > 1 && spec.nodes.every((x) => x.level === 0);
  const perRow = Math.min(3, spec.nodes.length);
  const levelOf = (x: StepGraphSpec["nodes"][number], i: number) => (flat ? i % perRow : x.level);
  const cols = flat ? perRow : Math.max(1, ...spec.nodes.map((x) => x.level + 1));
  const byLevel: StepGraphSpec["nodes"][] = Array.from({ length: cols }, () => []);
  for (const [i, node] of spec.nodes.entries()) byLevel[levelOf(node, i)]!.push(node);
  const rows = Math.max(1, ...byLevel.map((l) => l.length));
  const nodeW = Math.min(330, (W - CHART.pad * 2 - (cols - 1) * colGap) / cols);
  const gridW = cols * nodeW + (cols - 1) * colGap;
  const left = (W - gridW) / 2;
  const top = head.y;
  const H = top + rows * nodeH + (rows - 1) * rowGap + CHART.pad;
  const colH = (k: number) => k * nodeH + (k - 1) * rowGap;

  const pos = new Map<string, { x: number; y: number }>();
  for (const [c, level] of byLevel.entries()) {
    const y0 = flat ? top : top + (colH(rows) - colH(level.length)) / 2;
    for (const [r, node] of level.entries()) pos.set(node.id, { x: left + c * (nodeW + colGap), y: y0 + r * (nodeH + rowGap) });
  }

  const out: string[] = [head.svg];
  for (const [from, to] of spec.edges) {
    const a = pos.get(from), b = pos.get(to);
    if (!a || !b) continue;
    const sx = a.x + nodeW, sy = a.y + nodeH / 2, tx = b.x - 10, ty = b.y + nodeH / 2;
    const mx = (sx + tx) / 2;
    const dim = spec.nodes.find((x) => x.id === to)?.disabled;
    out.push(path(`M${n(sx)} ${n(sy)}C${n(mx)} ${n(sy)} ${n(mx)} ${n(ty)} ${n(tx)} ${n(ty)}`, { fill: "none", stroke: CHART.grid, "stroke-width": 4, "stroke-dasharray": dim ? "10 10" : undefined }));
    out.push(path(`M${n(tx - 4)} ${n(ty - 9)}L${n(tx + 8)} ${n(ty)}L${n(tx - 4)} ${n(ty + 9)}Z`, { fill: CHART.grid }));
  }

  for (const node of spec.nodes) {
    const p = pos.get(node.id)!;
    const status = node.disabled ? "skipped" : node.status;
    const parts: string[] = [
      rect(p.x, p.y, nodeW, nodeH, { rx: 18, fill: CHART.surface, stroke: node.disabled ? CHART.grid : node.color, "stroke-width": 3, "stroke-dasharray": node.disabled ? "12 9" : undefined }),
      rect(p.x + 3, p.y + 18, 8, nodeH - 36, { rx: 4, fill: node.color }),
    ];
    const badge = status ? 44 : 0;
    const lock = node.locked ? 34 : 0;
    const textW = nodeW - 34 - 18 - badge - lock;
    parts.push(text(p.x + 30, p.y + (node.detail ? 42 : 58), fit(node.label, textW, CHART.size.label, "semibold"), { size: CHART.size.label, weight: "semibold" }));
    if (node.detail) parts.push(text(p.x + 30, p.y + 76, fit(node.detail, textW, CHART.size.caption), { size: CHART.size.caption, fill: CHART.muted }));
    if (node.locked) parts.push(glyph("locked", p.x + nodeW - 22 - badge - 16, p.y + nodeH / 2, 30, AMBER));
    if (status) {
      const color = STATUS_COLOR[status] ?? CHART.muted;
      const cx = p.x + nodeW - 38, cy = p.y + nodeH / 2;
      parts.push(circle(cx, cy, 20, { fill: status === "pending" ? "none" : color, stroke: status === "pending" ? color : undefined, "stroke-width": status === "pending" ? 3 : undefined }));
      if (status !== "pending") parts.push(glyph(status, cx, cy, 30, CHART.bg));
    }
    out.push(g(parts, { opacity: node.disabled ? 0.5 : undefined }));
  }
  return { svg: doc(W, H, out), width: W, height: H };
}
