import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type Client, type TextBasedChannel,
} from "discord.js";
import type { Card, ChannelImage, MessageBody, Notifier, Plan } from "@tether/core";
import { agents } from "@tether/core";
import { approvalEmbed, planEmbed, statusEmbed } from "./embeds.js";
import { render, renderEdit } from "./ui/render.js";

type Sendable = TextBasedChannel & {
  send: (o: unknown) => Promise<{ id: string }>;
  messages?: { fetch: (id: string) => Promise<{ edit: (o: unknown) => Promise<unknown> }> };
};

async function textChannel(client: Client, id: string) {
  const ch = await client.channels.fetch(id);
  if (!ch || !ch.isTextBased() || !("send" in ch)) throw new Error(`channel ${id} is not text-based`);
  return ch as Sendable;
}

type Files = { name: string; data: Buffer }[] | undefined;

/** Card bodies render as Components V2; extra attachments join the card as a gallery. */
async function payload(body: MessageBody, attachments?: Files) {
  if (body.card) {
    const card: Card = attachments?.length
      ? { ...body.card, blocks: [...body.card.blocks, { kind: "gallery", items: attachments.map((a) => ({ name: a.name, data: a.data })) }] }
      : body.card;
    return render(card);
  }
  return {
    content: (body.text ?? "").slice(0, 1990),
    files: attachments?.map((a) => new AttachmentBuilder(a.data, { name: a.name })),
    allowedMentions: { parse: [] as never[] },
  };
}

export function planComponents(runId: string, plan: Plan) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`plan:select:${runId}`)
    .setPlaceholder("Choose which steps run")
    .setMinValues(0)
    .setMaxValues(plan.steps.length)
    .addOptions(plan.steps.map((s, i) => ({
      label: `${i + 1}. ${agents()[s.agent]?.label ?? s.agent}`.slice(0, 100),
      description: s.instruction.slice(0, 100),
      value: s.id,
      default: s.enabled,
    })));
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`plan:run:${runId}`).setLabel("Run").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`plan:edit:${runId}`).setLabel("Edit steps").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`plan:cancel:${runId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger),
  );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), buttons];
}

export function approvalComponents(actionId: string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`action:approve:${actionId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`action:edit:${actionId}`).setLabel("Edit").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`action:reject:${actionId}`).setLabel("Reject").setStyle(ButtonStyle.Danger),
  )];
}

export class DiscordNotifier implements Notifier {
  constructor(private client: Client) {}

  private target(source: Record<string, string | undefined>) {
    const id = source.threadId ?? source.channelId;
    if (!id) throw new Error("run has no channel to render into");
    return id;
  }

  async postPlanCard({ run, plan, card }: Parameters<Notifier["postPlanCard"]>[0]) {
    const ch = await textChannel(this.client, this.target(run.source));
    const msg = await ch.send(card ? await render(card) : { embeds: [planEmbed(run.id, run.request, plan)], components: planComponents(run.id, plan) });
    return { channelId: this.target(run.source), messageId: msg.id };
  }

  async postApprovalCards({ run, actions }: Parameters<Notifier["postApprovalCards"]>[0]) {
    const channelId = this.target(run.source);
    const ch = await textChannel(this.client, channelId);
    const out = [];
    for (const a of actions) {
      const msg = await ch.send(a.card ? await render(a.card) : { embeds: [approvalEmbed(a)], components: approvalComponents(a.id) });
      out.push({ id: a.id, channelId, messageId: msg.id });
    }
    return out;
  }

  async updateStatus({ run, lines, status, card }: Parameters<Notifier["updateStatus"]>[0]) {
    const channelId = this.target(run.source);
    const ch = await textChannel(this.client, channelId);
    // The live status card is text-only, so in-place edits never drop attachments.
    const body = card ? await renderEdit(card) : { embeds: [statusEmbed(run.id, run.request, lines ?? [], status)] };
    const { db, schema } = await import("@tether/core");
    const { eq } = await import("drizzle-orm");
    const [row] = await db().select({ source: schema.runs.source }).from(schema.runs).where(eq(schema.runs.id, run.id));
    const existing = row?.source.statusMessageId;
    if (existing && ch.messages) {
      try {
        const m = await ch.messages.fetch(existing);
        await m.edit(body);
        return;
      } catch { /* fall through and post anew */ }
    }
    const msg = await ch.send(card ? await render(card) : body);
    await db().update(schema.runs).set({ source: { ...(row?.source ?? run.source), statusMessageId: msg.id } }).where(eq(schema.runs.id, run.id));
  }

  async postSummary({ run, attachments, ...body }: Parameters<Notifier["postSummary"]>[0]) {
    const ch = await textChannel(this.client, this.target(run.source));
    await ch.send(await payload(body as MessageBody, attachments));
  }

  async postToChannel({ channelId, attachments, ...body }: Parameters<Notifier["postToChannel"]>[0]) {
    const ch = await textChannel(this.client, channelId);
    const msg = await ch.send(await payload(body as MessageBody, attachments));
    return { messageId: msg.id };
  }

  async editMessage({ channelId, messageId, ...body }: Parameters<Notifier["editMessage"]>[0]) {
    const ch = await textChannel(this.client, channelId);
    if (!ch.messages) return;
    const m = await ch.messages.fetch(messageId);
    await m.edit(body.card ? await renderEdit(body.card) : { content: (body.text ?? "").slice(0, 1990) });
  }

  async dm({ discordId, ...body }: Parameters<Notifier["dm"]>[0]) {
    const user = await this.client.users.fetch(discordId);
    await user.send(await payload(body as MessageBody) as never);
  }

  /** Walk the channel history newest-first and collect image attachments; stops after `limit` images or ~300 messages. */
  async listChannelImages({ channelId, limit = 24 }: Parameters<Notifier["listChannelImages"]>[0]): Promise<ChannelImage[]> {
    const ch = await this.client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased() || !("messages" in ch)) throw new Error(`channel ${channelId} is not text-based`);
    const out: ChannelImage[] = [];
    let before: string | undefined;
    for (let page = 0; page < 3 && out.length < limit; page++) {
      const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!batch.size) break;
      for (const m of batch.values()) {
        for (const a of m.attachments.values()) {
          if (!a.contentType?.startsWith("image/")) continue;
          out.push({
            url: a.url, proxyUrl: a.proxyURL, contentType: a.contentType, name: a.name, bytes: a.size,
            width: a.width ?? undefined, height: a.height ?? undefined,
            authorName: m.member?.displayName ?? m.author.displayName, postedAt: m.createdAt.toISOString(), messageId: m.id,
          });
          if (out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
      before = batch.last()?.id;
    }
    return out;
  }
}
