import type { BadgeSpec } from "./types.js";
import { circle, el, g, glyph, n, path, rect, text } from "./svg.js";

/** Agent/status glyphs on a 24-unit grid, white on the badge colour. */
function icon(kind: BadgeSpec["glyph"], cx: number, cy: number, s: number) {
  const k = s / 24;
  const P = (x: number, y: number) => `${n(cx + (x - 12) * k)} ${n(cy + (y - 12) * k)}`;
  const W = "#FFFFFF";
  const stroke = { fill: "none", stroke: W, "stroke-width": n(2 * k), "stroke-linecap": "round", "stroke-linejoin": "round" };
  switch (kind) {
    case "finance":
      return text(cx, cy + 7.8 * k, "$", { size: 22 * k, weight: "semibold", fill: W, anchor: "middle" });
    case "outreach":
      return g([rect(cx - 8.5 * k, cy - 6 * k, 17 * k, 12 * k, { rx: 2 * k, ...stroke }), path(`M${P(4, 7)}L${P(12, 13)}L${P(20, 7)}`, stroke)]);
    case "socials":
      return g([path(`M${P(4, 10)}L${P(15, 5)}L${P(15, 19)}L${P(4, 14)}Z`, stroke), path(`M${P(7, 14.5)}L${P(8.5, 19)}`, stroke), path(`M${P(18.5, 9.5)}Q${P(20.5, 12)} ${P(18.5, 14.5)}`, stroke)]);
    case "calendar":
      return g([rect(cx - 8 * k, cy - 6 * k, 16 * k, 14 * k, { rx: 2.5 * k, ...stroke }), path(`M${P(4, 10)}L${P(20, 10)}M${P(8.5, 4)}L${P(8.5, 7.5)}M${P(15.5, 4)}L${P(15.5, 7.5)}`, stroke), circle(cx - 3 * k, cy + 2.5 * k, 1.3 * k, { fill: W }), circle(cx + 1 * k, cy + 2.5 * k, 1.3 * k, { fill: W })]);
    case "coordination":
      return g([path(`M${P(4, 7)}L${P(5.8, 8.8)}L${P(8.5, 5.5)}M${P(4, 15)}L${P(5.8, 16.8)}L${P(8.5, 13.5)}`, stroke), path(`M${P(11.5, 7.5)}L${P(20, 7.5)}M${P(11.5, 15.5)}L${P(20, 15.5)}`, stroke)]);
    case "helpdesk":
      return g([path(`M${P(5, 5.5)}L${P(19, 5.5)}Q${P(20.5, 5.5)} ${P(20.5, 7)}L${P(20.5, 14.5)}Q${P(20.5, 16)} ${P(19, 16)}L${P(11, 16)}L${P(7, 19.5)}L${P(7, 16)}L${P(5, 16)}Q${P(3.5, 16)} ${P(3.5, 14.5)}L${P(3.5, 7)}Q${P(3.5, 5.5)} ${P(5, 5.5)}Z`, stroke),
        text(cx, cy + 2.6 * k, "?", { size: 10.5 * k, weight: "semibold", fill: W, anchor: "middle" })]);
    case "tether":
      return g([circle(cx - 3.2 * k, cy, 5.6 * k, stroke), circle(cx + 3.2 * k, cy, 5.6 * k, stroke)]);
    default:
      return glyph(kind, cx, cy, s, W);
  }
}

/** Square glyph tile for application emoji, avatars and banners. */
export function badge(spec: BadgeSpec) {
  const s = spec.size;
  const shape = spec.shape === "rounded"
    ? rect(0, 0, s, s, { rx: s * 0.24, fill: spec.bg })
    : circle(s / 2, s / 2, s / 2, { fill: spec.bg });
  return {
    svg: el("svg", { xmlns: "http://www.w3.org/2000/svg", width: s, height: s, viewBox: `0 0 ${s} ${s}` }, [shape, icon(spec.glyph, s / 2, s / 2, s * 0.62)]),
    width: s, height: s,
  };
}
