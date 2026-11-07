/**
 * The semantic Card model. Every Discord surface is built as a Card in core (pure data, no
 * Discord types) and rendered to Components V2 by the adapter (apps/server/src/discord/ui/render.ts).
 */
import type { ChartSpec } from "./charts/types.js";

export type ButtonStyle = "primary" | "secondary" | "success" | "danger";

export type Action =
  | { kind: "button"; id: string; label: string; style?: ButtonStyle; emoji?: string; disabled?: boolean }
  | { kind: "link"; url: string; label: string; emoji?: string }
  | {
      kind: "select"; id: string; placeholder?: string; min?: number; max?: number;
      options: { label: string; value: string; description?: string; default?: boolean }[];
    };

/** An image: a public URL (http/https/data:), raw bytes, or a chart rasterised at the edge. */
export type Media =
  | { url: string; alt?: string }
  | { name: string; data: Buffer; alt?: string }
  | { name: string; chart: ChartSpec; alt?: string };

export type Block =
  | { kind: "text"; md: string }
  | { kind: "kv"; rows: [label: string, value: string][] }
  | { kind: "section"; md: string[]; thumb?: Media; button?: Action }
  | { kind: "gallery"; items: Media[] }
  | { kind: "chart"; spec: ChartSpec; name: string; alt: string }
  | { kind: "separator"; divider?: boolean; large?: boolean }
  | { kind: "file"; name: string; data: Buffer };

export type Card = {
  /** Hex colour of the container accent bar. */
  accent?: string;
  title?: string;
  subtitle?: string;
  blocks: Block[];
  /** Rows of buttons / selects (custom ids are the same as the pre-V2 components). */
  actions?: Action[][];
  footer?: string;
  /** Who this message may ping. Default: nobody (informational). */
  ping?: { users?: string[]; roles?: string[] };
};

// ---------- formatting helpers (Discord-flavoured markdown) ----------

export function fmtMoney(n: number, opts: { cents?: boolean } = {}) {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 })}`;
}

export function unix(d: Date | string | number) {
  return Math.floor(new Date(d).getTime() / 1000);
}

/** `<t:…:R>` relative timestamp; `style` F = full date, t = short time, D = date. */
export function ts(d: Date | string | number, style: "R" | "F" | "f" | "t" | "T" | "D" | "d" = "R") {
  return `<t:${unix(d)}:${style}>`;
}

export function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function shortId(id: string) { return id.slice(0, 8); }

export function quote(s: string, max = 600) {
  return truncate(s.trim(), max).split("\n").map((l) => `> ${l}`).join("\n");
}

/** `▰▰▰▱▱` progress glyphs. */
export function progress(done: number, total: number, width = Math.min(10, Math.max(total, 5))) {
  if (total <= 0) return "▱".repeat(width);
  const filled = Math.round((done / total) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

/** Lists cap at `max` rows then "+N more", per the design rules. */
export function capList<T>(items: T[], max = 8): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

export function mention(discordId?: string | null, fallback = "unassigned") {
  return discordId ? `<@${discordId}>` : fallback;
}

export function kv(rows: [string, string | number | null | undefined][]): Block {
  return { kind: "kv", rows: rows.filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === null || v === "" ? "none" : String(v)]) };
}

export const sep = (divider = true, large = false): Block => ({ kind: "separator", divider, large });
export const text = (md: string): Block => ({ kind: "text", md });
