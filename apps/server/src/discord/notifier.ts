import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type Client, type TextBasedChannel,
} from "discord.js";
import type { Notifier, Plan } from "@tether/core";
import { agents } from "@tether/core";
import { approvalEmbed, planEmbed, statusEmbed } from "./embeds.js";

async function textChannel(client: Client, id: string) {
  const ch = await client.channels.fetch(id);
  if (!ch || !ch.isTextBased() || !("send" in ch)) throw new Error(`channel ${id} is not text-based`);
  return ch as TextBasedChannel & { send: (o: unknown) => Promise<{ id: string }> };
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

  async postPlanCard({ run, plan }: Parameters<Notifier["postPlanCard"]>[0]) {
    const ch = await textChannel(this.client, this.target(run.source));
    const msg = await ch.send({ embeds: [planEmbed(run.id, run.request, plan)], components: planComponents(run.id, plan) });
    return { channelId: this.target(run.source), messageId: msg.id };
  }

  async postApprovalCards({ run, actions }: Parameters<Notifier["postApprovalCards"]>[0]) {
    const channelId = this.target(run.source);
    const ch = await textChannel(this.client, channelId);
    const out = [];
    for (const a of actions) {
      const msg = await ch.send({ embeds: [approvalEmbed(a)], components: approvalComponents(a.id) });
      out.push({ id: a.id, channelId, messageId: msg.id });
    }
    return out;
  }

  async updateStatus({ run, lines, status }: Parameters<Notifier["updateStatus"]>[0]) {
    const channelId = this.target(run.source);
    const ch = await textChannel(this.client, channelId);
    const embed = statusEmbed(run.id, run.request, lines, status);
    const { db, schema } = await import("@tether/core");
    const { eq } = await import("drizzle-orm");
    const [row] = await db().select({ source: schema.runs.source }).from(schema.runs).where(eq(schema.runs.id, run.id));
    const existing = row?.source.statusMessageId;
    if (existing && "messages" in ch) {
      try {
        const m = await (ch as { messages: { fetch: (id: string) => Promise<{ edit: (o: unknown) => Promise<unknown> }> } }).messages.fetch(existing);
        await m.edit({ embeds: [embed] });
        return;
      } catch { /* fall through and post anew */ }
    }
    const msg = await ch.send({ embeds: [embed] });
    await db().update(schema.runs).set({ source: { ...(row?.source ?? run.source), statusMessageId: msg.id } }).where(eq(schema.runs.id, run.id));
  }

  async postSummary({ run, text, attachments }: Parameters<Notifier["postSummary"]>[0]) {
    const ch = await textChannel(this.client, this.target(run.source));
    await ch.send({ content: text.slice(0, 1990), files: attachments?.map((a) => new AttachmentBuilder(a.data, { name: a.name })) });
  }

  async postToChannel({ channelId, text, attachments }: Parameters<Notifier["postToChannel"]>[0]) {
    const ch = await textChannel(this.client, channelId);
    const msg = await ch.send({ content: text.slice(0, 1990), files: attachments?.map((a) => new AttachmentBuilder(a.data, { name: a.name })) });
    return { messageId: msg.id };
  }

  async dm({ discordId, text }: Parameters<Notifier["dm"]>[0]) {
    const user = await this.client.users.fetch(discordId);
    await user.send(text.slice(0, 1990));
  }
}
