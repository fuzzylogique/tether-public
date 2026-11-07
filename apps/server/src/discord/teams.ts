import { ChannelType, type Guild, type TextChannel } from "discord.js";
import { eq } from "drizzle-orm";
import { AGENT_CHANNEL, CHANNEL_ROLE, TEAM_CHANNELS, TEAM_ROLES, calendarIcsUrl, calendarUrl, db, driveFolderUrl, schema, sheetUrl } from "@tether/core";

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
  const roles = TEAM_ROLES.filter((r) => org.roles[r.key]).map((r) => `<@&${org.roles[r.key]}>`);
  if (roles.length) lines.push(`Team roles: ${roles.join(" ")}`);
  const bound = Object.entries(org.channelAgents).map(([ch, agent]) => `<#${ch}> → ${agent}`);
  if (bound.length) lines.push(`Bound channels (messages go straight to the agent): ${bound.join(", ")}`);
  return lines.join("\n");
}

/**
 * Create (or reuse) a "Tether" category with one channel per team and point the org's
 * team channel keys at them. Participant-facing keys (announcements, help) are left alone.
 * `roles` also creates one Discord role per team (Lead, Finance, Sponsorship, Socials, Logistics)
 * so escalations and approvals can ping the people who own that channel; `bind` makes each team
 * channel a Tier 1 channel for its agent, so a plain message in #finance goes to the finance agent.
 */
export async function provisionTeamChannels(guild: Guild, org: Org, opts: { roles?: boolean; bind?: boolean } = {}) {
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

  const roles = { ...org.roles };
  const createdRoles: string[] = [];
  if (opts.roles) {
    const existing = await guild.roles.fetch();
    for (const r of TEAM_ROLES) {
      if (roles[r.key] && existing.has(roles[r.key]!)) continue;
      const found = existing.find((x) => x.name === r.name);
      const role = found ?? await guild.roles.create({ name: r.name, color: r.color, mentionable: true, reason: "Tether team role" });
      if (!found) createdRoles.push(r.key);
      roles[r.key] = role.id;
    }
  }

  const channelAgents = { ...org.channelAgents };
  if (opts.bind) {
    const agentByChannelKey = Object.fromEntries(Object.entries(AGENT_CHANNEL).filter(([agent]) => agent !== "helpdesk").map(([agent, key]) => [key, agent]));
    for (const [key, id] of Object.entries(channels)) {
      const agent = agentByChannelKey[key];
      if (agent) channelAgents[id] = agent;
    }
  }

  await db().update(schema.orgs).set({ channels, roles, channelAgents }).where(eq(schema.orgs.id, org.id));
  const updated = { ...org, channels, roles, channelAgents };

  // Channel topics name the owning role once roles exist.
  if (opts.roles) {
    for (const t of TEAM_CHANNELS) {
      const roleId = roles[CHANNEL_ROLE[t.key] ?? ""];
      const ch = await guild.channels.fetch(channels[t.key]!).catch(() => null);
      if (roleId && ch?.type === ChannelType.GuildText && !ch.topic?.includes("<@&")) await ch.setTopic(`${t.topic} Owned by <@&${roleId}>.`).catch(() => undefined);
    }
  }

  // Pin the shared links where people will look for them, once, when the channel is new.
  for (const key of ["ops", "calendar"]) {
    if (!created.includes(key)) continue;
    const ch = await guild.channels.fetch(channels[key]!);
    if (ch?.type !== ChannelType.GuildText) continue;
    const msg = await ch.send({ content: linksText(updated), allowedMentions: { parse: [] } });
    await msg.pin().catch((e) => console.warn(`could not pin links in #${ch.name}`, e));
  }
  return { org: updated, created, createdRoles };
}
