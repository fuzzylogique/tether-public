import { ChannelType, type Guild, type TextChannel } from "discord.js";
import { eq } from "drizzle-orm";
import { TEAM_CHANNELS, calendarIcsUrl, calendarUrl, db, driveFolderUrl, schema, sheetUrl } from "@tether/core";

type Org = typeof schema.orgs.$inferSelect;

const CATEGORY = "Tether";

/** Shared links so teammates can see the organizer's Google data without the organizer's login. */
export function linksText(org: Org) {
  const lines = [`📌 **${org.name} · shared links**`];
  if (org.calendarId) {
    lines.push(`📅 Calendar: <${calendarUrl(org.calendarId)}>`);
    lines.push(`　Subscribe in your own Google Calendar → Other calendars → From URL: \`${calendarIcsUrl(org.calendarId)}\``);
  }
  if (org.sheetId) lines.push(`📊 Budget / sponsors / tasks sheet: <${sheetUrl(org.sheetId)}>`);
  if (org.driveFolderId) lines.push(`📁 Drive folder: <${driveFolderUrl(org.driveFolderId)}>`);
  lines.push(`Team channels: ${TEAM_CHANNELS.map((t) => (org.channels[t.key] ? `<#${org.channels[t.key]}>` : `#${t.name}`)).join(" ")}`);
  return lines.join("\n");
}

/**
 * Create (or reuse) a "Tether" category with one channel per team and point the org's
 * team channel keys at them. Participant-facing keys (announcements, help) are left alone.
 */
export async function provisionTeamChannels(guild: Guild, org: Org) {
  const all = await guild.channels.fetch();
  const category = all.find((c) => c?.type === ChannelType.GuildCategory && c.name === CATEGORY)
    ?? await guild.channels.create({ name: CATEGORY, type: ChannelType.GuildCategory });

  const channels = { ...org.channels };
  const created: string[] = [];
  for (const t of TEAM_CHANNELS) {
    let ch = all.find((c): c is TextChannel => c?.type === ChannelType.GuildText && c.parentId === category.id && c.name === t.name);
    if (!ch) {
      ch = await guild.channels.create({ name: t.name, type: ChannelType.GuildText, parent: category.id, topic: t.topic });
      created.push(t.key);
    }
    channels[t.key] = ch.id;
  }
  await db().update(schema.orgs).set({ channels }).where(eq(schema.orgs.id, org.id));
  const updated = { ...org, channels };

  // Pin the shared links where people will look for them, once, when the channel is new.
  for (const key of ["ops", "calendar"]) {
    if (!created.includes(key)) continue;
    const ch = await guild.channels.fetch(channels[key]!);
    if (ch?.type !== ChannelType.GuildText) continue;
    const msg = await ch.send({ content: linksText(updated), allowedMentions: { parse: [] } });
    await msg.pin().catch((e) => console.warn(`could not pin links in #${ch.name}`, e));
  }
  return { org: updated, created };
}
