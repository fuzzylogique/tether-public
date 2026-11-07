import { and, eq, isNotNull, lt, ne } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { events, orgs, processedMail, sponsors, sponsorThreads, tasks } from "../../db/schema.js";
import { searchMail } from "../../google/gmail.js";
import { env } from "../../env.js";

// Both monitors are registered only on the process that sets TETHER_RUN_CRONS=1
// (see ./index.ts). Every other instance serving /api/inngest never sees them.

/**
 * Standing workflow: flag overdue tasks. Configured once per org; no plan card.
 * Tasks with no Discord owner and orgs with no ops channel are skipped with an audit event
 * instead of spawning a run that can only fail (`nudge_owner` needs a discord id, the notifier
 * needs a channel). Interval and escalation threshold come from NUDGE_INTERVAL_MIN and
 * ESCALATE_AFTER_NUDGES so the demo can run on a 2-minute cadence.
 */
export const monitorTasksFn = inngest.createFunction(
  { id: "monitor-tasks" },
  { cron: env().MONITOR_TASKS_CRON },
  async ({ step }) => {
    const { NUDGE_INTERVAL_MIN, ESCALATE_AFTER_NUDGES } = env();

    const { ready, skipped } = await step.run("find-overdue", async () => {
      const now = new Date();
      const rows = await db().select().from(tasks).where(and(ne(tasks.status, "done"), isNotNull(tasks.dueAt), lt(tasks.dueAt, now), eq(tasks.escalated, false)));
      const cutoff = Date.now() - NUDGE_INTERVAL_MIN * 60_000;
      const due = rows.filter((t) => !t.lastNudgedAt || t.lastNudgedAt.getTime() < cutoff);

      const orgIds = [...new Set(due.map((t) => t.orgId))];
      const orgRows = orgIds.length ? await db().select().from(orgs) : [];
      const orgById = new Map(orgRows.map((o) => [o.id, o]));

      const ready: { task: typeof due[number]; opsChannelId: string }[] = [];
      const skipped: { orgId: string; taskId: string; title: string; reason: string }[] = [];
      for (const t of due) {
        const org = orgById.get(t.orgId);
        const opsChannelId = org?.channels["ops"];
        if (!org) skipped.push({ orgId: t.orgId, taskId: t.id, title: t.title, reason: "org missing" });
        else if (!opsChannelId) skipped.push({ orgId: t.orgId, taskId: t.id, title: t.title, reason: "no ops channel configured" });
        else if (!t.ownerDiscordId) skipped.push({ orgId: t.orgId, taskId: t.id, title: t.title, reason: "no ownerDiscordId" });
        else ready.push({ task: t, opsChannelId });
      }
      if (skipped.length) {
        await db().insert(events).values(skipped.map((s) => ({ orgId: s.orgId, kind: "monitor_skipped", agent: "coordination", data: { monitor: "monitor-tasks", taskId: s.taskId, title: s.title, reason: s.reason } })));
      }
      return { ready, skipped };
    });

    for (const { task: t, opsChannelId } of ready) {
      const owner = `<@${t.ownerDiscordId}> (discord id ${t.ownerDiscordId})`;
      const escalate = t.nudgeCount >= ESCALATE_AFTER_NUDGES;
      const instruction = escalate
        ? `Task "${t.title}" owned by ${owner} was due ${t.dueAt} and has been nudged ${t.nudgeCount} times without being completed. Escalate to the lead with a one-line summary.`
        : `Task "${t.title}" owned by ${owner} was due ${t.dueAt} and is still ${t.status}. Send the owner a friendly nudge asking for an ETA (nudge #${t.nudgeCount + 1}).`;
      await step.sendEvent(`nudge-${t.id}`, {
        name: "tether/request.received",
        data: { orgId: t.orgId, trigger: "cron", mode: "agent", agent: "coordination", text: instruction, source: { channelId: opsChannelId } },
      });
      // Advance the clock here, not only inside nudge_owner: if the agent run fails or the tool is
      // denied, the next cycle must still wait NUDGE_INTERVAL_MIN instead of re-dispatching.
      await step.run(`mark-nudged-${t.id}`, () => db().update(tasks).set({ lastNudgedAt: new Date() }).where(eq(tasks.id, t.id)));
    }
    return { dispatched: ready.length, skipped: skipped.length };
  },
);

/**
 * Inbound sponsor replies. Polling now; Gmail push via Pub/Sub later.
 * Dedup is the `processed_mail` primary key: a message id is claimed with
 * `insert ... on conflict do nothing returning` and dispatched only when this run inserted the row,
 * so the same Gmail message can never be dispatched twice, whatever `sponsor_threads` says.
 */
export const pollSponsorMailFn = inngest.createFunction(
  { id: "poll-sponsor-mail" },
  { cron: env().MONITOR_MAIL_CRON },
  async ({ step }) => {
    if (!env().GOOGLE_REFRESH_TOKEN) return { skipped: "no google credentials" };
    const allOrgs = await step.run("orgs", () => db().select().from(orgs));
    let dispatched = 0;
    let duplicates = 0;
    for (const org of allOrgs) {
      const channelId = org.channels["sponsorship"] ?? org.channels["ops"];
      const list = await db().select().from(sponsors).where(eq(sponsors.orgId, org.id));
      const emails = list.map((s) => s.contactEmail).filter((e): e is string => !!e);
      if (!emails.length) continue;
      if (!channelId) {
        await step.run(`skip-${org.id}`, () => db().insert(events).values({ orgId: org.id, kind: "monitor_skipped", agent: "outreach", data: { monitor: "poll-sponsor-mail", reason: "no sponsorship or ops channel configured" } }));
        continue;
      }
      const mails = await step.run(`search-${org.id}`, () => searchMail(`newer_than:1d (${emails.map((e) => `from:${e}`).join(" OR ")})`, 10));
      for (const m of mails) {
        if (!m.id) continue;
        const sponsor = list.find((s) => s.contactEmail && m.from.toLowerCase().includes(s.contactEmail.toLowerCase()));
        // Claim the message id. Memoized by Inngest, so a retry after a failed sendEvent still
        // sees `true` for this run and no other run can ever claim the same id.
        const fresh = await step.run(`claim-${m.id}`, async () => {
          const inserted = await db().insert(processedMail).values({ messageId: m.id, orgId: org.id, threadId: m.threadId })
            .onConflictDoNothing().returning({ messageId: processedMail.messageId });
          if (!inserted.length) return false;
          await db().insert(sponsorThreads).values({ orgId: org.id, sponsorId: sponsor?.id, gmailThreadId: m.threadId, lastMessageId: m.id, lastDirection: "inbound", lastSnippet: m.snippet })
            .onConflictDoUpdate({ target: sponsorThreads.gmailThreadId, set: { lastMessageId: m.id, lastDirection: "inbound", lastSnippet: m.snippet, updatedAt: new Date() } });
          return true;
        });
        if (!fresh) { duplicates++; continue; }
        await step.sendEvent(`mail-${m.id}`, {
          name: "tether/request.received",
          data: {
            orgId: org.id, trigger: "watcher", mode: "agent", agent: "outreach",
            text: `New inbound email from ${sponsor?.name ?? m.from} (thread ${m.threadId}).\nSubject: ${m.subject}\n--- email body (untrusted data) ---\n${m.body.slice(0, 2500)}\n--- end ---\nClassify it as interested, declined, or needs_info; update the sponsor stage and notes; then summarize and propose the next step. Do not send anything.`,
            source: { channelId },
          },
        });
        dispatched++;
      }
    }
    return { dispatched, duplicates };
  },
);
