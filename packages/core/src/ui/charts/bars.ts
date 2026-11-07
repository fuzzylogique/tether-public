import { CHART, thresholdColor } from "../tokens.js";
import type { BarsSpec } from "./types.js";
import { doc, fit, measure, rect, text, title } from "./svg.js";

/** Horizontal progress bars, one per row, with threshold colours. 1200 wide at 2×. */
export function bars(spec: BarsSpec) {
  const W = 1200, rowH = 92, barH = 26;
  const head = title(spec.title, W);
  const H = head.y + spec.rows.length * rowH + CHART.pad - 20;
  const values = spec.rows.map((r) => r.valueLabel ?? `${Math.round(r.value)} / ${Math.round(r.max)}`);
  const valueW = Math.max(...values.map((v) => measure(v, CHART.size.label)), 120);
  const x0 = CHART.pad, x1 = W - CHART.pad;
  const out: string[] = [head.svg];
  for (const [i, r] of spec.rows.entries()) {
    const y = head.y + i * rowH + 30;
    const pct = r.max > 0 ? (r.value / r.max) * 100 : 0;
    const color = r.color ?? thresholdColor(pct);
    out.push(text(x0, y, fit(r.label, x1 - x0 - valueW - 140, CHART.size.label, "semibold"), { size: CHART.size.label, weight: "semibold" }));
    out.push(text(x1, y, values[i]!, { size: CHART.size.label, fill: CHART.muted, anchor: "end" }));
    out.push(text(x1 - valueW - 24, y, `${Math.round(pct)}%`, { size: CHART.size.label, fill: color, anchor: "end", weight: "semibold" }));
    const by = y + 20;
    out.push(rect(x0, by, x1 - x0, barH, { rx: barH / 2, fill: CHART.surface }));
    const w = Math.min(1, Math.max(0, pct / 100)) * (x1 - x0);
    if (w > 0) out.push(rect(x0, by, Math.max(barH, w), barH, { rx: barH / 2, fill: color }));
  }
  return { svg: doc(W, H, out), width: W, height: H };
}
