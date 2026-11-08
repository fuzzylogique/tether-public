import { ApplicationCommandOptionType, type APIApplicationCommandOption, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { env, type CommandDoc } from "@tether/core";
import { commands } from "./commands.js";

/**
 * The registered slash commands as data for the `/help` Commands topic (docs/GUIDE.md §3.2), derived
 * from the same definitions `pnpm discord:register` uploads, so the guide cannot drift from the bot.
 */
let cache: CommandDoc[] | undefined;

function option(o: APIApplicationCommandOption) {
  return { name: o.name, description: o.description, required: !!o.required };
}

export function commandCatalog(): CommandDoc[] {
  if (cache) return cache;
  cache = (commands as RESTPostAPIChatInputApplicationCommandsJSONBody[]).map((c) => {
    const opts = c.options ?? [];
    const subs = opts.filter((o) => o.type === ApplicationCommandOptionType.Subcommand);
    return {
      name: c.name,
      description: c.description,
      subcommands: subs.length
        ? subs.map((s) => ({ name: s.name, description: s.description, options: ("options" in s && s.options ? s.options : []).map(option) }))
        : [{ description: c.description, options: opts.map(option) }],
    };
  });
  return cache;
}

/** Link for the "Open docs" button; Discord link buttons need a public https URL (same rule as `dashboardRunUrl`). */
export function docsUrl(): string | undefined {
  const base = env().WEB_PUBLIC_URL.replace(/\/$/, "");
  return base.startsWith("https://") ? `${base}/docs` : undefined;
}
