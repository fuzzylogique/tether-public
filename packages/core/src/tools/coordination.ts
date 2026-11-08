import { z } from "zod";
import { and, eq, ilike } from "drizzle-orm";
import { defineTool } from "./types.js";
import { tasks } from "../db/schema.js";
import { setGoal } from "../workspace.js";

export const listTasks = defineTool({
  name: "list_tasks",
  description: "List tasks, optionally filtered by status or owner, with overdue flags.",
  input: z.object({ status: z.enum(["todo", "in_progress", "done", "blocked"]).optional(), ownerDiscordId: z.string().optional(), overdueOnly: z.boolean().default(false) }),
  effect: "read", risk: "low",
  summarize: () => "List tasks",
  async execute(args, ctx) {
    const rows = await ctx.db.select().from(tasks).where(eq(tasks.orgId, ctx.org.id));
    const now = Date.now();
    return rows
      .filter((t) => !args.status || t.status === args.status)
      .filter((t) => !args.ownerDiscordId || t.ownerDiscordId === args.ownerDiscordId)
      .map((t) => ({ ...t, overdue: t.status !== "done" && !!t.dueAt && t.dueAt.getTime() < now }))
      .filter((t) => !args.overdueOnly || t.overdue);
  },
});

export const createTask = defineTool({
  name: "create_task",
  description: "Create a task with an owner (Discord user id or name) and due date.",
  input: z.object({ title: z.string(), ownerDiscordId: z.string().optional(), ownerName: z.string().optional(), dueAt: z.string().optional().describe("ISO datetime") }),
  effect: "write", risk: "low",
  summarize: (a) => `Create task "${a.title}"${a.ownerName ? ` for ${a.ownerName}` : ""}`,
  async execute(args, ctx) {
    const [row] = await ctx.db.insert(tasks).values({
      orgId: ctx.org.id, title: args.title, ownerDiscordId: args.ownerDiscordId, ownerName: args.ownerName, dueAt: args.dueAt ? new Date(args.dueAt) : undefined,
    }).returning();
    return { id: row!.id };
  },
  async undo(_a, result, ctx) { await ctx.db.delete(tasks).where(eq(tasks.id, result.id)); },
});

export const updateTask = defineTool({
  name: "update_task",
  description: "Update a task's status, owner, due date or notes by title match. Moving the due date forward resets the nudge cycle.",
  input: z.object({
    title: z.string(), status: z.enum(["todo", "in_progress", "done", "blocked"]).optional(),
    ownerDiscordId: z.string().optional(), ownerName: z.string().optional(), dueAt: z.string().optional(), notes: z.string().optional(),
  }),
  effect: "write", risk: "low",
  summarize: (a) => `Update task "${a.title}"${a.status ? ` → ${a.status}` : ""}${a.dueAt ? ` due ${a.dueAt}` : ""}`,
  async execute(args, ctx) {
    const [t] = await ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), ilike(tasks.title, `%${args.title}%`)));
    if (!t) return { error: "task not found" };
    const dueAt = args.dueAt ? new Date(args.dueAt) : t.dueAt;
    const rescheduled = !!args.dueAt && (!t.dueAt || dueAt!.getTime() > t.dueAt.getTime());
    // A reassigned or rescheduled task starts a fresh nudge cycle; a done task is never nudged again.
    const reset = rescheduled || (!!args.ownerDiscordId && args.ownerDiscordId !== t.ownerDiscordId);
    await ctx.db.update(tasks).set({
      status: args.status ?? t.status, ownerDiscordId: args.ownerDiscordId ?? t.ownerDiscordId, ownerName: args.ownerName ?? t.ownerName,
      dueAt, notes: args.notes ?? t.notes,
      ...(reset ? { nudgeCount: 0, lastNudgedAt: null, escalated: false } : {}),
    }).where(eq(tasks.id, t.id));
    return { id: t.id, status: args.status ?? t.status, dueAt: dueAt?.toISOString(), nudgeCycleReset: reset };
  },
});

