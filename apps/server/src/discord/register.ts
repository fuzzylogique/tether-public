import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

const token = process.env.DISCORD_TOKEN!, clientId = process.env.DISCORD_CLIENT_ID!, guildId = process.env.DISCORD_DEV_GUILD_ID;
const rest = new REST().setToken(token);
if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log(`registered ${commands.length} guild commands in ${guildId}`);
} else {
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`registered ${commands.length} global commands`);
}
