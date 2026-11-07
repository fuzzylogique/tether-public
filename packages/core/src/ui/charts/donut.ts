import { CHART, SERIES } from "../tokens.js";
import type { DonutSpec } from "./types.js";
import { arc, circle, doc, fit, path, text, title } from "./svg.js";

/** Donut with a centre label and a legend to the right. 1200×520 at 2×. */
export function donut(spec: DonutSpec) {
  const W = 1200, H = spec.title ? 560 : 520;
  const head = title(spec.title, W);
  const R = 180, T = 58;
  const cx = CHART.pad + R + 12, cy = head.y + (H - head.y - CHART.pad) / 2;
  const total = spec.segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const out: string[] = [head.svg, circle(cx, cy, R - T / 2, { fill: "none", stroke: CHART.surface, "stroke-width": T })];
  let a = 0;
  const gap = spec.segments.filter((s) => s.value > 0).length > 1 ? 1.2 : 0;
  for (const [i, s] of spec.segments.entries()) {
    if (s.value <= 0 || total <= 0) continue;
    const sweep = (s.value / total) * 360;
    out.push(path(arc(cx, cy, R, R - T, a + gap / 2, a + sweep - gap / 2), { fill: s.color ?? SERIES[i % SERIES.length] }));
    a += sweep;
  }
  if (spec.center) {
    out.push(text(cx, cy + (spec.center.label ? 4 : 14), fit(spec.center.value, (R - T) * 1.8, 44, "semibold"), { size: 44, weight: "semibold", anchor: "middle" }));
    if (spec.center.label) out.push(text(cx, cy + 40, fit(spec.center.label, (R - T) * 1.7, CHART.size.caption), { size: CHART.size.caption, fill: CHART.muted, anchor: "middle" }));
  }
  if (spec.legend !== false) {
    const lx = cx + R + 80, rowH = 64;
    const top = cy - ((spec.segments.length - 1) * rowH) / 2;
    for (const [i, s] of spec.segments.entries()) {
      const y = top + i * rowH;
      const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
      out.push(circle(lx + 12, y - 9, 12, { fill: s.color ?? SERIES[i % SERIES.length] }));
      out.push(text(lx + 40, y, fit(s.label, W - CHART.pad - lx - 180, CHART.size.label), { size: CHART.size.label }));
      out.push(text(W - CHART.pad, y, `${pct}%`, { size: CHART.size.label, fill: CHART.muted, anchor: "end" }));
    }
  }
  return { svg: doc(W, H, out), width: W, height: H };
}
