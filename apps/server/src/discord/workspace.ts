import { PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { and, eq } from "drizzle-orm";
import {
  INTEGRATIONS, METRICS, daysUntil, db, env, integrationStatus, schema, setGoal, setIntegration, workspaceSummary,
  type IntegrationKey, type MetricKey, type Progress,
} from "@tether/core";

type Org = typeof schema.orgs.$inferSelect;

const integrationChoices = INTEGRATIONS.map((i) => ({ name: i.label, value: i.key }));
const metricChoices = METRICS.map((m) => ({ name: m.label, value: m.key }));

/** Workspace = this Discord server. Settings commands default to people who can manage the server. */
export const workspaceCommands = [
  new SlashCommandBuilder().setName("workspace").setDescription("This event's workspace")
    .addSubcommand((s) => s.setName("overview").setDescription("Goals, today's schedule, inbox and recent agent work"))
    .addSubcommand((s) => s.setName("date").setDescription("Set the event start date for the countdown")
      .addStringOption((o) => o.setName("date").setDescription("YYYY-MM-DD, optionally with HH:MM (Toronto time)").setRequired(true)))
    .addSubcommand((s) => s.setName("web").setDescription("Let an email address sign in to this workspace on the web")
      .addStringOption((o) => o.setName("email").setDescription("The email you sign in with").setRequired(true))),

  new SlashCommandBuilder().setName("integrations").setDescription("Which Google services the agents may use in this workspace")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName("status").setDescription("Show what is connected"))
    .addSubcommand((s) => s.setName("connect").setDescription("Let the agents use a service")
      .addStringOption((o) => o.setName("service").setDescription("Service").setRequired(true).addChoices(...integrationChoices)))
    .addSubcommand((s) => s.setName("disconnect").setDescription("Stop the agents from using a service")
      .addStringOption((o) => o.setName("service").setDescription("Service").setRequired(true).addChoices(...integrationChoices))),

  new SlashCommandBuilder().setName("goal").setDescription("Targets shown on the workspace overview")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName("set").setDescription("Set a target, e.g. sponsorship 20000 or registrations 500")
      .addStringOption((o) => o.setName("metric").setDescription("Metric").setRequired(true).addChoices(...metricChoices))
      .addNumberOption((o) => o.setName("target").setDescription("Target").setRequired(true).setMinValue(0)))
    .addSubcommand((s) => s.setName("update").setDescription("Correct the current count when the bot has it wrong")
      .addStringOption((o) => o.setName("metric").setDescription("Metric").setRequired(true).addChoices(...metricChoices.filter((m) => m.value !== "sponsorship")))
      .addNumberOption((o) => o.setName("value").setDescription("Current count").setRequired(true).setMinValue(0))),
].map((c) => c.toJSON());

const money = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

function bar(p: Progress | undefined, unit: "money" | "count", label: string, hint: string) {
  if (!p) return `**${label}**: not tracked yet. ${hint}`;
  const f = unit === "money" ? money : (n: number) => n.toLocaleString("en-CA");
  if (!p.target) return `**${label}**: ${f(p.current)} (no target set; ${hint})`;
  const pct = Math.round((p.current / p.target) * 100);
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `**${label}**: ${f(p.current)} of ${f(p.target)}\n\`${"█".repeat(filled)}${"░".repeat(10 - filled)}\` ${pct}%`;
}

const canManage = (i: ChatInputCommandInteraction) => !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

