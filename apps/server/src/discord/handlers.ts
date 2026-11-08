import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
  type Guild, type Interaction, type Message, type ChatInputCommandInteraction, type AutocompleteInteraction,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { and, desc, eq, gt, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import {
  WORKFLOWS, acceptDriveInvite, agentNames, agents, applyEdit, approvalCardFor, budgetCard, buildInboxDigest, buildToolCtx, calendarCard, cancelRun, dashboardRunUrl, db, digestCard, driveInviteFor, editFieldsFor, fieldValue, getTool, hasRole, helpCard, inngest, isHelpTopic, isLiveRun, loadActor,
  loadOrgByGuild, planCard, refreshRunCard, schema, settledDecision, sponsorsCard, tasksCard, teamChannelFor, welcomeCard, workflowNames,
  type ApprovalDecision, type BudgetExtras, type BudgetRow, type EventRow, type Plan, type PlanDecision, type SponsorRow, type TaskRow,
} from "@tether/core";
import { planEmbed, resultEmbed } from "./embeds.js";
import { DiscordNotifier, planComponents } from "./notifier.js";
import { render, renderEdit } from "./ui/render.js";
import { linksText, provisionTeamChannels } from "./teams.js";
import { commandCatalog, docsUrl } from "./catalog.js";

type Org = typeof schema.orgs.$inferSelect;

async function requireOrg(i: ChatInputCommandInteraction): Promise<Org | undefined> {
  if (!i.guildId) { await i.reply({ content: "Use this in a server.", ephemeral: true }); return; }
  const org = await loadOrgByGuild(i.guildId);
  if (!org && i.commandName !== "tether" && i.commandName !== "help") { await i.reply({ content: "This server isn't set up yet. Run `/tether setup`.\n-# New here? `/help start`", ephemeral: true }); return; }
  return org;
}

async function emitRequest(org: Org, i: ChatInputCommandInteraction, data: {
  mode: "auto" | "agent"; agent?: string; text: string; trigger?: "slash" | "mention" | "thread"; threadId?: string;
  attachments?: { url: string; contentType?: string; name?: string }[]; context?: string;
}) {
  const reply = await i.fetchReply();
  // Single-agent runs render in that team's channel (finance → #finance) once `/tether channels`
  // has provisioned them, so the channel the command was typed in only gets a pointer. Plans
  // (mode auto) stay where they were asked for: the people in that conversation review them.
  const team = data.mode === "agent" && data.agent && !data.threadId ? teamChannelFor(org, data.agent) : undefined;
  const channelId = team && team !== i.channelId ? team : i.channelId;
  if (channelId !== i.channelId) await i.editReply({ content: `${agents()[data.agent!]?.label ?? data.agent} is on it in <#${channelId}>.`, allowedMentions: { parse: [] } });
  await inngest.send({
    name: "tether/request.received",
    data: {
      orgId: org.id, trigger: data.trigger ?? "slash", mode: data.mode, agent: data.agent, text: data.text, context: data.context,
      source: { channelId, messageId: channelId === i.channelId ? reply.id : undefined, threadId: data.threadId },
      actorDiscordId: i.user.id, actorName: i.user.displayName, attachments: data.attachments,
    },
  });
}

/** The last N human messages in a channel as a transcript the planner can reason over. */
async function channelTranscript(i: ChatInputCommandInteraction, n: number, beforeId?: string) {
  if (!i.channel || !("messages" in i.channel)) return { text: "", count: 0 };
  const batch = await i.channel.messages.fetch({ limit: Math.min(100, n), ...(beforeId ? { before: beforeId } : {}) });
  const msgs = [...batch.values()].filter((m) => !m.author.bot && m.content.trim()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const lines = msgs.map((m) => `[${fmt.format(m.createdAt)}] ${m.member?.displayName ?? m.author.displayName}: ${m.cleanContent.replace(/\s+/g, " ").slice(0, 600)}`);
  let text = lines.join("\n");
  if (text.length > 9000) text = `…\n${text.slice(-9000)}`;
  return { text, count: msgs.length };
}

/** Tier 0: run a read-only tool directly, no LLM. */
/** `/post … instagram:true` publishes to the org's Instagram account; otherwise the post stays in Discord. */
function publishTo(i: ChatInputCommandInteraction) {
  return i.options.getBoolean("instagram") ? "publish it to Instagram with post_instagram and also post the announcement" : "post the announcement";
}

async function runToolDirect(org: Org, i: ChatInputCommandInteraction, toolName: string, args: Record<string, unknown>) {
  const tool = getTool(toolName);
  if (!tool || tool.effect !== "read") throw new Error(`tool ${toolName} is not a direct read tool`);
  const actor = await loadActor(org.id, i.user.id, i.user.displayName);
  const ctx = await buildToolCtx({ orgId: org.id, actor, runId: "00000000-0000-0000-0000-000000000000", agent: "direct", notify: undefined as never });
  return tool.execute(tool.input.parse(args), ctx);
}

export async function onInteraction(i: Interaction) {
  if (i.isAutocomplete()) return onAutocomplete(i);
  if (i.isChatInputCommand()) return onCommand(i);
  if (i.isButton()) return onButton(i.customId, i);
  if (i.isStringSelectMenu()) return onSelect(i.customId, i.values, i);
  if (i.isModalSubmit()) return onModal(i.customId, i);
}

async function onAutocomplete(i: AutocompleteInteraction) {
  const focused = i.options.getFocused(true);
  const q = String(focused.value).toLowerCase();
  if (focused.name === "agent" || (focused.name === "name" && i.commandName !== "workflow")) {
    return i.respond(agentNames().filter((n) => n.includes(q)).slice(0, 25).map((n) => ({ name: `${agents()[n]!.label} — ${agents()[n]!.description}`.slice(0, 100), value: n })));
  }
  if (focused.name === "name" && i.commandName === "workflow") {
    return i.respond(workflowNames().filter((n) => n.includes(q)).slice(0, 25).map((n) => ({ name: `${WORKFLOWS[n]!.label} — ${WORKFLOWS[n]!.description}`.slice(0, 100), value: n })));
  }
  if (focused.name === "category" && i.guildId) {
    const org = await loadOrgByGuild(i.guildId);
    if (!org) return i.respond([]);
    const rows = await db().select({ c: schema.budgetLines.category }).from(schema.budgetLines).where(eq(schema.budgetLines.orgId, org.id));
    return i.respond(rows.map((r) => r.c).filter((c) => c.toLowerCase().includes(q)).slice(0, 25).map((c) => ({ name: c, value: c })));
  }
  return i.respond([]);
}

/**
 * `/help`: an ephemeral guide card with a topic select (docs/GUIDE.md §3). No org needed, so a server
 * that is not set up yet can still read how to set up. `help_opened` events let the dashboard see
 * which topics people read; without an org there is nowhere to record them.
 */
async function onHelp(i: ChatInputCommandInteraction, org: Org | undefined) {
  const picked = i.options.getString("topic") ?? undefined;
  const topic = isHelpTopic(picked) ? picked : "home";
  await i.reply({ ...(await render(helpCard(topic, { commands: commandCatalog(), docsUrl: docsUrl() }))), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  if (org) await db().insert(schema.events).values({ orgId: org.id, kind: "help_opened", data: { topic, discordId: i.user.id } });
}

/** A topic pick or Home on the help card: swap the body in place and note the topic. */
async function onHelpTopic(i: StringSelectMenuInteraction | ButtonInteraction, picked: string | undefined) {
  const topic = isHelpTopic(picked) ? picked : "home";
  await i.update(await renderEdit(helpCard(topic, { commands: commandCatalog(), docsUrl: docsUrl() })));
  const org = i.guildId ? await loadOrgByGuild(i.guildId) : undefined;
  if (org) await db().insert(schema.events).values({ orgId: org.id, kind: "help_opened", data: { topic, discordId: i.user.id } });
}

/**
 * The bot was added to a server (docs/GUIDE.md §4): post the welcome card once, to the system channel
 * when it can speak there, else the first text channel it can. Nothing is stored; `/help` is always there.
 */
export async function onGuildJoin(guild: Guild) {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  const canPost = (c: { permissionsFor: (m: typeof me & object) => { has: (p: bigint) => boolean } | null } | null) =>
    !!me && !!c && !!c.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages);
  const system = guild.systemChannel && canPost(guild.systemChannel) ? guild.systemChannel : undefined;
  const channel = system ?? (await guild.channels.fetch()).find((c) => c?.type === ChannelType.GuildText && canPost(c));
  if (!channel || channel.type !== ChannelType.GuildText) return console.warn(`joined ${guild.name} but can post nowhere`);
  await channel.send(await render(welcomeCard({ docsUrl: docsUrl() })));
}

async function onCommand(i: ChatInputCommandInteraction) {
  if (i.commandName === "help") {
    const org = i.guildId ? await loadOrgByGuild(i.guildId) : undefined;
    return onHelp(i, org);
  }
  const org = await requireOrg(i);
  if (i.commandName === "tether") return onTether(i, org);
  if (!org) return;
  const sub = i.options.getSubcommand(false);
  await i.deferReply();

  switch (`${i.commandName}:${sub ?? ""}`) {
    case "budget:summary": {
      const category = i.options.getString("category") ?? undefined;
      const r = (await runToolDirect(org, i, "budget_summary", { category })) as { rows: BudgetRow[]; totals: { allocated: number; spent: number; remaining: number } } & BudgetExtras;
      const sheetUrl = org.sheetId ? `https://docs.google.com/spreadsheets/d/${org.sheetId}` : undefined;
      return i.editReply(await render(budgetCard({ ...r, sheetUrl, category })));
    }
    case "budget:log":
      return emitRequest(org, i, { mode: "agent", agent: "finance", text: `Log an expense: amount ${i.options.getNumber("amount")}, category ${i.options.getString("category")}, vendor ${i.options.getString("vendor") ?? "n/a"}, description ${i.options.getString("description") ?? "n/a"}. Then report the category status.` });
    case "budget:receipt": {
      const att = i.options.getAttachment("image", true);
      return emitRequest(org, i, { mode: "agent", agent: "finance", text: `A receipt image is attached. Parse it, pick the best budget category, log the expense, and report the category status. ${i.options.getString("note") ?? ""}`, attachments: [{ url: att.url, contentType: att.contentType ?? undefined, name: att.name }] });
    }
    case "sponsor:list": {
      const stage = i.options.getString("stage") ?? undefined;
      const rows = (await runToolDirect(org, i, "list_sponsors", { stage })) as SponsorRow[];
      return i.editReply(await render(sponsorsCard({ sponsors: rows, stage })));
    }
    case "sponsor:followup":
      return emitRequest(org, i, { mode: "agent", agent: "outreach", text: `Find sponsors we have not contacted in ${i.options.getInteger("days") ?? 5} days (stages contacted, replied, negotiating). For each, write a short follow-up email and send it (each send will be approved by a human).` });
    case "sponsor:ask":
      return emitRequest(org, i, { mode: "agent", agent: "outreach", text: i.options.getString("request", true) });
    case "task:list": {
      const overdueOnly = i.options.getBoolean("overdue") ?? false;
      const rows = (await runToolDirect(org, i, "list_tasks", { overdueOnly })) as TaskRow[];
      // Owners' Discord avatars as section thumbnails, best effort.
      const avatars = new Map<string, string>();
      await Promise.all([...new Set(rows.map((t) => t.ownerDiscordId).filter((x): x is string => !!x))].map((id) =>
        i.client.users.fetch(id).then((u) => avatars.set(id, u.displayAvatarURL({ size: 128, extension: "png" }))).catch(() => undefined)));
      const tasks = rows.map((t) => ({ ...t, avatarUrl: t.ownerDiscordId ? avatars.get(t.ownerDiscordId) : undefined }));
      return i.editReply(await render(tasksCard({ tasks, overdueOnly })));
    }
    case "task:add": {
      const owner = i.options.getUser("owner");
      return emitRequest(org, i, { mode: "agent", agent: "coordination", text: `Create a task "${i.options.getString("title", true)}"${owner ? ` owned by ${owner.displayName} (discord id ${owner.id})` : ""}${i.options.getString("due") ? ` due ${i.options.getString("due")}` : ""}. Confirm with the resolved due date.` });
    }
    case "cal:today": {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const rows = (await runToolDirect(org, i, "list_events", { from: start.toISOString(), to: end.toISOString() })) as EventRow[] | { error: string };
      if (!Array.isArray(rows)) return i.editReply({ embeds: [resultEmbed("calendar", "Today", rows.error)] });
      const calendarUrl = org.calendarId ? `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(org.calendarId)}` : undefined;
      return i.editReply(await render(calendarCard({ events: rows, dayStart: start.getTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, calendarUrl })));
    }
    case "cal:add":
      return emitRequest(org, i, { mode: "agent", agent: "calendar", text: i.options.getString("request", true) });
    case "post:draft":
      return emitRequest(org, i, { mode: "agent", agent: "socials", text: `Draft a ${i.options.getString("platform") ?? "instagram"} post. Brief: ${i.options.getString("brief", true)}. Generate copy and a hero image, then ${publishTo(i)} (will be approved).` });
    case "post:recap": {
      const n = i.options.getInteger("photos") ?? 4;
      const brief = i.options.getString("brief") ?? "Recap of the event so far";
      return emitRequest(org, i, { mode: "agent", agent: "socials", text: `Create a ${i.options.getString("platform") ?? "instagram"} recap post from the team's photos. Brief: ${brief}. List the event photos, pick the best ${n} with captions, write copy that matches them, then ${publishTo(i)} with those photos (will be approved).` });
    }
    case "plan:": {
      const request = i.options.getString("request")?.trim();
      const fromChat = i.options.getInteger("from_chat") ?? undefined;
      if (!request && !fromChat) return i.editReply("Give me a request, or set `from_chat` to plan from the last N messages here.");
      if (!fromChat) return emitRequest(org, i, { mode: "auto", text: request! });
      const reply = await i.fetchReply();
      const { text: transcript, count } = await channelTranscript(i, fromChat, reply.id);
      if (!count) return i.editReply("No human messages to read in this channel.");
      const channelName = i.channel && "name" in i.channel && i.channel.name ? `#${i.channel.name}` : "this channel";
      const text = request
        ? `${request}\n(planned from the last ${count} messages in ${channelName})`
        : `Turn the team's discussion in ${channelName} (last ${count} messages) into a plan: what was decided, who owns what, and the next concrete actions.`;
      return emitRequest(org, i, { mode: "auto", text, context: `Chat transcript from ${channelName}, oldest first:\n${transcript}` });
    }
    case "digest:": {
      const hours = i.options.getInteger("hours") ?? 24;
      const digest = await buildInboxDigest({ hours, query: i.options.getString("query") ?? undefined }).catch((e: Error) => e);
      if (digest instanceof Error) return i.editReply(`Could not read the inbox: ${digest.message.slice(0, 300)}`);
      await db().insert(schema.events).values({ orgId: org.id, kind: "inbox_digest", agent: "outreach", data: { hours, scanned: digest.scanned, by: i.user.id } });
      return i.editReply(await render(digestCard(digest)));
    }
    case "workflow:list":
      return i.editReply({
        content: Object.values(WORKFLOWS).map((w) => `⚙️ **${w.label}** \`${w.name}\` → <#${org.channels[w.channel] ?? org.channels["ops"] ?? "unset"}>\n-# ${w.description}\n-# steps: ${w.build(w.params.parse({ sponsor: "Acme" })).steps.map((st) => `${agents()[st.agent]?.label ?? st.agent}${st.needsApproval ? " 🔒" : ""}`).join(" → ")}`).join("\n\n")
          + "\n\nFires on: a sponsor moving to **confirmed** (`sponsor-confirmed`), or `/workflow run`.",
        allowedMentions: { parse: [] },
      });
    case "workflow:run": {
      const name = i.options.getString("name", true);
      const wf = WORKFLOWS[name];
      if (!wf) return i.editReply(`Unknown workflow. Try: ${workflowNames().join(", ")}`);
      const raw = {
        sponsor: i.options.getString("sponsor") ?? undefined, amount: i.options.getNumber("amount") ?? undefined, tier: i.options.getString("tier") ?? undefined,
        contactName: i.options.getString("contact") ?? undefined, contactEmail: i.options.getString("email") ?? undefined, notes: i.options.getString("notes") ?? undefined,
      };
      const params = wf.params.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)));
      if (!params.success) return i.editReply(`Missing or invalid input: ${params.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
      await inngest.send({ name: "tether/workflow.triggered", data: { orgId: org.id, name, params: params.data as Record<string, unknown>, actorDiscordId: i.user.id, actorName: i.user.displayName, source: { channelId: i.channelId } } });
      const target = org.channels[wf.channel] ?? org.channels["ops"] ?? i.channelId;
      return i.editReply({ content: `⚙️ **${wf.label}** started: ${wf.describe(params.data)} → <#${target}>`, allowedMentions: { parse: [] } });
    }
    case "agent:": {
      const name = i.options.getString("name", true);
      if (!agents()[name]) return i.editReply(`Unknown agent. Try: ${agentNames().join(", ")}`);
      const reply = await i.editReply(`Opening a thread with **${agents()[name]!.label}**…`);
      if (i.channel?.type !== ChannelType.GuildText) return;
      const thread = await reply.startThread({ name: `${agents()[name]!.label}: ${i.options.getString("request", true).slice(0, 60)}` });
      await db().insert(schema.agentSessions).values({ threadId: thread.id, orgId: org.id, agent: name, messages: [] }).onConflictDoNothing();
      await inngest.send({
        name: "tether/request.received",
        data: { orgId: org.id, trigger: "thread", mode: "agent", agent: name, text: i.options.getString("request", true), source: { channelId: i.channelId, threadId: thread.id }, actorDiscordId: i.user.id, actorName: i.user.displayName },
      });
      return;
    }
    default:
      return i.editReply("Unknown command.");
  }
}

async function onTether(i: ChatInputCommandInteraction, org: Org | undefined) {
  const sub = i.options.getSubcommand();
  if (sub === "setup") {
    await i.deferReply({ ephemeral: true });
    const channels = { ...(org?.channels ?? {}) };
    for (const k of ["ops", "announcements", "sponsorship", "photos"]) { const ch = i.options.getChannel(k); if (ch) channels[k] = ch.id; }
    const values = {
      guildId: i.guildId!, name: i.options.getString("name") ?? org?.name ?? i.guild?.name ?? "Event",
      sheetId: i.options.getString("sheet_id") ?? org?.sheetId, calendarId: i.options.getString("calendar_id") ?? org?.calendarId, channels,
    };
    await db().insert(schema.orgs).values(values).onConflictDoUpdate({ target: schema.orgs.guildId, set: values });
    await db().insert(schema.brandKits).values({ orgId: (await loadOrgByGuild(i.guildId!))!.id }).onConflictDoNothing();
    return i.editReply(`Configured **${values.name}**. Channels: ${Object.entries(channels).map(([k, v]) => `${k} → <#${v}>`).join(", ") || "none"}.\n-# Next: \`/tether channels\` for team channels and roles, then \`/help start\`.`);
  }
  if (!org) return i.reply({ content: "Run `/tether setup` first.", ephemeral: true });
  if (sub === "bind") {
    const ch = i.options.getChannel("channel", true), agent = i.options.getString("agent", true);
    if (!agents()[agent]) return i.reply({ content: "Unknown agent.", ephemeral: true });
    await db().update(schema.orgs).set({ channelAgents: { ...org.channelAgents, [ch.id]: agent } }).where(eq(schema.orgs.id, org.id));
    return i.reply({ content: `Messages in <#${ch.id}> now go to **${agents()[agent]!.label}**.`, ephemeral: true });
  }
  if (sub === "channels") {
    if (!i.guild) return i.reply({ content: "Use this in a server.", ephemeral: true });
    await i.deferReply({ ephemeral: true });
    const roles = i.options.getBoolean("roles") ?? true;
    const bind = i.options.getBoolean("bind") ?? false;
    const res = await provisionTeamChannels(i.guild, org, { roles, bind }).catch((e: { code?: number }) => {
      if (e.code === 50013) return undefined;
      throw e;
    });
    if (!res) return i.editReply("I need the **Manage Channels** (and **Manage Roles**, for team roles) permission. Grant them to my role in Server Settings → Roles, then run this again.");
    const { org: updated, created, createdRoles } = res;
    const parts = [
      created.length ? `Created ${created.length} channels.` : "Team channels already exist.",
      roles ? (createdRoles.length ? `Created ${createdRoles.length} roles; assign people to them so escalations and approvals reach the right team.` : "Team roles already exist.") : "",
      bind ? "Plain messages in each team channel now go to that team's agent." : "",
    ].filter(Boolean).join(" ");
    return i.editReply(`${parts}\n\n${linksText(updated)}\n-# Next: try \`/plan request:…\`; \`/help plans\` explains the cards.`);
  }
  if (sub === "links") return i.reply({ content: linksText(org), allowedMentions: { parse: [] } });
  if (sub === "policies") {
    const rows = await db().select().from(schema.policies).where(eq(schema.policies.orgId, org.id));
    return i.reply({ ephemeral: true, content: rows.length ? rows.map((p) => `• \`${p.tool}\` → **${p.decision}** ${Object.keys(p.condition).length ? `when ${JSON.stringify(p.condition)}` : ""}`).join("\n") : "No org policies; defaults apply (reads run, low-risk writes run, everything else asks)." });
  }
  if (sub === "status") {
    const rows = await db().select().from(schema.runs).where(eq(schema.runs.orgId, org.id)).orderBy(schema.runs.createdAt).limit(10);
    return i.reply({ ephemeral: true, content: rows.length ? rows.reverse().map((r) => `• ${r.status} · ${r.request.slice(0, 60)} · <t:${Math.floor(r.createdAt.getTime() / 1000)}:R>`).join("\n") : "No runs yet." });
  }
}

async function loadRun(runId: string) {
  const [run] = await db().select().from(schema.runs).where(eq(schema.runs.id, runId));
  return run;
}

type Run = typeof schema.runs.$inferSelect;
type ActionRow = typeof schema.actions.$inferSelect;
type Interactive = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

/**
 * Acknowledge inside Discord's 3-second window before any DB or Inngest work. Component clicks and
 * modals opened from a message are deferred as an update (so `editReply` redraws the card in place);
 * a modal with no message gets an ephemeral reply. Returns whether the card itself can be edited.
 */
async function ack(i: Interactive): Promise<boolean> {
  if (i.isModalSubmit()) {
    if (i.isFromMessage()) { await i.deferUpdate(); return true; }
    await i.deferReply({ ephemeral: true });
    return false;
  }
  await i.deferUpdate();
  return true;
}

/** Ephemeral note after `ack`: a follow-up when the card was deferred, otherwise the deferred reply itself. */
function notice(i: Interactive, inMessage: boolean, content: string) {
  return inMessage ? i.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } }) : i.editReply({ content, allowedMentions: { parse: [] } });
}

