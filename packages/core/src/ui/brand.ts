/** Identity assets drawn with the chart pipeline: app emoji, bot avatar, bot banner. */
import { AGENT_COLORS, AMBER, CHART, GREEN, GREY, RED, TETHER, EMOJI_NAMES } from "./tokens.js";
import type { BadgeSpec } from "./charts/types.js";
import { badge } from "./charts/badge.js";
import { circle, el, g, n, rect, text } from "./charts/svg.js";

const EMOJI_BG: Record<string, string> = { ...AGENT_COLORS, running: AMBER, done: GREEN, failed: RED, locked: TETHER, pending: GREY };

/** The eleven `tether_*` application emoji as badge specs (128×128, uploaded by `pnpm discord:emoji`). */
export function emojiBadges(): { name: string; spec: BadgeSpec }[] {
  return EMOJI_NAMES.map((name) => {
    const key = name.replace("tether_", "") as BadgeSpec["glyph"];
    return { name, spec: { type: "badge", size: 128, bg: EMOJI_BG[key] ?? TETHER, glyph: key, shape: "rounded" } };
  });
}

/** 512×512 bot avatar: the Tether mark on purple. Discord crops it to a circle. */
export function avatarSvg() {
  return badge({ type: "badge", size: 512, bg: TETHER, glyph: "tether", shape: "rounded" }).svg.replace(/rx="[\d.]+"/, 'rx="0"');
}

/** 1360×544 profile banner (5:2): wordmark, tagline, and the six agent colours as a ribbon. */
export function bannerSvg() {
  const W = 1360, H = 544;
  const agents = Object.entries(AGENT_COLORS);
  const ribbonW = W / agents.length;
  const mark = (cx: number, cy: number, r: number) => g([
    circle(cx - r * 0.57, cy, r, { fill: "none", stroke: "#FFFFFF", "stroke-width": n(r * 0.36) }),
    circle(cx + r * 0.57, cy, r, { fill: "none", stroke: "#FFFFFF", "stroke-width": n(r * 0.36) }),
  ]);
  return el("svg", { xmlns: "http://www.w3.org/2000/svg", width: W, height: H, viewBox: `0 0 ${W} ${H}` }, [
    rect(0, 0, W, H, { fill: CHART.bg }),
    rect(0, 0, W, H - 28, { fill: TETHER }),
    ...agents.map(([, c], i) => rect(i * ribbonW, H - 28, ribbonW + 1, 28, { fill: c })),
    mark(330, 250, 62),
    text(480, 278, "Tether", { size: 120, weight: "semibold", fill: "#FFFFFF" }),
    text(486, 348, "Agentic event ops for organizers, in Discord", { size: 34, fill: "#FFFFFF", opacity: 0.85 }),
  ]);
}