/** Marker on every nudge message, so a Discord reply to one can be recognised as an answer. */
export const NUDGE_PREFIX = "⏰";

export const nudgeOwner = defineTool({
  name: "nudge_owner",
  description: "Nudge a task owner about an overdue or upcoming task. Posted in the team #tasks channel with an @mention (or a DM when there is no #tasks channel). The owner can answer the message with an ETA, 'done' or 'can't'; Tether reads the reply.",
  input: z.object({ discordId: z.string(), message: z.string(), taskTitle: z.string().optional() }),
  effect: "external", risk: "medium",
  summarize: (a) => `Nudge <@${a.discordId}>: ${a.message.slice(0, 80)}`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["tasks"];
    const footer = args.taskTitle ? `\n-# task: ${args.taskTitle} · reply to this message with an ETA, "done" or "can't"` : "\n-# reply to this message with an ETA";
    if (channelId) {
      const { messageId } = await ctx.notify.postToChannel({ channelId, card: { accent: "#EF9F27", blocks: [{ kind: "text", md: `${NUDGE_PREFIX} <@${args.discordId}> ${args.message}${footer}` }], ping: { users: [args.discordId] } } });
      return { sent: true, where: "tasks channel", messageId };
    }
    await ctx.notify.dm({ discordId: args.discordId, text: `${NUDGE_PREFIX} ${args.message}${footer}` });
    // The monitor owns nudge_count / last_nudged_at (claimed before this run started); ad-hoc nudges do not count.
    return { sent: true, where: "dm" };
  },
});

export const escalate = defineTool({
  name: "escalate",
  description: "Post an escalation to the ops channel mentioning the lead role. Use after nudges went unanswered or when the owner says they cannot do it.",
  input: z.object({ message: z.string(), taskTitle: z.string().optional() }),
  effect: "external", risk: "medium",
  summarize: (a) => `Escalate: ${a.message.slice(0, 80)}`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["ops"];
    if (!channelId) return { error: "no ops channel configured" };
    const lead = ctx.org.roles["lead"];
    await ctx.notify.postToChannel({
      channelId,
      card: { accent: "#E24B4A", blocks: [{ kind: "text", md: `⚠️ **Escalation** ${lead ? `<@&${lead}> ` : ""}— ${args.message}` }], ping: lead ? { roles: [lead] } : undefined },
    });
    if (args.taskTitle) {
      const [t] = await ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), ilike(tasks.title, `%${args.taskTitle}%`)));
      if (t) await ctx.db.update(tasks).set({ escalated: true }).where(eq(tasks.id, t.id));
    }
    return { posted: true, pingedLead: !!lead };
  },
});

export const recordMetric = defineTool({
  name: "record_metric",
  description: "Record a headcount for the workspace overview (registrations, volunteers, mentors, judges) after reading it from a sheet, an email or the chat. Always say where the number came from.",
  input: z.object({
    metric: z.enum(["registrations", "volunteers", "mentors", "judges"]),
    current: z.number().int().min(0).optional().describe("How many there are now"),
    target: z.number().int().min(0).optional().describe("How many the event needs, only when the organizer stated it"),
    source: z.string().min(3).max(120).describe("Where the number came from, e.g. 'Registrations sheet, row count' or 'Devpost export'"),
  }),
  effect: "write", risk: "low",
  summarize: (a) => `Record ${a.metric}: ${a.current ?? "?"}${a.target !== undefined ? ` of ${a.target}` : ""} (${a.source})`,
  async execute(args, ctx) {
    if (args.current === undefined && args.target === undefined) return { error: "give current, target, or both" };
    return setGoal(ctx.org.id, args.metric, { current: args.current, target: args.target, source: args.source });
  },
});

export const coordinationTools = [listTasks, createTask, updateTask, nudgeOwner, escalate, recordMetric];
