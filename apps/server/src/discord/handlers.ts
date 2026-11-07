import {
  ActionRowBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type Message, type ChatInputCommandInteraction, type AutocompleteInteraction,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { eq } from "drizzle-orm";
import {
  agentNames, agents, approvalCardFor, budgetCard, buildToolCtx, calendarCard, dashboardRunUrl, db, getTool, inngest, loadActor,
  loadOrgByGuild, planCard, schema, sponsorsCard, tasksCard,
  type ApprovalDecision, type BudgetExtras, type BudgetRow, type EventRow, type Plan, type PlanDecision, type SponsorRow, type TaskRow,
} from "@tether/core";
import { planEmbed, resultEmbed } from "./embeds.js";
import { planComponents } from "./notifier.js";
import { render, renderEdit } from "./ui/render.js";
import { linksText, provisionTeamChannels } from "./teams.js";

type Org = typeof schema.orgs.$inferSelect;

async function requireOrg(i: ChatInputCommandInteraction): Promise<Org | undefined> {
  if (!i.guildId) { await i.reply({ content: "Use this in a server.", ephemeral: true }); return; }
  const org = await loadOrgByGuild(i.guildId);
  if (!org && i.commandName !== "tether") { await i.reply({ content: "This server isn't set up yet. Run `/tether setup`.", ephemeral: true }); return; }
  return org;
}

async function emitRequest(org: Org, i: ChatInputCommandInteraction, data: {
  mode: "auto" | "agent"; agent?: string; text: string; trigger?: "slash" | "mention" | "thread"; threadId?: string;
  attachments?: { url: string; contentType?: string; name?: string }[];
}) {
  const reply = await i.fetchReply();
  await inngest.send({
    name: "tether/request.received",
    data: {
      orgId: org.id, trigger: data.trigger ?? "slash", mode: data.mode, agent: data.agent, text: data.text,
      source: { channelId: i.channelId, messageId: reply.id, threadId: data.threadId },
      actorDiscordId: i.user.id, actorName: i.user.displayName, attachments: data.attachments,
    },
  });
}

/** Tier 0: run a read-only tool directly, no LLM. */
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
  if (focused.name === "agent" || focused.name === "name") {
    return i.respond(agentNames().filter((n) => n.includes(q)).slice(0, 25).map((n) => ({ name: `${agents()[n]!.label} — ${agents()[n]!.description}`.slice(0, 100), value: n })));
  }
  if (focused.name === "category" && i.guildId) {
    const org = await loadOrgByGuild(i.guildId);
    if (!org) return i.respond([]);
    const rows = await db().select({ c: schema.budgetLines.category }).from(schema.budgetLines).where(eq(schema.budgetLines.orgId, org.id));
    return i.respond(rows.map((r) => r.c).filter((c) => c.toLowerCase().includes(q)).slice(0, 25).map((c) => ({ name: c, value: c })));
  }
  return i.respond([]);
}

