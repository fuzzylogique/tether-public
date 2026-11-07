import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize,
  StringSelectMenuBuilder, TextDisplayBuilder, ThumbnailBuilder,
  type MessageActionRowComponentBuilder, type MessageMentionOptions,
} from "discord.js";
import type { Action, Block, Card, Media } from "@tether/core";
import { emojiComponent, resolveShortcodes } from "./emoji.js";
import { chartPng } from "./raster.js";

/** Discord Components V2 limits (https://discord.com/developers/docs/components/overview). */
const MAX_COMPONENTS = 40;
const MAX_TEXT = 4000;
const MAX_GALLERY = 10;

export type Rendered = {
  components: ContainerBuilder[];
  files: AttachmentBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: MessageMentionOptions;
};

const STYLE: Record<string, ButtonStyle> = {
  primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger,
};

function hex(c?: string) {
  if (!c) return undefined;
  const n = parseInt(c.replace("#", ""), 16);
  return Number.isFinite(n) ? n : undefined;
}

function button(a: Extract<Action, { kind: "button" | "link" }>) {
  const b = new ButtonBuilder().setLabel(a.label.slice(0, 80));
  if (a.kind === "link") b.setStyle(ButtonStyle.Link).setURL(a.url);
  else b.setCustomId(a.id).setStyle(STYLE[a.style ?? "secondary"]!).setDisabled(!!a.disabled);
  const e = a.emoji ? emojiComponent(a.emoji) : undefined;
  if (e) b.setEmoji(e);
  return b;
}

function row(actions: Action[]): { row: ActionRowBuilder<MessageActionRowComponentBuilder>; count: number } {
  const r = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  const select = actions.find((a) => a.kind === "select");
  if (select && select.kind === "select") {
    const opts = select.options.slice(0, 25);
    r.addComponents(new StringSelectMenuBuilder()
      .setCustomId(select.id)
      .setPlaceholder(select.placeholder ?? "Choose")
      .setMinValues(select.min ?? 0)
      .setMaxValues(Math.min(select.max ?? opts.length, opts.length))
      .addOptions(opts.map((o) => ({ label: o.label.slice(0, 100), value: o.value, description: o.description?.slice(0, 100), default: o.default }))));
    return { row: r, count: 2 };
  }
  const buttons = actions.filter((a): a is Extract<Action, { kind: "button" | "link" }> => a.kind !== "select").slice(0, 5);
  r.addComponents(buttons.map(button));
  return { row: r, count: 1 + buttons.length };
}

function kvMarkdown(rows: [string, string][]) {
  return rows.map(([k, v]) => `**${k}**  ${v}`).join("\n");
}

/** Collects attachments for one message and hands out unique `attachment://` names. */
class Files {
  readonly list: AttachmentBuilder[] = [];
  private names = new Set<string>();

  add(name: string, data: Buffer) {
    let n = name.replace(/[^\w.-]/g, "_");
    for (let i = 2; this.names.has(n); i++) n = name.replace(/(\.\w+)?$/, `-${i}$1`);
    this.names.add(n);
    this.list.push(new AttachmentBuilder(data, { name: n }));
    return `attachment://${n}`;
  }

  /** Media → URL Discord accepts (http/https/attachment). `undefined` when it cannot be shown. */
  async url(m: Media): Promise<string | undefined> {
    if ("chart" in m) {
      const png = await chartPng(m.chart);
      return png ? this.add(m.name.endsWith(".png") ? m.name : `${m.name}.png`, png) : undefined;
    }
    if ("data" in m) return this.add(m.name, m.data);
    if (m.url.startsWith("data:")) {
      const match = m.url.match(/^data:([\w/+.-]+);base64,(.*)$/);
      if (!match) return undefined;
      const ext = match[1]!.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
      return this.add(`image.${ext}`, Buffer.from(match[2]!, "base64"));
    }
    return /^https?:\/\//.test(m.url) ? m.url : undefined;
  }
}

function altOf(m: Media) {
  return (m.alt ?? ("chart" in m && "title" in m.chart ? m.chart.title : undefined))?.slice(0, 1024);
}

/**
 * Card → Components V2 payload. Enforces the per-message limits by dropping trailing blocks
 * (with a "+N more" note) instead of letting Discord reject the whole message.
 */
