import { eq } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { runs, events, type Plan } from "../../db/schema.js";
import { draftPlan, requiresPlanCard, singleStepPlan } from "../../runtime/planner.js";
import type { Notifier } from "../../tools/types.js";
import { runPlanFn } from "./plans.js";

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
        await db().insert(events).values({ orgId: d.orgId, runId: row!.id, kind: "run_created", data: { trigger: d.trigger, mode: d.mode } });
        return row!;
      });

      let plan: Plan = await step.run("draft-plan", async () => {
        if (d.mode === "agent" && d.agent) return singleStepPlan(d.agent, d.text);
        const { plan } = await draftPlan(d.text);
        return plan;
      });
      await step.run("save-plan", () => db().update(runs).set({ plan, planHistory: [plan], updatedAt: new Date() }).where(eq(runs.id, run.id)));

      const runRef = { id: run.id, orgId: run.orgId, source: d.source, request: d.text };

      if (d.mode === "auto" && requiresPlanCard(plan)) {
        const msg = await step.run("post-plan-card", () => notifier.postPlanCard({ run: runRef, plan }));
        await step.run("save-plan-msg", () => db().update(runs).set({ source: { ...d.source, planMessageId: msg.messageId } }).where(eq(runs.id, run.id)));

        const decided = await step.waitForEvent("plan-decided", {
          event: "tether/plan.decided",
          if: `async.data.runId == "${run.id}"`,
          timeout: "24h",
        });
        if (!decided || !decided.data.approved) {
          await step.run("cancel", async () => {
            await db().update(runs).set({ status: "cancelled", updatedAt: new Date() }).where(eq(runs.id, run.id));
            await notifier.updateStatus({ run: runRef, lines: ["Plan cancelled."], status: "cancelled" });
          });
          return { runId: run.id, status: "cancelled" };
        }
        if (decided.data.plan) {
          plan = decided.data.plan;
          await step.run("save-edited-plan", () =>
            db().update(runs).set({ plan, planHistory: [...run.planHistory, plan], updatedAt: new Date() }).where(eq(runs.id, run.id)));
        }
      }

      await step.run("mark-approved", () => db().update(runs).set({ status: "approved", updatedAt: new Date() }).where(eq(runs.id, run.id)));
      const result = await step.invoke("execute", { function: runPlanFn(notifier), data: { runId: run.id } });
      return { runId: run.id, ...result };
    },
  );
}
