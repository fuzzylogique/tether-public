import { CHART, GREY, TETHER } from "../tokens.js";
import type { FunnelSpec } from "./types.js";
import { doc, fit, rect, text, title } from "./svg.js";

/** Pipeline funnel: centred bars sized by count, label left, count and detail right. 1200 wide at 2×. */
export function funnel(spec: FunnelSpec) {
  const W = 1200, rowH = 78, barH = 60;
  const head = title(spec.title, W);
  const H = head.y + spec.stages.length * rowH + (spec.aside ? 56 : 0) + CHART.pad - 10;
  const labelW = 250, detailW = 300;
  const bx0 = CHART.pad + labelW, bx1 = W - CHART.pad - detailW;
  const mid = (bx0 + bx1) / 2, maxW = bx1 - bx0;
  const max = Math.max(1, ...spec.stages.map((s) => s.count));
  const out: string[] = [head.svg];
  for (const [i, s] of spec.stages.entries()) {
    const y = head.y + i * rowH;
    const w = s.count ? Math.max(maxW * 0.14, (s.count / max) * maxW) : maxW * 0.06;
    const color = s.color ?? TETHER;
    out.push(rect(mid - w / 2, y, w, barH, { rx: 14, fill: color, opacity: s.count ? 1 : 0.35 }));
    if (s.count) out.push(text(mid, y + barH / 2 + 10, String(s.count), { size: CHART.size.value, weight: "semibold", anchor: "middle" }));
    out.push(text(CHART.pad, y + barH / 2 + 9, fit(s.label, labelW - 20, CHART.size.label, "semibold"), { size: CHART.size.label, weight: "semibold", fill: s.count ? CHART.text : CHART.muted }));
    if (s.detail) out.push(text(W - CHART.pad, y + barH / 2 + 9, fit(s.detail, detailW - 20, CHART.size.label), { size: CHART.size.label, fill: CHART.muted, anchor: "end" }));
  }
  if (spec.aside) {
    const y = head.y + spec.stages.length * rowH + 30;
    out.push(text(CHART.pad, y, `${spec.aside.label} · ${spec.aside.count}${spec.aside.detail ? ` · ${spec.aside.detail}` : ""}`, { size: CHART.size.caption, fill: GREY }));
  }
  return { svg: doc(W, H, out), width: W, height: H };
}