/** Re-render a plan message in place: a V2 card, or the legacy embed for messages posted before the migration. */
async function updatePlan(i: Interactive, run: Run, plan: Plan, decision?: PlanDecision) {
  if (i.isModalSubmit() && !i.isFromMessage()) return;
  if (i.message?.embeds.length) {
    const status = decision ? `${decision.status[0]!.toUpperCase()}${decision.status.slice(1)}${decision.by ? ` by ${decision.by}` : ""}` : undefined;
    return i.editReply({ embeds: [planEmbed(run.id, run.request, plan, status)], components: decision ? [] : planComponents(run.id, plan) });
  }
  return i.editReply(await renderEdit(planCard({
    runId: run.id, request: run.request, plan, requester: { discordId: run.actorDiscordId }, createdAt: run.createdAt,
    decision, dashboardUrl: dashboardRunUrl(run.id),
  })));
}

/** The decision a plan card should show for a run that is no longer `proposed`, when repairing a stale card. */
function planDecisionFor(run: Run): PlanDecision | undefined {
  switch (run.status) {
    case "proposed": return undefined;
    case "cancelled": return { status: "cancelled", at: run.updatedAt };
    case "expired": return { status: "expired", at: run.updatedAt };
    default: return { status: "approved", at: run.updatedAt };
  }
}

