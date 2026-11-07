import { CHART, TETHER } from "../tokens.js";
import type { SparklineSpec } from "./types.js";
import { circle, doc, path, polyline, text, title, n } from "./svg.js";

/** Activity sparkline with a soft area fill. 1200×300 at 2×. */
export function sparkline(spec: SparklineSpec) {
  const W = 1200, H = 300;
  const head = title(spec.title, W, spec.caption);
  const color = spec.color ?? TETHER;
  const pts = spec.points.length ? spec.points : [0];
  const max = Math.max(1, ...pts);
  const x0 = CHART.pad, x1 = W - CHART.pad, y0 = head.y + 10, y1 = H - CHART.pad;
  const step = pts.length > 1 ? (x1 - x0) / (pts.length - 1) : 0;
  const xy = pts.map((v, i) => [x0 + i * step, y1 - (v / max) * (y1 - y0)] as [number, number]);
  const area = `M${n(x0)} ${n(y1)}${xy.map(([x, y]) => `L${n(x)} ${n(y)}`).join("")}L${n(x0 + (pts.length - 1) * step)} ${n(y1)}Z`;
  const last = xy[xy.length - 1]!;
  return {
    svg: doc(W, H, [
      head.svg,
      path(area, { fill: color, opacity: 0.18 }),
      polyline(xy, { stroke: color, "stroke-width": 5, "stroke-linejoin": "round", "stroke-linecap": "round" }),
      circle(last[0], last[1], 9, { fill: color }),
      text(x1, y1 + 34, `peak ${max}`, { size: CHART.size.caption, fill: CHART.muted, anchor: "end" }),
    ]),
    width: W, height: H,
  };
}
