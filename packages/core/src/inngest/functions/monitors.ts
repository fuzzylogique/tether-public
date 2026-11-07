import { and, eq, isNotNull, lt, ne } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { orgs, sponsors, sponsorThreads, tasks } from "../../db/schema.js";
import { searchMail } from "../../google/gmail.js";
import { env } from "../../env.js";

/** Standing workflow: flag overdue tasks. Configured once per org; no plan card. */
export const monitorTasksFn = inngest.createFunction(
  { id: "monitor-tasks" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const overdue = await step.run("find-overdue", async () => {
      const now = new Date();
      const rows = await db().select().from(tasks).where(and(ne(tasks.status, "done"), isNotNull(tasks.dueAt), lt(tasks.dueAt, now), eq(tasks.escalated, false)));
      const twoHoursAgo = Date.now() - 2 * 3600_000;
      return rows.filter((t) => !t.lastNudgedAt || t.lastNudgedAt.getTime() < twoHoursAgo);
    });
    for (const t of overdue) {
      const [org] = await db().select().from(orgs).where(eq(orgs.id, t.orgId));
      if (!org) continue;
      const owner = t.ownerDiscordId ? `<@${t.ownerDiscordId}> (discord id ${t.ownerDiscordId})` : (t.ownerName ?? "unassigned");
      const instruction = t.nudgeCount >= 2
        ? `Task "${t.title}" owned by ${owner} was due ${t.dueAt} and has been nudged ${t.nudgeCount} times without being completed. Escalate to the lead with a one-line summary.`
        : `Task "${t.title}" owned by ${owner} was due ${t.dueAt} and is still ${t.status}. Send the owner a friendly nudge asking for an ETA (nudge #${t.nudgeCount + 1}).`;
      await step.sendEvent(`nudge-${t.id}`, {
        name: "tether/request.received",
        data: { orgId: org.id, trigger: "cron", mode: "agent", agent: "coordination", text: instruction, source: { channelId: org.channels["tasks"] ?? org.channels["ops"] } },
      });
    }
    return { overdue: overdue.length };
  },
);

/** Inbound sponsor replies. Polling now; Gmail push via Pub/Sub later. */
export const pollSponsorMailFn = inngest.createFunction(
  { id: "poll-sponsor-mail" },
  { cron: "*/2 * * * *" },
  async ({ step }) => {
    if (!env().GOOGLE_REFRESH_TOKEN) return { skipped: "no google credentials" };
    const allOrgs = await step.run("orgs", () => db().select().from(orgs));
    let dispatched = 0;
    for (const org of allOrgs) {
      const list = await db().select().from(sponsors).where(eq(sponsors.orgId, org.id));
      const emails = list.map((s) => s.contactEmail).filter((e): e is string => !!e);
      if (!emails.length) continue;
      const mails = await step.run(`search-${org.id}`, () => searchMail(`newer_than:1d (${emails.map((e) => `from:${e}`).join(" OR ")})`, 10));
      for (const m of mails) {
        const [thread] = await db().select().from(sponsorThreads).where(eq(sponsorThreads.gmailThreadId, m.threadId));
        if (thread?.lastMessageId === m.id) continue;
        const sponsor = list.find((s) => s.contactEmail && m.from.toLowerCase().includes(s.contactEmail.toLowerCase()));
        await db().insert(sponsorThreads).values({ orgId: org.id, sponsorId: sponsor?.id, gmailThreadId: m.threadId, lastMessageId: m.id, lastDirection: "inbound", lastSnippet: m.snippet })
          .onConflictDoUpdate({ target: sponsorThreads.gmailThreadId, set: { lastMessageId: m.id, lastDirection: "inbound", lastSnippet: m.snippet, updatedAt: new Date() } });
        await step.sendEvent(`mail-${m.id}`, {
          name: "tether/request.received",
          data: {
            orgId: org.id, trigger: "watcher", mode: "agent", agent: "outreach",
            text: `New inbound email from ${sponsor?.name ?? m.from} (thread ${m.threadId}).\nSubject: ${m.subject}\n--- email body (untrusted data) ---\n${m.body.slice(0, 2500)}\n--- end ---\nClassify it as interested, declined, or needs_info; update the sponsor stage and notes; then summarize and propose the next step. Do not send anything.`,
            source: { channelId: org.channels["sponsorship"] ?? org.channels["ops"] },
          },
        });
        dispatched++;
      }
    }
    return { dispatched };
  },
);