/** Re-render an approval message in place with its decision (buttons removed). */
async function updateApproval(i: Interactive, action: ActionRow, decision: ApprovalDecision, args?: Record<string, unknown>) {
  if (i.isModalSubmit() && !i.isFromMessage()) return;
  if (i.message?.embeds.length) {
    const embed = i.message.embeds[0];
    const label = decision.status === "rejected" ? "❌ Rejected" : decision.status === "approved" ? "⏳ Approved" : `${decision.status[0]!.toUpperCase()}${decision.status.slice(1)}`;
    return i.editReply({ content: `${label}${decision.by ? ` by ${decision.by}` : ""}`, embeds: embed ? [embed] : [], components: [] });
  }
  const [org] = await db().select().from(schema.orgs).where(eq(schema.orgs.id, action.orgId));
  if (!org) return i.editReply({ components: [] });
  return i.editReply(await renderEdit(await approvalCardFor(org, action, decision, args)));
}

/** Discord role ids of the member who pressed a button; the interaction carries them, no member intent needed. */
function memberRoleIds(i: Interactive): string[] {
  const roles = i.member?.roles;
  if (!roles) return [];
  return Array.isArray(roles) ? roles : [...roles.cache.keys()];
}

/**
 * Tether roles of the person pressing a button: their `users` row (organizer by default) plus every
 * team whose Discord role they hold (`/tether channels roles:true` creates Lead, Finance, …).
 */
