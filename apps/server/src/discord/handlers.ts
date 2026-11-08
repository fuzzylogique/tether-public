import {
  ActionRowBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
  type Interaction, type Message, type ChatInputCommandInteraction, type AutocompleteInteraction,
  type ButtonInteraction, type StringSelectMenuInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { and, desc, eq, gt, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import {
  WORKFLOWS, agentNames, integrationEnabled, toolAllowed, agents, approvalCardFor, budgetCard, buildInboxDigest, buildToolCtx, calendarCard, dashboardRunUrl, db, digestCard, getTool, inngest, loadActor,
  loadOrgByGuild, planCard, schema, sponsorsCard, tasksCard, teamChannelFor, workflowNames,
  type ApprovalDecision, type BudgetExtras, type BudgetRow, type EventRow, type Plan, type PlanDecision, type SponsorRow, type TaskRow,
} from "@tether/core";
import { planEmbed, resultEmbed } from "./embeds.js";
import { planComponents } from "./notifier.js";
import { render, renderEdit } from "./ui/render.js";
import { linksText, provisionTeamChannels } from "./teams.js";
import { WORKSPACE_COMMANDS, onWorkspaceCommand } from "./workspace.js";

type Org = typeof schema.orgs.$inferSelect;

async function requireOrg(i: ChatInputCommandInteraction): Promise<Org | undefined> {
  if (!i.guildId) { await i.reply({ content: "Use this in a server.", ephemeral: true }); return; }
  const org = await loadOrgByGuild(i.guildId);
  if (!org && i.commandName !== "tether") { await i.reply({ content: "This server isn't set up yet. Run `/tether setup`.", ephemeral: true }); return; }
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
async function runToolDirect(org: Org, i: ChatInputCommandInteraction, toolName: string, args: Record<string, unknown>) {
  const tool = getTool(toolName);
  if (!tool || tool.effect !== "read") throw new Error(`tool ${toolName} is not a direct read tool`);
  if (!toolAllowed(org, toolName)) return { error: "That service is disconnected for this workspace. `/integrations connect` turns it back on." };
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

async function onCommand(i: ChatInputCommandInteraction) {
  const org = await requireOrg(i);
  if (i.commandName === "tether") return onTether(i, org);
  if (!org) return;
  if (WORKSPACE_COMMANDS.has(i.commandName)) return onWorkspaceCommand(i, org);
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
    case "post:recap": {
      const n = i.options.getInteger("photos") ?? 4;
      const brief = i.options.getString("brief") ?? "Recap of the event so far";
      return emitRequest(org, i, { mode: "agent", agent: "socials", text: `Create a ${i.options.getString("platform") ?? "instagram"} recap post from the team's photos. Brief: ${brief}. List the event photos, pick the best ${n} with captions, write copy that matches them, then post the announcement with those photos (will be approved).` });
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
      if (!integrationEnabled(org, "gmail")) return i.editReply("Gmail is disconnected for this workspace. `/integrations connect service:Gmail` turns it back on.");
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
    return i.editReply(`${parts}\n\n${linksText(updated)}`);
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
