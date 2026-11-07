import { eq } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { events, orgs, tasks } from "../../db/schema.js";
import { classifyNudgeReply } from "../../runtime/nudges.js";
import type { Notifier } from "../../tools/types.js";
import { ts } from "../../ui/card.js";

const cache = new WeakMap<Notifier, ReturnType<typeof build>>();

/**
 * A task owner answered a nudge. One structured Gemini call decides what they meant, the task row
 * is updated so the monitor stops (or restarts later), the owner gets an acknowledgement where they
 * replied, and the team sees a one-liner in #tasks. "Can't" escalates to the lead right away instead
 * of waiting for two more unanswered nudges.
 */
function build(notifier: Notifier) {
  return inngest.createFunction(
    { id: "handle-nudge-reply", retries: 1, concurrency: { limit: 1, key: "event.data.taskId" } },
    { event: "tether/nudge.replied" },
    async ({ event, step }) => {
      const d = event.data;
      const task = await step.run("load-task", async () => {
        const [t] = await db().select().from(tasks).where(eq(tasks.id, d.taskId));
        return t ?? null;
      });
      if (!task) return { skipped: "task missing" };
      const [org] = await db().select().from(orgs).where(eq(orgs.id, d.orgId));
      if (!org) return { skipped: "org missing" };

      const verdict = await step.run("classify", () =>
        classifyNudgeReply({ taskTitle: task.title, dueAt: task.dueAt ? new Date(task.dueAt) : null, status: task.status, nudgeCount: task.nudgeCount, reply: d.text, ownerName: d.ownerName ?? task.ownerName ?? undefined }));

      const applied = await step.run("apply", async () => {
        const now = new Date();
        const base = { lastReply: d.text.slice(0, 500), lastReplyAt: now, lastNudgedAt: now };
        let eta: Date | undefined;
        if (verdict.intent === "eta") {
          const parsed = verdict.etaIso ? new Date(verdict.etaIso) : new Date(NaN);
          eta = Number.isFinite(parsed.getTime()) && parsed.getTime() > now.getTime() ? parsed : new Date(now.getTime() + 6 * 3600_000);
          // The nudge cycle restarts from the new due date: nothing fires until it is overdue again.
          await db().update(tasks).set({ ...base, dueAt: eta, status: task.status === "todo" ? "in_progress" : task.status, nudgeCount: 0, escalated: false }).where(eq(tasks.id, task.id));
        } else if (verdict.intent === "done") {
          await db().update(tasks).set({ ...base, status: "done" }).where(eq(tasks.id, task.id));
        } else if (verdict.intent === "cannot") {
          // escalated=true stops the monitor; the lead reassigns via update_task, which resets the cycle.
          await db().update(tasks).set({ ...base, status: "blocked", escalated: true, notes: verdict.note }).where(eq(tasks.id, task.id));
        } else {
          // Snooze one interval so the owner is not re-nudged a minute after answering.
          await db().update(tasks).set(base).where(eq(tasks.id, task.id));
        }
        await db().insert(events).values({ orgId: d.orgId, kind: "nudge_reply", agent: "coordination", data: { taskId: task.id, title: task.title, intent: verdict.intent, note: verdict.note, eta: eta?.toISOString() } });
        return { eta: eta?.toISOString() };
      });

      await step.run("acknowledge", async () => {
        const text = verdict.reply.slice(0, 1500);
        if (d.source.channelId) await notifier.postToChannel({ channelId: d.source.channelId, card: { accent: "#EF9F27", blocks: [{ kind: "text", md: `<@${d.ownerDiscordId}> ${text}` }], ping: { users: [d.ownerDiscordId] } } });
        else await notifier.dm({ discordId: d.ownerDiscordId, text });
      });

      await step.run("tell-team", async () => {
        const tasksChannel = org.channels["tasks"] ?? org.channels["ops"];
        const ops = org.channels["ops"] ?? tasksChannel;
        const who = `<@${d.ownerDiscordId}>`;
        const line =
          verdict.intent === "eta" ? `📅 ${who} on **${task.title}**: new ETA ${ts(applied.eta!, "f")} (${ts(applied.eta!)})` :
          verdict.intent === "done" ? `✅ ${who} finished **${task.title}**` :
          verdict.intent === "cannot" ? `🚧 ${who} can't take **${task.title}**: ${verdict.note}` :
          `💬 ${who} on **${task.title}**: ${verdict.note}`;
        // The acknowledgement already went to the channel they replied in; do not repeat it there.
        if (tasksChannel && tasksChannel !== d.source.channelId) await notifier.postToChannel({ channelId: tasksChannel, text: line });
        if (verdict.intent === "cannot" && ops) {
          const lead = org.roles["lead"];
          await notifier.postToChannel({
            channelId: ops,
            card: { accent: "#E24B4A", blocks: [{ kind: "text", md: `⚠️ **Needs a new owner** ${lead ? `<@&${lead}> ` : ""}— ${who} can't do **${task.title}**${task.dueAt ? ` (was due ${ts(task.dueAt, "f")})` : ""}: ${verdict.note}\n-# reassign with \`/task add\` or ask me to reassign it` }], ping: lead ? { roles: [lead] } : undefined },
          });
        }
      });
      return { intent: verdict.intent, eta: applied.eta };
    },
  );
}

export function handleNudgeReplyFn(notifier: Notifier) {
  let fn = cache.get(notifier);
  if (!fn) { fn = build(notifier); cache.set(notifier, fn); }
  return fn;
}