async function effectiveRoles(i: Interactive, org: Org): Promise<string[]> {
  const held = new Set(memberRoleIds(i));
  const team = Object.entries(org.roles).filter(([, id]) => held.has(id)).map(([key]) => key);
  const actor = await loadActor(org.id, i.user.id, i.user.displayName);
  return [...new Set([...actor.roles, ...team])];
}

/** `true` when the member may act at `need` (docs/CARDS.md §6), otherwise the ephemeral refusal text. */
async function mayAct(i: Interactive, org: Org, need: string): Promise<true | string> {
  if (hasRole(await effectiveRoles(i, org), need)) return true;
  const roleId = org.roles[need];
  return `This needs a **${need}**${roleId ? ` (<@&${roleId}>)` : ""}. The card is unchanged.`;
}

/** Requester or organizer+: who may run, cancel or edit a plan. */
async function mayDecidePlan(i: Interactive, org: Org, run: Run) {
  return run.actorDiscordId === i.user.id ? true : mayAct(i, org, "organizer");
}

const loadOrg = async (orgId: string) => (await db().select().from(schema.orgs).where(eq(schema.orgs.id, orgId)))[0];
const loadAction = async (id: string) => (await db().select().from(schema.actions).where(eq(schema.actions.id, id)))[0];

/** A click on an approval card whose row is no longer pending: redraw the card from the row and say why. */
async function repairApproval(i: Interactive, inMessage: boolean, action: ActionRow) {
  const decision = settledDecision(action);
  if (decision && inMessage) await updateApproval(i, action, decision).catch((e) => console.warn("approval repair failed", e));
  return notice(i, inMessage, `This action is already **${action.status}**${action.approverDiscordId ? ` (by <@${action.approverDiscordId}>)` : ""}.`);
}

