/**
 * Shared by `discord:preview` and `discord:compare`: log in, find (or create) #tether-preview in the
 * dev guild, and optionally clear the bot's earlier posts there. Only the dedicated preview channel is
 * ever cleared, never a real one picked via DISCORD_PREVIEW_CHANNEL_ID.
 */
import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits, type TextChannel } from "discord.js";
import { loadEmojis } from "./emoji.js";

export const PREVIEW_CHANNEL = "tether-preview";

export async function openPreviewChannel(opts: { clear: boolean }) {
  const token = process.env.DISCORD_TOKEN, guildId = process.env.DISCORD_DEV_GUILD_ID;
  if (!token || !guildId) throw new Error("DISCORD_TOKEN and DISCORD_DEV_GUILD_ID are required");

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  await new Promise<void>((r) => client.isReady() ? r() : client.once("clientReady", () => r()));
  await client.application?.fetch();
  console.log(`app emojis registered: ${await loadEmojis(client)}`);

  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const override = process.env.DISCORD_PREVIEW_CHANNEL_ID;
  let channel = (override ? channels.get(override) : channels.find((c) => c?.name === PREVIEW_CHANNEL && c.type === ChannelType.GuildText)) as TextChannel | undefined;
  if (!channel) {
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      const list = channels.filter((c) => c?.type === ChannelType.GuildText).map((c) => `  ${c!.id}  #${c!.name}`).join("\n");
      throw new Error(`no #${PREVIEW_CHANNEL} and the bot lacks Manage Channels. Create it by hand, or set DISCORD_PREVIEW_CHANNEL_ID to one of:\n${list}`);
    }
    channel = await guild.channels.create({ name: PREVIEW_CHANNEL, type: ChannelType.GuildText, topic: "pnpm discord:preview posts every Tether card here." });
    console.log(`created #${PREVIEW_CHANNEL}`);
  }

  if (opts.clear && channel.name === PREVIEW_CHANNEL) {
    const old = await channel.messages.fetch({ limit: 100 });
    const mine = old.filter((m) => m.author.id === client.user!.id);
    const recent = mine.filter((m) => Date.now() - m.createdTimestamp < 13 * 86400_000);
    if (recent.size > 1) await channel.bulkDelete(recent).catch(() => undefined);
    else for (const m of recent.values()) await m.delete().catch(() => undefined);
    for (const m of mine.filter((m) => !recent.has(m.id)).values()) await m.delete().catch(() => undefined);
  }

  return { client, channel, guildId, url: `https://discord.com/channels/${guildId}/${channel.id}` };
}
