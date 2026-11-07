import { CHART, RED, TETHER } from "../tokens.js";
import type { TimelineSpec } from "./types.js";
import { doc, fit, line, measure, rect, text, title } from "./svg.js";

const HOUR = 3600_000;

/**
 * Day timeline: hour axis, event blocks, a "now" marker. 1200 wide at 2×.
 * Up to 8 events get a row each (Gantt style) so every label is readable even for a
 * 30-minute block; more than that packs into shared lanes.
 */
export function timeline(spec: TimelineSpec) {
  const W = 1200;
  const head = title(spec.title, W);
  const span = Math.max(HOUR, spec.to - spec.from);
  const x0 = CHART.pad, x1 = W - CHART.pad;
  const X = (t: number) => x0 + ((Math.min(Math.max(t, spec.from), spec.to) - spec.from) / span) * (x1 - x0);

  const events = [...spec.events].sort((a, b) => a.start - b.start);
  const gantt = events.length <= 8;
  const laneH = gantt ? 50 : 72, laneGap = gantt ? 12 : 14;
  const laneEnds: number[] = [];
  const placed = events.map((e, i) => {
    if (gantt) return { e, lane: i };
    let lane = laneEnds.findIndex((end) => end <= e.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.end); } else laneEnds[lane] = e.end;
    return { e, lane };
  });
  const lanes = Math.max(1, gantt ? events.length : laneEnds.length);
  const top = head.y + 22;
  const axisY = top + lanes * (laneH + laneGap) + 6;
  const H = axisY + 52 + CHART.pad - 16;
  const out: string[] = [head.svg];

  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: spec.timeZone });
  const every = span > 12 * HOUR ? 3 : span > 6 * HOUR ? 2 : 1;
  const first = Math.ceil(spec.from / HOUR) * HOUR;
  for (let t = first; t <= spec.to; t += HOUR) {
    const x = X(t);
    out.push(line(x, top - 8, x, axisY, { stroke: CHART.grid, "stroke-width": 2, opacity: 0.5 }));
    if (Math.round((t - first) / HOUR) % every === 0) {
      out.push(text(x, axisY + 40, fmt.format(new Date(t)).replace(" ", "").toLowerCase(), { size: CHART.size.caption, fill: CHART.muted, anchor: "middle" }));
    }
  }
  out.push(line(x0, axisY, x1, axisY, { stroke: CHART.grid, "stroke-width": 3 }));

  const size = CHART.size.label;
  for (const { e, lane } of placed) {
    const bx = X(e.start), bw = Math.max(14, X(e.end) - bx);
    const by = top + lane * (laneH + laneGap);
    const past = spec.now !== undefined && e.end <= spec.now;
    out.push(rect(bx, by, bw, laneH, { rx: 12, fill: e.color ?? TETHER, opacity: past ? 0.5 : 1 }));
    const baseline = by + laneH / 2 + 9;
    const w = measure(e.label, size, "semibold");
    const fill = past ? CHART.muted : CHART.text;
    if (w + 32 <= bw) out.push(text(bx + 16, baseline, e.label, { size, weight: "semibold" }));
    else if (bx + bw + 16 + Math.min(w, 300) <= x1) out.push(text(bx + bw + 14, baseline, fit(e.label, x1 - bx - bw - 14, size, "semibold"), { size, weight: "semibold", fill }));
    else out.push(text(bx - 14, baseline, fit(e.label, bx - x0 - 14, size, "semibold"), { size, weight: "semibold", fill, anchor: "end" }));
  }

  if (spec.now !== undefined && spec.now >= spec.from && spec.now <= spec.to) {
    const x = X(spec.now);
    out.push(line(x, top - 10, x, axisY + 6, { stroke: RED, "stroke-width": 4, "stroke-linecap": "round" }));
    out.push(rect(x - 34, top - 44, 68, 32, { rx: 16, fill: RED }));
    out.push(text(x, top - 20, "now", { size: CHART.size.caption, weight: "semibold", anchor: "middle" }));
  }
  if (!events.length) out.push(text(W / 2, top + laneH / 2 + 9, "Nothing scheduled", { size, fill: CHART.muted, anchor: "middle" }));
  return { svg: doc(W, H, out), width: W, height: H };
}