async function onCommand(i: ChatInputCommandInteraction) {
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
      return emitRequest(org, i, { mode: "agent", agent: "socials", text: `Draft a ${i.options.getString("platform") ?? "instagram"} post. Brief: ${i.options.getString("brief", true)}. Generate copy and a hero image, then post the announcement (will be approved).` });
    case "plan:":
      return emitRequest(org, i, { mode: "auto", text: i.options.getString("request", true) });
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
    for (const k of ["ops", "announcements", "sponsorship"]) { const ch = i.options.getChannel(k); if (ch) channels[k] = ch.id; }
    const values = {
      guildId: i.guildId!, name: i.options.getString("name") ?? org?.name ?? i.guild?.name ?? "Event",
      sheetId: i.options.getString("sheet_id") ?? org?.sheetId, calendarId: i.options.getString("calendar_id") ?? org?.calendarId, channels,
    };
    await db().insert(schema.orgs).values(values).onConflictDoUpdate({ target: schema.orgs.guildId, set: values });
    await db().insert(schema.brandKits).values({ orgId: (await loadOrgByGuild(i.guildId!))!.id }).onConflictDoNothing();
    return i.editReply(`Configured **${values.name}**. Channels: ${Object.entries(channels).map(([k, v]) => `${k} → <#${v}>`).join(", ") || "none"}.`);
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
    const res = await provisionTeamChannels(i.guild, org).catch((e: { code?: number }) => {
      if (e.code === 50013) return undefined;
      throw e;
    });
    if (!res) return i.editReply("I need the **Manage Channels** permission to create team channels. Grant it to my role in Server Settings → Roles, then run this again.");
    const { org: updated, created } = res;
    return i.editReply(`${created.length ? `Created ${created.length} channels.` : "Team channels already exist."}\n\n${linksText(updated)}`);
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
type Interactive = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

/** Re-render a plan message: a V2 card, or the legacy embed for messages posted before the migration. */
async function updatePlan(i: Interactive, run: Run, plan: Plan, decision?: PlanDecision) {
  if (!("update" in i)) return;
  if (i.message?.embeds.length) {
    const status = decision ? `${decision.approved ? "Approved" : "Cancelled"} by ${decision.by}` : undefined;
    return i.update({ embeds: [planEmbed(run.id, run.request, plan, status)], components: decision ? [] : planComponents(run.id, plan) });
  }
  return i.update(await renderEdit(planCard({
    runId: run.id, request: run.request, plan, requester: { discordId: run.actorDiscordId }, createdAt: run.createdAt,
    decision, dashboardUrl: dashboardRunUrl(run.id),
  })));
}

/** Re-render an approval message with its decision (buttons removed). */
async function updateApproval(i: Interactive, action: typeof schema.actions.$inferSelect, decision: ApprovalDecision, args?: Record<string, unknown>) {
  if (!("update" in i)) return;
  if (i.message?.embeds.length) {
    const embed = i.message.embeds[0];
    const label = decision.status === "edited" ? "✏️ Edited and approved" : decision.status === "rejected" ? "❌ Rejected" : "✅ Approved";
    return i.update({ content: `${label} by ${decision.by}`, embeds: embed ? [embed] : [], components: [] });
  }
  const [org] = await db().select().from(schema.orgs).where(eq(schema.orgs.id, action.orgId));
  if (!org) return i.update({ components: [] });
  return i.update(await renderEdit(await approvalCardFor(org, action, decision, args)));
}

async function onButton(customId: string, i: ButtonInteraction) {
  const [kind, verb, id, sub] = customId.split(":");
  if (kind === "plan" && id) {
    const run = await loadRun(id);
    if (!run?.plan) return i.reply({ content: "This plan no longer exists.", ephemeral: true });
    if (verb === "run" || verb === "cancel") {
      await inngest.send({ name: "tether/plan.decided", data: { runId: id, approved: verb === "run", plan: run.plan, deciderDiscordId: i.user.id } });
      await updatePlan(i, run, run.plan, { approved: verb === "run", by: i.user.displayName, at: new Date() });
      return;
    }
    if (verb === "toggle" && sub) {
      if (run.status !== "proposed") return i.reply({ content: `This plan is already ${run.status}.`, ephemeral: true });
      const plan: Plan = { ...run.plan, steps: run.plan.steps.map((s) => (s.id === sub ? { ...s, enabled: !s.enabled } : s)) };
      await db().update(schema.runs).set({ plan, updatedAt: new Date() }).where(eq(schema.runs.id, id));
      await updatePlan(i, run, plan);
      return;
    }
    if (verb === "edit") {
      const modal = new ModalBuilder().setCustomId(`plan:editsubmit:${id}`).setTitle("Edit plan steps");
      for (const s of run.plan.steps.slice(0, 5)) {
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId(s.id).setLabel(`${s.id} · ${agents()[s.agent]?.label ?? s.agent}`.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setValue(s.instruction.slice(0, 1000)).setRequired(false)));
      }
      return i.showModal(modal);
    }
  }
  if (kind === "action" && id) {
    const [action] = await db().select().from(schema.actions).where(eq(schema.actions.id, id));
    if (!action) return i.reply({ content: "Action not found.", ephemeral: true });
    if (action.status !== "pending") return i.reply({ content: `Already ${action.status}.`, ephemeral: true });
    if (verb === "approve" || verb === "reject") {
      await inngest.send({ name: "tether/action.decided", data: { actionId: id, runId: action.runId, approved: verb === "approve", deciderDiscordId: i.user.id, deciderName: i.user.displayName } });
      await updateApproval(i, action, { status: verb === "approve" ? "approved" : "rejected", by: i.user.displayName, at: new Date() });
      return;
    }
    if (verb === "edit") {
      const modal = new ModalBuilder().setCustomId(`action:editsubmit:${id}`).setTitle(`Edit: ${action.summary.slice(0, 40)}`);
      const fields = action.tool === "send_email"
        ? [["subject", "Subject", TextInputStyle.Short], ["body", "Body", TextInputStyle.Paragraph]] as const
        : [["args", "Arguments (JSON)", TextInputStyle.Paragraph]] as const;
      for (const [key, label, style] of fields) {
        const value = key === "args" ? JSON.stringify(action.args, null, 2) : String(action.args[key] ?? "");
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId(key).setLabel(label).setStyle(style).setValue(value.slice(0, 4000)).setRequired(true)));
      }
      return i.showModal(modal);
    }
  }
}

