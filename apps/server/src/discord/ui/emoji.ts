import type { Client } from "discord.js";
import { EMOJI_FALLBACK } from "@tether/core";

/**
 * Application-emoji registry. Cards write `:tether_<name>:` shortcodes; `pnpm discord:emoji`
 * uploads the real glyphs and `loadEmojis` reads them once at ClientReady. With an empty
 * registry every shortcode falls back to unicode, so a fresh dev setup still renders.
 */
const registry = new Map<string, string>();

export async function loadEmojis(client: Client) {
  if (!client.application) return 0;
  try {
    const list = await client.application.emojis.fetch();
    registry.clear();
    for (const e of list.values()) if (e.name?.startsWith("tether_")) registry.set(e.name, e.id);
  } catch (e) {
    console.warn("app emoji fetch failed; using unicode fallbacks", e);
  }
  return registry.size;
}

export function emojiMarkdown(name: string) {
  const id = registry.get(name);
  return id ? `<:${name}:${id}>` : EMOJI_FALLBACK[name] ?? "";
}

/** Component emoji (buttons, select options): app emoji by id, else the unicode fallback. */
export function emojiComponent(value: string): { id?: string; name: string } | undefined {
  const code = value.match(/^:(tether_\w+):$/)?.[1];
  if (!code) return { name: value };
  const id = registry.get(code);
  if (id) return { id, name: code };
  const fb = EMOJI_FALLBACK[code];
  return fb ? { name: fb } : undefined;
}

/** Swap every `:tether_x:` shortcode in markdown. Unknown shortcodes are left as typed. */
export function resolveShortcodes(md: string) {
  return md.replace(/:(tether_[a-z_]+):/g, (whole, name: string) => emojiMarkdown(name) || whole);
}

export function registeredEmojis() { return new Map(registry); }
