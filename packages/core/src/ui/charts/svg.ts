/**
 * A tiny SVG string builder. No dependencies, deterministic output (numbers rounded to 0.1)
 * so chart snapshots diff cleanly. All charts are drawn at 2× pixel scale (see CHART tokens).
 */
import { CHART } from "../tokens.js";

type Attr = string | number | undefined | false | null;
export type Attrs = Record<string, Attr>;

export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const n = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};

function attrs(a: Attrs) {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== false && v !== null)
    .map(([k, v]) => ` ${k}="${typeof v === "number" ? n(v) : esc(String(v))}"`)
    .join("");
}

export function el(tag: string, a: Attrs = {}, children?: string | string[]) {
  const inner = Array.isArray(children) ? children.join("") : children;
  return inner === undefined || inner === "" ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${inner}</${tag}>`;
}

export const g = (children: string[], a: Attrs = {}) => el("g", a, children);

export function rect(x: number, y: number, w: number, h: number, a: Attrs = {}) {
  return el("rect", { x, y, width: Math.max(0, w), height: Math.max(0, h), ...a });
}

export function circle(cx: number, cy: number, r: number, a: Attrs = {}) {
  return el("circle", { cx, cy, r, ...a });
}

export function line(x1: number, y1: number, x2: number, y2: number, a: Attrs = {}) {
  return el("line", { x1, y1, x2, y2, ...a });
}

export function polyline(points: [number, number][], a: Attrs = {}) {
  return el("polyline", { points: points.map(([x, y]) => `${n(x)},${n(y)}`).join(" "), fill: "none", ...a });
}

export function path(d: string, a: Attrs = {}) {
  return el("path", { d, ...a });
}

export type TextOpts = {
  size?: number; weight?: "regular" | "semibold"; fill?: string; anchor?: "start" | "middle" | "end"; opacity?: number;
};

/** Text with its baseline at `y`. Font is always Inter (vendored, loaded by the rasteriser). */
export function text(x: number, y: number, content: string, o: TextOpts = {}) {
  return el("text", {
    x, y, "font-family": CHART.font, "font-size": o.size ?? CHART.size.label,
    "font-weight": o.weight === "semibold" ? CHART.weight.semibold : CHART.weight.regular,
    fill: o.fill ?? CHART.text, "text-anchor": o.anchor && o.anchor !== "start" ? o.anchor : undefined, opacity: o.opacity,
  }, esc(content));
}

/**
 * Approximate advance width of Inter. Good to a few percent for Latin text, which is all
 * layout needs: deciding where to truncate and where right-aligned columns start.
 */
export function measure(s: string, size: number, weight: "regular" | "semibold" = "regular") {
  let w = 0;
  for (const ch of s) {
    if ("il.,:;|!'’ ".includes(ch)) w += 0.28;
    else if ("ftjrI()[]".includes(ch)) w += 0.36;
    else if ("mwMW@%".includes(ch)) w += 0.86;
    else if (/[A-Z0-9$]/.test(ch)) w += 0.66;
    else if (/[a-z]/.test(ch)) w += 0.55;
    else w += 0.62;
  }
  return w * size * (weight === "semibold" ? 1.04 : 1);
}

/** Truncate with an ellipsis until the text fits `max` pixels. */
export function fit(s: string, max: number, size: number, weight: "regular" | "semibold" = "regular") {
  if (measure(s, size, weight) <= max) return s;
  let out = s;
  while (out.length > 1 && measure(`${out}…`, size, weight) > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const pt = (cx: number, cy: number, r: number, deg: number): [number, number] => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];

/** Ring segment between angles a0 → a1 (degrees, 0 = 12 o'clock, clockwise). */
export function arc(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number) {
  const sweep = Math.min(359.99, Math.max(0, a1 - a0));
  const end = a0 + sweep;
  const large = sweep > 180 ? 1 : 0;
  const [x0, y0] = pt(cx, cy, rOuter, a0), [x1, y1] = pt(cx, cy, rOuter, end);
  const [x2, y2] = pt(cx, cy, rInner, end), [x3, y3] = pt(cx, cy, rInner, a0);
  return `M${n(x0)} ${n(y0)}A${n(rOuter)} ${n(rOuter)} 0 ${large} 1 ${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}A${n(rInner)} ${n(rInner)} 0 ${large} 0 ${n(x3)} ${n(y3)}Z`;
}

/** The chart document: fixed pixel size, rounded dark card so one PNG reads in both themes. */
export function doc(width: number, height: number, children: string[]) {
  return el("svg", { xmlns: "http://www.w3.org/2000/svg", width, height, viewBox: `0 0 ${width} ${height}` }, [
    rect(0, 0, width, height, { rx: CHART.radius, fill: CHART.bg }),
    ...children,
  ]);
}

/** Title row shared by every chart; returns the y where content can start. */
export function title(t: string | undefined, width: number, right?: string): { svg: string; y: number } {
  if (!t) return { svg: "", y: CHART.pad };
  const y = CHART.pad + CHART.size.title * 0.8;
  const parts = [text(CHART.pad, y, fit(t, width - CHART.pad * 2 - (right ? measure(right, CHART.size.label) + 24 : 0), CHART.size.title, "semibold"), { size: CHART.size.title, weight: "semibold" })];
  if (right) parts.push(text(width - CHART.pad, y, right, { size: CHART.size.label, fill: CHART.muted, anchor: "end" }));
  return { svg: parts.join(""), y: y + 40 };
}

/** Glyphs drawn as vector shapes (no emoji fonts in the rasteriser). Centred on (cx, cy), `s` = box size. */
export function glyph(kind: string, cx: number, cy: number, s: number, color: string) {
  const k = s / 24; // drawn on a 24-unit grid
  const P = (x: number, y: number) => `${n(cx + (x - 12) * k)} ${n(cy + (y - 12) * k)}`;
  const stroke = { fill: "none", stroke: color, "stroke-width": n(2.4 * k), "stroke-linecap": "round", "stroke-linejoin": "round" };
  switch (kind) {
    case "done": return path(`M${P(5, 12.5)}L${P(10, 17.5)}L${P(19, 7)}`, stroke);
    case "failed": return path(`M${P(6.5, 6.5)}L${P(17.5, 17.5)}M${P(17.5, 6.5)}L${P(6.5, 17.5)}`, stroke);
    case "skipped": return path(`M${P(6, 12)}L${P(18, 12)}`, stroke);
    case "pending": return circle(cx, cy, 6.5 * k, stroke);
    case "running": return g([circle(cx, cy, 8 * k, stroke), path(`M${P(12, 7.5)}L${P(12, 12)}L${P(15, 14)}`, stroke)]);
    case "locked": return g([
      rect(cx - 7 * k, cy - 1.5 * k, 14 * k, 10.5 * k, { rx: 2.2 * k, fill: color }),
      path(`M${P(8.5, 10.5)}V${n(cy - 4.5 * k)}A${n(3.5 * k)} ${n(3.5 * k)} 0 0 1 ${P(15.5, 7.5)}V${n(cy - 1.5 * k)}`, stroke),
    ]);
    default: return circle(cx, cy, 5 * k, { fill: color });
  }
}