/** A click on a plan card whose run is no longer proposed: redraw it from the run row and say why. */
async function repairPlan(i: Interactive, inMessage: boolean, run: Run) {
  if (inMessage && run.plan) await updatePlan(i, run, run.plan, planDecisionFor(run)).catch((e) => console.warn("plan repair failed", e));
  return notice(i, inMessage, `This plan is already **${run.status}**.`);
}

async function onButton(customId: string, i: ButtonInteraction) {
  const [kind, verb, id, sub] = customId.split(":");
  if (kind === "help" && verb === "home") return onHelpTopic(i, "home");
  if (kind === "help" && verb === "open") {
    return i.reply({ ...(await render(helpCard("home", { commands: commandCatalog(), docsUrl: docsUrl() }))), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  }
  if (kind === "access" && verb === "share" && id) {
    const check = await driveInviteFor({ inviteId: id, discordId: i.user.id, memberRoleIds: memberRoleIds(i) });
    if ("error" in check) return i.reply({ content: check.error, ephemeral: true });
    const input = new TextInputBuilder().setCustomId("email").setLabel("Google email").setStyle(TextInputStyle.Short)
      .setPlaceholder("you@gmail.com").setRequired(true).setMaxLength(254);
    if (check.email) input.setValue(check.email);
    return i.showModal(new ModalBuilder().setCustomId(`access:submit:${id}`).setTitle("Team Drive access")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
  }
  if (kind === "run" && id) return onRunButton(verb ?? "", id, i);
  if (kind === "plan" && id) {
    const run = await loadRun(id);
    if (!run?.plan) return i.reply({ content: "This plan no longer exists.", ephemeral: true });
    if (verb === "run" || verb === "cancel" || verb === "toggle") {
      await ack(i);
      if (run.status !== "proposed") return repairPlan(i, true, run);
      const org = await loadOrg(run.orgId);
      const allowed = org ? await mayDecidePlan(i, org, run) : true;
      if (allowed !== true) return notice(i, true, allowed);
      if (verb === "toggle") {
        if (!sub) return;
        const plan: Plan = { ...run.plan, steps: run.plan.steps.map((s) => (s.id === sub ? { ...s, enabled: !s.enabled } : s)) };
        await db().update(schema.runs).set({ plan, updatedAt: new Date() }).where(eq(schema.runs.id, id));
        return updatePlan(i, run, plan);
      }
      // Compare-and-set so two people pressing Run at once start one run; the loser sees the repaired card.
      const approved = verb === "run";
      const [claimed] = await db().update(schema.runs)
        .set({ status: approved ? "approved" : "cancelled", cancelledBy: approved ? null : i.user.id, updatedAt: new Date() })
        .where(and(eq(schema.runs.id, id), eq(schema.runs.status, "proposed"))).returning();
      if (!claimed) return repairPlan(i, true, (await loadRun(id)) ?? run);
      // Redraw first, then wake the waiter: the executor's own status card edits never race this one.
      await updatePlan(i, run, run.plan, { status: approved ? "approved" : "cancelled", by: i.user.displayName, at: new Date() }).catch((e) => console.warn("plan re-render failed", e));
      await inngest.send({ name: "tether/plan.decided", data: { runId: id, approved, plan: run.plan, deciderDiscordId: i.user.id } });
      return;
    }
    if (verb === "edit") {
      if (run.status !== "proposed") return i.reply({ content: `This plan is already ${run.status}.`, ephemeral: true });
      const modal = new ModalBuilder().setCustomId(`plan:editsubmit:${id}`).setTitle("Edit plan steps");
      for (const s of run.plan.steps.slice(0, 5)) {
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId(s.id).setLabel(`${s.id} · ${agents()[s.agent]?.label ?? s.agent}`.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setValue(s.instruction.slice(0, 1000)).setRequired(false)));
      }
      return i.showModal(modal);
    }
  }
  if (kind === "action" && id) {
    const action = await loadAction(id);
    if (!action) return i.reply({ content: "Action not found.", ephemeral: true });
    if (verb === "approve") {
      await ack(i);
      if (action.status !== "pending") return repairApproval(i, true, action);
      const org = await loadOrg(action.orgId);
      const allowed = org ? await mayAct(i, org, action.approverRole ?? "organizer") : true;
      if (allowed !== true) {
        await db().insert(schema.events).values({ orgId: action.orgId, runId: action.runId, kind: "approval_denied_role", agent: action.agent, data: { actionId: id, by: i.user.id, need: action.approverRole ?? "organizer" } });
        return notice(i, true, allowed);
      }
      return decideAction(i, action, true);
    }
    // Edit and Reject open a modal, which has to be the interaction's first response: no defer here.
    if (verb === "edit" || verb === "reject") {
      if (action.status !== "pending") { await ack(i); return repairApproval(i, true, action); }
      const org = await loadOrg(action.orgId);
      const allowed = org ? await mayAct(i, org, action.approverRole ?? "organizer") : true;
      if (allowed !== true) return i.reply({ content: allowed, ephemeral: true, allowedMentions: { parse: [] } });
      if (verb === "reject") {
        return i.showModal(new ModalBuilder().setCustomId(`action:rejectsubmit:${id}`).setTitle(`Reject: ${action.summary.slice(0, 37)}`)
          .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("reason").setLabel("Reason (optional, the agent sees it)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500))));
      }
      // Fields come from the tool definition (docs/CARDS.md §9); tools without `editFields` get one JSON field.
      const modal = new ModalBuilder().setCustomId(`action:editsubmit:${id}`).setTitle(`Edit: ${action.summary.slice(0, 39)}`);
      for (const f of editFieldsFor(getTool(action.tool))) {
        const input = new TextInputBuilder().setCustomId(f.key).setLabel(f.label.slice(0, 45))
          .setStyle(f.style === "short" ? TextInputStyle.Short : TextInputStyle.Paragraph).setRequired(!!f.required).setMaxLength(4000);
        const value = fieldValue(action.args, f.key).slice(0, 4000);
        if (value) input.setValue(value);
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      }
      return i.showModal(modal);
    }
  }
}

/**
 * Stop on the status card (docs/CARDS.md §7). `run:stop` asks in an ephemeral prompt; `run:stopconfirm`
 * does the cleanup through `cancelRun`, which redraws every card of the run and wakes Inngest. A Stop
 * on a run that already ended redraws the status card from its rows instead.
 */
async function onRunButton(verb: string, runId: string, i: ButtonInteraction) {
  const run = await loadRun(runId);
  if (!run) return i.reply({ content: "Run not found.", ephemeral: true });
  const org = await loadOrg(run.orgId);
  const notifier = new DiscordNotifier(i.client);
  if (verb === "stop") {
    if (!isLiveRun(run.status)) {
      await ack(i);
      await refreshRunCard(runId, notifier).catch((e) => console.warn("status repair failed", e));
      return notice(i, true, `This run is already **${run.status}**.`);
    }
    const allowed = org ? await mayDecidePlan(i, org, run) : true;
    if (allowed !== true) return i.reply({ content: allowed, ephemeral: true, allowedMentions: { parse: [] } });
    return i.reply({
      ephemeral: true, allowedMentions: { parse: [] },
      content: `Stop **${run.request.replace(/\s+/g, " ").slice(0, 120)}**?\n-# Tool calls already in flight finish; nothing new starts. Approval cards still waiting on this run close.`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`run:stopconfirm:${runId}`).setLabel("Stop run").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`run:keep:${runId}`).setLabel("Keep running").setStyle(ButtonStyle.Secondary),
      )],
    });
  }
  if (verb === "keep") return i.update({ content: "Still running.", components: [] });
  if (verb === "stopconfirm") {
    await i.update({ content: "Stopping…", components: [] });
    const allowed = org ? await mayDecidePlan(i, org, run) : true;
    if (allowed !== true) return i.editReply({ content: allowed, allowedMentions: { parse: [] } });
    const res = await cancelRun({ runId, by: i.user.id, byName: i.user.displayName, notifier });
    if (!res.ok) return i.editReply({ content: `This run is already **${res.status ?? "gone"}**.` });
    const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
    return i.editReply({ content: `⏹ Stopped. ${n(res.closed, "waiting approval")} closed; ${n(res.executed, "approved action")} had already run.` });
  }
}

