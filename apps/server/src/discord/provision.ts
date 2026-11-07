/** One-off: create the team channels in DISCORD_DEV_GUILD_ID without running `/tether channels`. `pnpm discord:channels` */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { Client, GatewayIntentBits } from "discord.js";
import { loadOrgByGuild } from "@tether/core";
import { provisionTeamChannels } from "./teams.js";

const guildId = process.env.DISCORD_DEV_GUILD_ID!;
const org = await loadOrgByGuild(guildId);
if (!org) throw new Error("org not seeded; run /tether setup first");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(process.env.DISCORD_TOKEN);
const guild = await client.guilds.fetch(guildId);
const { org: updated, created } = await provisionTeamChannels(guild, org);
console.log(`created: ${created.join(", ") || "none"}`);
console.log(Object.entries(updated.channels).map(([k, v]) => `${k} → ${v}`).join("\n"));
await client.destroy();
process.exit(0);