async function onSelect(customId: string, values: string[], i: StringSelectMenuInteraction) {
  const [kind, verb, id] = customId.split(":");
  if (kind !== "plan" || verb !== "select" || !id) return;
  const run = await loadRun(id);
  if (!run?.plan) return i.reply({ content: "Plan not found.", ephemeral: true });
  const plan: Plan = { ...run.plan, steps: run.plan.steps.map((s) => ({ ...s, enabled: values.includes(s.id) })) };
  await db().update(schema.runs).set({ plan, updatedAt: new Date() }).where(eq(schema.runs.id, id));
  await updatePlan(i, run, plan);
}

async function onModal(customId: string, i: ModalSubmitInteraction) {
  const [kind, verb, id] = customId.split(":");
  if (kind === "plan" && verb === "editsubmit" && id) {
    const run = await loadRun(id);
    if (!run?.plan) return i.reply({ content: "Plan not found.", ephemeral: true });
    const plan: Plan = { ...run.plan, steps: run.plan.steps.map((s) => {
      const v = (i.fields.fields.has(s.id) ? i.fields.getTextInputValue(s.id) : "").trim();
      return v ? { ...s, instruction: v } : s;
    }) };
    await db().update(schema.runs).set({ plan, planHistory: [...run.planHistory, plan], updatedAt: new Date() }).where(eq(schema.runs.id, id));
    if (i.isFromMessage()) await updatePlan(i, run, plan);
    else await i.reply({ content: "Plan updated.", ephemeral: true });
    return;
  }
  if (kind === "action" && verb === "editsubmit" && id) {
    const [action] = await db().select().from(schema.actions).where(eq(schema.actions.id, id));
    if (!action) return i.reply({ content: "Action not found.", ephemeral: true });
    let editedArgs: Record<string, unknown>;
    const raw = i.fields.fields.has("args") ? i.fields.getTextInputValue("args") : undefined;
    if (raw) { try { editedArgs = JSON.parse(raw); } catch { return i.reply({ content: "Invalid JSON.", ephemeral: true }); } }
    else editedArgs = { subject: i.fields.getTextInputValue("subject"), body: i.fields.getTextInputValue("body") };
    await inngest.send({ name: "tether/action.decided", data: { actionId: id, runId: action.runId, approved: true, editedArgs, deciderDiscordId: i.user.id, deciderName: i.user.displayName } });
    if (i.isFromMessage()) await updateApproval(i, action, { status: "edited", by: i.user.displayName, at: new Date() }, { ...action.args, ...editedArgs });
    else await i.reply({ content: "Edited and approved.", ephemeral: true });
  }
}

export async function onMessage(m: Message) {
  if (m.author.bot || !m.guildId) return;
  const org = await loadOrgByGuild(m.guildId);
  if (!org) return;
  const botId = m.client.user?.id;
  const mentioned = !!botId && m.mentions.users.has(botId);
  const attachments = [...m.attachments.values()].map((a) => ({ url: a.url, contentType: a.contentType ?? undefined, name: a.name }));
  const text = m.content.replace(/<@!?\d+>/g, "").trim();

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