export async function render(card: Card): Promise<Rendered> {
  const files = new Files();
  const container = new ContainerBuilder();
  const accent = hex(card.accent);
  if (accent !== undefined) container.setAccentColor(accent);

  let components = 1; // the container itself
  let chars = 0;
  const md = (s: string, max = MAX_TEXT) => {
    const out = resolveShortcodes(s).slice(0, Math.max(0, Math.min(max, MAX_TEXT - chars)));
    chars += out.length;
    return out;
  };

  // Header, footer and actions are reserved first so long bodies can never squeeze them out.
  const header = [card.title ? `## ${card.title}` : "", card.subtitle ? `-# ${card.subtitle}` : ""].filter(Boolean).join("\n");
  const footer = card.footer ? `-# ${card.footer}` : "";
  const rows = (card.actions ?? []).filter((r) => r.length).slice(0, 5).map(row);
  const reservedComponents = (footer ? 1 : 0) + rows.reduce((n, r) => n + r.count, 0) + 1; // +1 for a "+N more" note
  const reservedChars = header.length + footer.length + 40;

  if (header) { container.addTextDisplayComponents(new TextDisplayBuilder().setContent(md(header))); components++; }

  const blocks = card.blocks;
  let shown = 0;
  for (const b of blocks) {
    const cost = blockCost(b);
    if (components + cost + reservedComponents > MAX_COMPONENTS || chars + reservedChars >= MAX_TEXT) break;
    const budget = MAX_TEXT - reservedChars - chars;
    const added = await addBlock(container, b, files, (s) => md(s, budget));
    components += added;
    shown++;
  }
  const hidden = blocks.length - shown;
  if (hidden > 0) { container.addTextDisplayComponents(new TextDisplayBuilder().setContent(md(`-# +${hidden} more not shown`))); components++; }

  if (footer) { container.addTextDisplayComponents(new TextDisplayBuilder().setContent(md(footer))); components++; }
  for (const r of rows) container.addActionRowComponents(r.row);

  return {
    components: [container],
    files: files.list,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], users: card.ping?.users ?? [], roles: card.ping?.roles ?? [] },
  };
}

/** Same payload for `message.edit` / `interaction.update`: replaces old attachments wholesale. */
export async function renderEdit(card: Card) {
  return { ...(await render(card)), attachments: [] as never[] };
}

function blockCost(b: Block) {
  switch (b.kind) {
    case "section": return (b.thumb || b.button ? 2 : 1) + Math.min(3, b.md.length);
    case "gallery": case "chart": case "text": case "kv": case "separator": case "file": return 1;
  }
}

async function addBlock(c: ContainerBuilder, b: Block, files: Files, md: (s: string) => string): Promise<number> {
  switch (b.kind) {
    case "text":
      if (!b.md.trim()) return 0;
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(md(b.md)));
      return 1;
    case "kv":
      if (!b.rows.length) return 0;
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(md(kvMarkdown(b.rows))));
      return 1;
    case "separator":
      c.addSeparatorComponents(new SeparatorBuilder().setDivider(b.divider ?? true).setSpacing(b.large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small));
      return 1;
    case "section": {
      const texts = b.md.filter((s) => s.trim()).slice(0, 3);
      if (!texts.length) return 0;
      const thumb = b.thumb ? await files.url(b.thumb) : undefined;
      const accessory = b.button && b.button.kind !== "select" ? button(b.button) : undefined;
      if (!thumb && !accessory) {
        // A section must carry exactly one accessory; without one it is just text.
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(md(texts.join("\n"))));
        return 1;
      }
      const s = new SectionBuilder().addTextDisplayComponents(...texts.map((t) => new TextDisplayBuilder().setContent(md(t) || "​")));
      if (thumb) {
        const t = new ThumbnailBuilder().setURL(thumb);
        const alt = b.thumb && altOf(b.thumb);
        if (alt) t.setDescription(alt);
        s.setThumbnailAccessory(t);
      } else s.setButtonAccessory(accessory!);
      c.addSectionComponents(s);
      return 2 + texts.length;
    }
    case "chart":
      return addGallery(c, [{ name: b.name, chart: b.spec, alt: b.alt }], files, md);
    case "gallery":
      return addGallery(c, b.items, files, md);
    case "file": {
      const url = files.add(b.name, b.data);
      c.addFileComponents((f) => f.setURL(url));
      return 1;
    }
  }
}

async function addGallery(c: ContainerBuilder, items: Media[], files: Files, md: (s: string) => string) {
  const urls: { url: string; alt?: string }[] = [];
  const missing: string[] = [];
  for (const m of items.slice(0, MAX_GALLERY)) {
    const url = await files.url(m);
    if (url) urls.push({ url, alt: altOf(m) });
    else if (altOf(m)) missing.push(altOf(m)!);
  }
  if (!urls.length) {
    // Rasteriser unavailable or a URL Discord cannot load: say what the image would have shown.
    if (!missing.length) return 0;
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(md(missing.map((m) => `-# ${m}`).join("\n"))));
    return 1;
  }
  c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(urls.map((u) => {
    const item = new MediaGalleryItemBuilder().setURL(u.url);
    if (u.alt) item.setDescription(u.alt);
    return item;
  })));
  return 1;
}