/**
 * A human decided a pending action. Claim the row with a compare-and-set (pending → approved | rejected),
 * redraw the card from the claim, then wake the waiting step function. Redraw before send so the
 * executor's final render (executed / failed) can never be overwritten by this one.
 */
async function decideAction(i: Interactive, action: ActionRow, approved: boolean, opts: { note?: string } = {}) {
  const inMessage = !(i.isModalSubmit() && !i.isFromMessage());
  const now = new Date();
  const [claimed] = await db().update(schema.actions)
    .set({ status: approved ? "approved" : "rejected", approverDiscordId: i.user.id, decidedAt: now, decisionNote: opts.note })
    .where(and(eq(schema.actions.id, action.id), eq(schema.actions.status, "pending"))).returning();
  if (!claimed) return repairApproval(i, inMessage, (await loadAction(action.id)) ?? action);
  if (inMessage) {
    await updateApproval(i, claimed, { status: approved ? "approved" : "rejected", by: i.user.displayName, at: now, note: opts.note })
      .catch((e) => console.warn("approval re-render failed", e));
  }
  // Edited args are already on the row (saved by the Edit modal), so the executor reads them from there.
  await inngest.send({
    name: "tether/action.decided",
    data: { actionId: action.id, runId: action.runId, approved, note: opts.note, deciderDiscordId: i.user.id, deciderName: i.user.displayName },
  });
  if (!inMessage) await notice(i, false, approved ? "Approved." : "Rejected.");
}

