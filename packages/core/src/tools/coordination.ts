import { z } from "zod";
import { and, eq, ilike } from "drizzle-orm";
import { defineTool } from "./types.js";
import { tasks } from "../db/schema.js";

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
  description: "Update a task's status, owner, or due date by title match.",
  input: z.object({ title: z.string(), status: z.enum(["todo", "in_progress", "done", "blocked"]).optional(), ownerDiscordId: z.string().optional(), ownerName: z.string().optional(), dueAt: z.string().optional() }),
  effect: "write", risk: "low",
  summarize: (a) => `Update task "${a.title}"${a.status ? ` → ${a.status}` : ""}`,
  async execute(args, ctx) {
    const [t] = await ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), ilike(tasks.title, `%${args.title}%`)));
    if (!t) return { error: "task not found" };
    await ctx.db.update(tasks).set({
      status: args.status ?? t.status, ownerDiscordId: args.ownerDiscordId ?? t.ownerDiscordId, ownerName: args.ownerName ?? t.ownerName,
      dueAt: args.dueAt ? new Date(args.dueAt) : t.dueAt,
    }).where(eq(tasks.id, t.id));
    return { id: t.id };
  },
});

export const nudgeOwner = defineTool({
  name: "nudge_owner",
  description: "Send a Discord DM to a task owner reminding them of an overdue or upcoming task.",
  input: z.object({ discordId: z.string(), message: z.string(), taskTitle: z.string().optional() }),
  effect: "external", risk: "medium",
  summarize: (a) => `DM <@${a.discordId}>: ${a.message.slice(0, 80)}`,
  async execute(args, ctx) {
    await ctx.notify.dm({ discordId: args.discordId, text: args.message });
    if (args.taskTitle) {
      const [t] = await ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), ilike(tasks.title, `%${args.taskTitle}%`)));
      if (t) await ctx.db.update(tasks).set({ nudgeCount: t.nudgeCount + 1, lastNudgedAt: new Date() }).where(eq(tasks.id, t.id));
    }
    return { sent: true };
  },
});

export const escalate = defineTool({
  name: "escalate",
  description: "Post an escalation to the ops channel mentioning the lead. Use after nudges went unanswered.",
  input: z.object({ message: z.string(), taskTitle: z.string().optional() }),
  effect: "external", risk: "medium",
  summarize: (a) => `Escalate: ${a.message.slice(0, 80)}`,
  async execute(args, ctx) {
    const channelId = ctx.org.channels["ops"];
    if (!channelId) return { error: "no ops channel configured" };
    await ctx.notify.postToChannel({ channelId, text: `⚠️ **Escalation** — ${args.message}` });
    if (args.taskTitle) {
      const [t] = await ctx.db.select().from(tasks).where(and(eq(tasks.orgId, ctx.org.id), ilike(tasks.title, `%${args.taskTitle}%`)));
      if (t) await ctx.db.update(tasks).set({ escalated: true }).where(eq(tasks.id, t.id));
    }
    return { posted: true };
  },
});

export const coordinationTools = [listTasks, createTask, updateTask, nudgeOwner, escalate];
