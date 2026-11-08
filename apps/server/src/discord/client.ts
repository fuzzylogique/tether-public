import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { env } from "@tether/core";
import { onGuildJoin, onInteraction, onMessage } from "./handlers.js";
import { loadEmojis } from "./ui/emoji.js";

export async function startDiscord() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message],
  });
  client.on(Events.InteractionCreate, (i) => onInteraction(i).catch((e) => console.error("interaction error", e)));
  client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => console.error("message error", e)));
  client.on(Events.GuildCreate, (g) => onGuildJoin(g).catch((e) => console.error("guild join error", e)));
  client.once(Events.ClientReady, async (c) => {
    console.log(`discord ready as ${c.user.tag}`);
    await c.application.fetch().catch(() => undefined);
    console.log(`app emojis: ${await loadEmojis(c)} (unicode fallback for the rest)`);
  });
  const token = env().DISCORD_TOKEN;
  if (!token) { console.warn("DISCORD_TOKEN not set; running without Discord"); return client; }
  await client.login(token);
  return client;
}
