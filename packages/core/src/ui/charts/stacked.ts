import { CHART } from "../tokens.js";
import type { StackedSpec } from "./types.js";
import { circle, doc, el, measure, rect, text, title } from "./svg.js";

/** One stacked bar (e.g. task status counts) with an inline legend. 1200 wide at 2×. */
export function stacked(spec: StackedSpec) {
  const W = 1200, barH = 44;
  const head = title(spec.title, W);
  const H = head.y + barH + 96 + CHART.pad - 40;
  const total = spec.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const x0 = CHART.pad, x1 = W - CHART.pad, y = head.y;
  const out: string[] = [head.svg];
  const clip = `clip-${Math.round(total)}-${spec.segments.length}`;
  out.push(el("defs", {}, el("clipPath", { id: clip }, rect(x0, y, x1 - x0, barH, { rx: barH / 2 }))));
  const segs: string[] = [rect(x0, y, x1 - x0, barH, { fill: CHART.surface })];
  let x = x0;
  for (const s of spec.segments) {
    if (s.value <= 0 || total <= 0) continue;
    const w = (s.value / total) * (x1 - x0);
    segs.push(rect(x, y, w, barH, { fill: s.color }));
    x += w;
  }
  out.push(el("g", { "clip-path": `url(#${clip})` }, segs));
  let lx = x0;
  const ly = y + barH + 62;
  for (const s of spec.segments) {
    const label = `${s.label} ${s.value}`;
    out.push(circle(lx + 11, ly - 9, 11, { fill: s.color }));
    out.push(text(lx + 32, ly, label, { size: CHART.size.label, fill: s.value ? CHART.text : CHART.muted }));
    lx += 32 + measure(label, CHART.size.label) + 44;
  }
  return { svg: doc(W, H, out), width: W, height: H };
}