function parseEventDate(input: string) {
  const m = input.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return undefined;
  const local = `${m[1]}T${(m[2] ?? "9").padStart(2, "0")}:${m[3] ?? "00"}:00`;
  // Resolve the Toronto offset for that day (EST or EDT).
  const probe = new Date(`${local}Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", timeZoneName: "longOffset" })
    .formatToParts(probe).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
  const d = new Date(`${local}${offset}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function onWorkspaceCommand(i: ChatInputCommandInteraction, org: Org) {
  const sub = i.options.getSubcommand();
  const key = `${i.commandName}:${sub}`;
  const webUrl = `${env().WEB_PUBLIC_URL.replace(/\/$/, "")}/w/${org.id}`;

  if (key === "workspace:overview") {
    await i.deferReply();
    const s = await workspaceSummary(org);
    const days = daysUntil(s.org.eventStartAt);
    const countdown = days === undefined ? "No event date. `/workspace date`" : days > 0 ? `${days} day${days === 1 ? "" : "s"} to go` : days === 0 ? "Event day" : `Ended ${-days} days ago`;
    const peopleParts = s.people.parts.map((p) => `${p.label} ${p.current}${p.target !== undefined ? `/${p.target}` : ""}`).join(" · ");
    const fmtTime = (iso: string) => iso.length <= 10 ? "all day" : new Date(iso).toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" });
    const lines = [
      `## ${s.org.name}`,
      countdown,
      "",
      bar(s.sponsorship, "money", "Sponsorship", "`/goal set sponsorship`"),
      bar(s.budget, "money", "Budget spent", "add budget lines in the Budget tab"),
      bar(s.registrations, "count", "Registrations", "`/goal set registrations`"),
      bar(s.people.total, "count", "People confirmed", "`/goal set volunteers`") + (peopleParts ? `\n-# ${peopleParts}` : ""),
      "",
      `**Today**: ${s.todaySource === "off" ? "Calendar is disconnected." : s.today.length ? s.today.slice(0, 5).map((e) => `${fmtTime(e.start)} ${e.title}`).join(" · ") : "Nothing scheduled."}`,
      `**Inbox**: ${s.inbox.count ? `${s.inbox.count} sponsor thread${s.inbox.count === 1 ? "" : "s"} waiting on a reply${s.inbox.threads.length ? ` (${s.inbox.threads.map((t) => t.sponsor).join(", ")})` : ""}` : "Nothing waiting."}`,
      s.pendingApprovals ? `**Approvals**: ${s.pendingApprovals} waiting` : "",
      "",
      s.activity.length ? `**Recent agent work**\n${s.activity.map((a) => `• ${a.summary} <t:${Math.floor(a.at.getTime() / 1000)}:R>`).join("\n")}` : "",
      `-# Full view: ${webUrl}`,
    ].filter((l, idx, arr) => !(l === "" && arr[idx - 1] === ""));
    return i.editReply({ content: lines.join("\n").slice(0, 2000), allowedMentions: { parse: [] } });
  }

  if (key === "workspace:date") {
    if (!canManage(i)) return i.reply({ content: "You need the Manage Server permission to change workspace settings.", ephemeral: true });
    const d = parseEventDate(i.options.getString("date", true));
    if (!d) return i.reply({ content: "Use `YYYY-MM-DD`, optionally with a time: `2026-11-07 09:00`.", ephemeral: true });
    await db().update(schema.orgs).set({ eventStartAt: d }).where(eq(schema.orgs.id, org.id));
    return i.reply({ content: `Event starts <t:${Math.floor(d.getTime() / 1000)}:F>.`, ephemeral: true });
  }

  if (key === "workspace:web") {
    if (!canManage(i)) return i.reply({ content: "You need the Manage Server permission to give web access.", ephemeral: true });
    const email = i.options.getString("email", true).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return i.reply({ content: "That doesn't look like an email address.", ephemeral: true });
    const [existing] = await db().select().from(schema.users).where(and(eq(schema.users.orgId, org.id), eq(schema.users.discordId, i.user.id)));
    if (existing) await db().update(schema.users).set({ email }).where(eq(schema.users.id, existing.id));
    else await db().insert(schema.users).values({ orgId: org.id, discordId: i.user.id, name: i.user.displayName, email });
    return i.reply({ content: `${email} can now open **${org.name}** at ${webUrl} after signing in.`, ephemeral: true });
  }

  if (key === "integrations:status") {
    // No workspaceSummary here: it calls Google Calendar, and this reply has to land inside Discord's 3s window.
    const word = { connected: "connected", off: "disconnected", needs_setup: "on, needs setup" } as const;
    return i.reply({ ephemeral: true, content: INTEGRATIONS.map((x) => `• **${x.label}**: ${word[integrationStatus(org, x.key)]}\n-# ${x.description}`).join("\n") + `\n-# Toggle these on the web too: ${webUrl}` });
  }

  if (key === "integrations:connect" || key === "integrations:disconnect") {
    const service = i.options.getString("service", true) as IntegrationKey;
    const on = sub === "connect";
    await setIntegration(org.id, service, on);
    await db().insert(schema.events).values({ orgId: org.id, kind: "integration_changed", data: { integration: service, enabled: on, by: i.user.id, via: "discord" } });
    const label = INTEGRATIONS.find((x) => x.key === service)!.label;
    return i.reply({ ephemeral: true, content: on ? `**${label}** is connected for ${org.name}.` : `**${label}** is disconnected. The agents in ${org.name} will not use it until you run \`/integrations connect\`.` });
  }

  if (key === "goal:set" || key === "goal:update") {
    const metric = i.options.getString("metric", true) as MetricKey;
    const label = METRICS.find((m) => m.key === metric)!.label;
    if (key === "goal:set") {
      const target = i.options.getNumber("target", true);
      await setGoal(org.id, metric, { target, source: `set by ${i.user.displayName}` });
      return i.reply({ ephemeral: true, content: `${label} target: ${metric === "sponsorship" ? money(target) : target}.` });
    }
    const value = i.options.getNumber("value", true);
    await setGoal(org.id, metric, { current: value, source: `corrected by ${i.user.displayName}` });
    return i.reply({ ephemeral: true, content: `${label} is now ${value}.` });
  }
}

export const WORKSPACE_COMMANDS = new Set(["workspace", "integrations", "goal"]);
