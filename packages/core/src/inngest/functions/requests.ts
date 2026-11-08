import { and, eq } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { runs, events, type Plan } from "../../db/schema.js";
import { draftPlan, requiresPlanCard, singleStepPlan } from "../../runtime/planner.js";
import type { Notifier } from "../../tools/types.js";
import { runPlanFn } from "./plans.js";
import { planCard } from "../../ui/cards/plan.js";
import { statusCard } from "../../ui/cards/status.js";
import { dashboardRunUrl } from "../../runtime/cards.js";
import { failRunUnlessCancelled } from "../../runtime/cancel.js";
import { draftFailureNote } from "../../runtime/gemini.js";

export function handleRequestFn(notifier: Notifier) {
  return inngest.createFunction(
    { id: "handle-request", retries: 2 },
    { event: "tether/request.received" },
    async ({ event, step }) => {
      const d = event.data;

      const run = await step.run("create-run", async () => {
        const [row] = await db().insert(runs).values({
          orgId: d.orgId, trigger: d.trigger, source: d.source, actorDiscordId: d.actorDiscordId, request: d.text, status: "proposed",
        }).returning();
        await db().insert(events).values({ orgId: d.orgId, runId: row!.id, kind: "run_created", data: { trigger: d.trigger, mode: d.mode, attachments: d.attachments, contextChars: d.context?.length ?? 0 } });
        return row!;
      });

      const runRef = { id: run.id, orgId: run.orgId, source: d.source, request: d.text };

      const draft = await step.run("draft-plan", async () => {
        if (d.mode === "agent" && d.agent) return singleStepPlan(d.agent, d.text);
        const { plan } = await draftPlan(d.text, d.context);
        return plan;
      }).catch(async (e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        // No plan means no card yet: without this the run stays `proposed` and the channel hears nothing.
        await step.run("mark-draft-failed", async () => {
          const status = await failRunUnlessCancelled(run.id, error);
          await notifier.updateStatus({ run: runRef, status, card: statusCard({ runId: run.id, request: d.text, status, steps: [], note: draftFailureNote(error) }) });
        });
        return null;
      });
      if (!draft) return { runId: run.id, status: "failed" as const };
      let plan: Plan = draft;
      await step.run("save-plan", () => db().update(runs).set({ plan, planHistory: [plan], updatedAt: new Date() }).where(eq(runs.id, run.id)));

      if (d.mode === "auto" && requiresPlanCard(plan)) {
        const msg = await step.run("post-plan-card", () => notifier.postPlanCard({
          run: runRef, plan,
          card: planCard({ runId: run.id, request: d.text, plan, requester: { discordId: d.actorDiscordId, name: d.actorName }, createdAt: run.createdAt, dashboardUrl: dashboardRunUrl(run.id) }),
        }));
        await step.run("save-plan-msg", () => db().update(runs).set({ source: { ...d.source, planMessageId: msg.messageId } }).where(eq(runs.id, run.id)));

        const decided = await step.waitForEvent("plan-decided", {
          event: "tether/plan.decided",
          if: `async.data.runId == "${run.id}"`,
          timeout: "24h",
        });
        if (!decided || !decided.data.approved) {
          const status = await step.run("cancel", async () => {
            // No decision in 24h: expire only if nobody claimed the plan in the meantime (the button
            // handler moves it out of `proposed` first). A late Run then still falls through to cancelled,
            // because the event it sent arrived after the wait ended and nothing is listening for it.
            const [expired] = decided ? [] : await db().update(runs).set({ status: "expired", updatedAt: new Date() })
              .where(and(eq(runs.id, run.id), eq(runs.status, "proposed"))).returning();
            const status = expired ? "expired" as const : "cancelled" as const;
            if (!expired) await db().update(runs).set({ status, updatedAt: new Date() }).where(eq(runs.id, run.id));
            // The plan card keeps live buttons until it is redrawn; leaving it open is the stale-card bug.
            await notifier.editMessage({
              channelId: msg.channelId, messageId: msg.messageId,
              card: planCard({ runId: run.id, request: d.text, plan, requester: { discordId: d.actorDiscordId, name: d.actorName }, createdAt: run.createdAt, dashboardUrl: dashboardRunUrl(run.id), decision: { status, at: new Date() } }),
            }).catch((e) => console.warn("plan card re-render failed", e));
            await notifier.updateStatus({
              run: runRef, status,
              card: statusCard({ runId: run.id, request: d.text, status, steps: [], note: decided ? "Plan cancelled." : "Plan expired after 24 hours without a decision." }),
            });
            return status;
          });
          return { runId: run.id, status };
        }
        if (decided.data.plan) {
          plan = decided.data.plan;
          await step.run("save-edited-plan", () =>
            db().update(runs).set({ plan, planHistory: [...run.planHistory, plan], updatedAt: new Date() }).where(eq(runs.id, run.id)));
        }
      }

      await step.run("mark-approved", () => db().update(runs).set({ status: "approved", updatedAt: new Date() }).where(eq(runs.id, run.id)));
      // Same reasoning as run-plan: a retry here would re-invoke the whole plan from scratch.
      const result = await step.invoke("execute", { function: runPlanFn(notifier), data: { runId: run.id, attachments: d.attachments } })
        .catch(async (e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          // A Stop cancels run-plan, which surfaces here as an invoke error; the run is already marked.
          const status = await step.run("mark-failed", () => failRunUnlessCancelled(run.id, error));
          return { status, error };
        });
      return { runId: run.id, ...result };
    },
  );
}
