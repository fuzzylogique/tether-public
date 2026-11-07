/**
 * `pnpm discord:preview` — posts one of every card, built from fixture data, into
 * #tether-preview in DISCORD_DEV_GUILD_ID. This is the acceptance tool for the UI work
 * (docs/DISCORD_UI.md §11): no Inngest, no Gemini, no database.
 *
 *   pnpm discord:preview                 clear old previews, post everything
 *   pnpm discord:preview -- plan status  only fixtures whose name contains one of the words
 *   pnpm discord:preview -- --keep       do not delete earlier preview messages
 *
 * Uses DISCORD_PREVIEW_CHANNEL_ID when set, else #tether-preview (created if the bot can).
 */
import "../../env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits, type TextChannel } from "discord.js";
import { fixtures } from "@tether/core";
import { loadEmojis } from "./emoji.js";
import { render } from "./render.js";

const CHANNEL = "tether-preview";
const args = process.argv.slice(2).filter((a) => a !== "--");
const keep = args.includes("--keep");
const filters = args.filter((a) => !a.startsWith("--"));
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
let channel = (override ? channels.get(override) : channels.find((c) => c?.name === CHANNEL && c.type === ChannelType.GuildText)) as TextChannel | undefined;
if (!channel) {
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    const list = channels.filter((c) => c?.type === ChannelType.GuildText).map((c) => `  ${c!.id}  #${c!.name}`).join("\n");
    throw new Error(`no #${CHANNEL} and the bot lacks Manage Channels. Create it by hand, or set DISCORD_PREVIEW_CHANNEL_ID to one of:\n${list}`);
  }
  channel = await guild.channels.create({ name: CHANNEL, type: ChannelType.GuildText, topic: "pnpm discord:preview posts every Tether card here." });
  console.log(`created #${CHANNEL}`);
}

// Only ever clear the dedicated preview channel, never a real one picked via the override.
if (!keep && channel.name === CHANNEL) {
  const old = await channel.messages.fetch({ limit: 100 });
  const mine = old.filter((m) => m.author.id === client.user!.id);
  const recent = mine.filter((m) => Date.now() - m.createdTimestamp < 13 * 86400_000);
  if (recent.size > 1) await channel.bulkDelete(recent).catch(() => undefined);
  else for (const m of recent.values()) await m.delete().catch(() => undefined);
  for (const m of mine.filter((m) => !recent.has(m.id)).values()) await m.delete().catch(() => undefined);
}

const outDir = join(new URL("../../..", import.meta.url).pathname, ".preview");
mkdirSync(outDir, { recursive: true });

let posted = 0, failed = 0;
for (const f of fixtures()) {
  if (filters.length && !filters.some((w) => f.name.includes(w))) continue;
  try {
    const payload = await render(f.card);
    for (const file of payload.files) {
      if (typeof file.name === "string" && Buffer.isBuffer(file.attachment)) writeFileSync(join(outDir, `${f.name}--${file.name}`), file.attachment);
    }
    await channel.send(payload);
    posted++;
    console.log(`✓ ${f.name}${payload.files.length ? ` (${payload.files.map((x) => `${x.name} ${Math.round((x.attachment as Buffer).length / 1024)}KB`).join(", ")})` : ""}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${f.name}:`, e instanceof Error ? e.message : e, (e as { rawError?: unknown }).rawError ? JSON.stringify((e as { rawError?: unknown }).rawError) : "");
  }
}
console.log(`${posted} posted, ${failed} failed → https://discord.com/channels/${guildId}/${channel.id}`);
await client.destroy();
process.exit(failed ? 1 : 0);