async function onSelect(customId: string, values: string[], i: StringSelectMenuInteraction) {
  const [kind, verb, id] = customId.split(":");
  if (kind === "help" && verb === "topic") return onHelpTopic(i, values[0]);
  if (kind !== "plan" || verb !== "select" || !id) return;
  const run = await loadRun(id);
  if (!run?.plan) return i.reply({ content: "Plan not found.", ephemeral: true });
  await ack(i);
  if (run.status !== "proposed") return repairPlan(i, true, run);
  const org = await loadOrg(run.orgId);
  const allowed = org ? await mayDecidePlan(i, org, run) : true;
  if (allowed !== true) return notice(i, true, allowed);
  const plan: Plan = { ...run.plan, steps: run.plan.steps.map((s) => ({ ...s, enabled: values.includes(s.id) })) };
  await db().update(schema.runs).set({ plan, updatedAt: new Date() }).where(eq(schema.runs.id, id));
  await updatePlan(i, run, plan);
}

async function onModal(customId: string, i: ModalSubmitInteraction) {
  const [kind, verb, id] = customId.split(":");
  if (kind === "access" && verb === "submit" && id) {
    await i.deferReply({ ephemeral: true });
    const res = await acceptDriveInvite({ inviteId: id, discordId: i.user.id, name: i.user.displayName, memberRoleIds: memberRoleIds(i), email: i.fields.getTextInputValue("email") });
    if (!("folderUrl" in res)) return i.editReply(res.error ?? "Could not share the folder.");
    return i.editReply(`📁 Done. You have ${res.access === "reader" ? "view" : "edit"} access to the team folder${res.calendar ? " and the team calendar" : ""}: <${res.folderUrl}>\nGoogle also sent you an email invite.`);
  }
  if (kind === "plan" && verb === "editsubmit" && id) {
    const run = await loadRun(id);
    if (!run?.plan) return i.reply({ content: "Plan not found.", ephemeral: true });
    const inMessage = await ack(i);
    if (run.status !== "proposed") return repairPlan(i, inMessage, run);
    const plan: Plan = { ...run.plan, steps: run.plan.steps.map((s) => {
      const v = (i.fields.fields.has(s.id) ? i.fields.getTextInputValue(s.id) : "").trim();
      return v ? { ...s, instruction: v } : s;
    }) };
    await db().update(schema.runs).set({ plan, planHistory: [...run.planHistory, plan], updatedAt: new Date() }).where(eq(schema.runs.id, id));
    if (inMessage) await updatePlan(i, run, plan);
    else await notice(i, false, "Plan updated.");
    return;
  }
  if (kind === "action" && (verb === "editsubmit" || verb === "rejectsubmit") && id) {
    const action = await loadAction(id);
    if (!action) return i.reply({ content: "Action not found.", ephemeral: true });
    const inMessage = await ack(i);
    if (action.status !== "pending") return repairApproval(i, inMessage, action);
    const org = await loadOrg(action.orgId);
    const allowed = org ? await mayAct(i, org, action.approverRole ?? "organizer") : true;
    if (allowed !== true) return notice(i, inMessage, allowed);

    if (verb === "rejectsubmit") {
      const reason = i.fields.fields.has("reason") ? i.fields.getTextInputValue("reason").trim() : "";
      return decideAction(i, action, false, { note: reason || undefined });
    }

    // Save, do not approve: the card re-renders pending with the new args and an edit line (docs/CARDS.md §9).
    const tool = getTool(action.tool);
    if (!tool) return notice(i, inMessage, `Tool \`${action.tool}\` no longer exists.`);
    const fields = Object.fromEntries(editFieldsFor(tool).filter((f) => i.fields.fields.has(f.key)).map((f) => [f.key, i.fields.getTextInputValue(f.key)]));
    const res = applyEdit(tool, action.args, fields);
    if (!res.ok) return notice(i, inMessage, `Not saved.\n${res.error}`);
    if (!res.changed.length) return notice(i, inMessage, "Nothing changed.");
    const now = new Date();
    const [row] = await db().update(schema.actions)
      .set({ args: res.args, summary: tool.summarize(res.args), editedBy: i.user.id, editedAt: now, editedFields: res.changed })
      .where(and(eq(schema.actions.id, id), eq(schema.actions.status, "pending"))).returning();
    if (!row) return repairApproval(i, inMessage, (await loadAction(id)) ?? action);
    await db().insert(schema.events).values({ orgId: row.orgId, runId: row.runId, kind: "action_edited", agent: row.agent, data: { actionId: id, by: i.user.id, fields: res.changed } });
    if (inMessage && org) {
      return i.editReply(await renderEdit(await approvalCardFor(org, row, undefined, undefined, { by: i.user.displayName, at: now, fields: res.changed })));
    }
    return notice(i, inMessage, `Saved: ${res.changed.join(", ")} changed. Approve the card when it reads right.`);
  }
}

/**
 * The task this person has an *unanswered* nudge for (nudged in the last 72h, no reply since),
 * in one org or any. Once they have answered, later messages are ordinary requests again.
 */
async function nudgedTaskFor(discordId: string, orgId?: string) {
  const t = schema.tasks;
  const since = new Date(Date.now() - 72 * 3600_000);
  const [row] = await db().select().from(t)
    .where(and(
      eq(t.ownerDiscordId, discordId), ne(t.status, "done"), isNotNull(t.lastNudgedAt), gt(t.lastNudgedAt, since),
      or(isNull(t.lastReplyAt), lt(t.lastReplyAt, t.lastNudgedAt)),
      ...(orgId ? [eq(t.orgId, orgId)] : []),
    ))
    .orderBy(desc(t.lastNudgedAt)).limit(1);
  return row;
}

/** Which org a DM belongs to: the one they are a user of, else the one whose tasks they own. Undefined when ambiguous. */
async function orgForDm(discordId: string) {
  const u = await db().select({ orgId: schema.users.orgId }).from(schema.users).where(eq(schema.users.discordId, discordId));
  const t = await db().select({ orgId: schema.tasks.orgId }).from(schema.tasks).where(eq(schema.tasks.ownerDiscordId, discordId));
  const ids = [...new Set([...u, ...t].map((r) => r.orgId))];
  return ids.length === 1 ? ids[0] : undefined;
}

async function onDirectMessage(m: Message) {
  const text = m.content.trim();
  if (!text) return;
  const attachments = [...m.attachments.values()].map((a) => ({ url: a.url, contentType: a.contentType ?? undefined, name: a.name }));
  // A DM from someone with an open nudge is their answer to it, whatever they typed.
  const task = await nudgedTaskFor(m.author.id);
  if (task) {
    await m.react("👀").catch(() => undefined);
    await inngest.send({ name: "tether/nudge.replied", data: { orgId: task.orgId, taskId: task.id, ownerDiscordId: m.author.id, ownerName: m.author.displayName, text, source: {} } });
    return;
  }
  const orgId = await orgForDm(m.author.id);
  if (!orgId) { await m.reply("I only answer DMs from people I know from a server. Ask me in your event's Discord instead."); return; }
  await m.react("⏳").catch(() => undefined);
  await inngest.send({ name: "tether/request.received", data: { orgId, trigger: "dm", mode: "auto", text, source: { channelId: m.channelId, messageId: m.id }, actorDiscordId: m.author.id, actorName: m.author.displayName, attachments } });
}

export async function onMessage(m: Message) {
  if (m.author.bot) return;
  if (!m.guildId) return onDirectMessage(m);
  const org = await loadOrgByGuild(m.guildId);
  if (!org) return;
  const botId = m.client.user?.id;
  const mentioned = !!botId && m.mentions.users.has(botId);
  const attachments = [...m.attachments.values()].map((a) => ({ url: a.url, contentType: a.contentType ?? undefined, name: a.name }));
  const text = m.content.replace(/<@!?\d+>/g, "").trim();

  // A reply to one of Tether's messages in #tasks (or an @mention there) from someone with an
  // open nudge is their answer to the nudge, not a new request.
  const inTasks = m.channelId === org.channels["tasks"] || m.channelId === org.channels["ops"];
  const repliedToBot = !!m.reference?.messageId && (await m.fetchReference().catch(() => null))?.author.id === botId;
  if (inTasks && (repliedToBot || mentioned) && text) {
    const task = await nudgedTaskFor(m.author.id, org.id);
    if (task) {
      await m.react("👀").catch(() => undefined);
      await inngest.send({ name: "tether/nudge.replied", data: { orgId: org.id, taskId: task.id, ownerDiscordId: m.author.id, ownerName: m.member?.displayName ?? m.author.displayName, text, source: { channelId: m.channelId, messageId: m.id } } });
      return;
    }
  }

  // Tier 1: thread session
  if (m.channel.isThread()) {
    const [session] = await db().select().from(schema.agentSessions).where(eq(schema.agentSessions.threadId, m.channel.id));
    if (session) {
      await m.react("⏳").catch(() => undefined);
      await inngest.send({ name: "tether/request.received", data: { orgId: org.id, trigger: "thread", mode: "agent", agent: session.agent, text, source: { channelId: m.channel.parentId ?? m.channelId, threadId: m.channel.id, messageId: m.id }, actorDiscordId: m.author.id, actorName: m.author.displayName, attachments } });
      return;
    }
  }
  // Tier 1: channel bound to an agent
  const bound = org.channelAgents[m.channelId];
  if (bound && (mentioned || !m.content.startsWith("/"))) {
    await m.react("⏳").catch(() => undefined);
    await inngest.send({ name: "tether/request.received", data: { orgId: org.id, trigger: "mention", mode: "agent", agent: bound, text, source: { channelId: m.channelId, messageId: m.id }, actorDiscordId: m.author.id, actorName: m.author.displayName, attachments } });
    return;
  }
  // Tier 2: mention → orchestrator
  if (mentioned && text) {
    await m.react("⏳").catch(() => undefined);
    await inngest.send({ name: "tether/request.received", data: { orgId: org.id, trigger: "mention", mode: "auto", text, source: { channelId: m.channelId, messageId: m.id }, actorDiscordId: m.author.id, actorName: m.author.displayName, attachments } });
  }
}
