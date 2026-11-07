import { eq } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { runs, steps, events } from "../../db/schema.js";
import { levels } from "../../runtime/planner.js";
import type { Notifier } from "../../tools/types.js";
import { runAgentStepFn } from "./steps.js";
import { statusCard, type StepState } from "../../ui/cards/status.js";
import { summaryCard } from "../../ui/cards/summary.js";
import { agentMeta } from "../../ui/cards/agent.js";
import { dashboardRunUrl } from "../../runtime/cards.js";

const cache = new WeakMap<Notifier, ReturnType<typeof build>>();

function build(notifier: Notifier) {
  return inngest.createFunction(
    { id: "run-plan", retries: 1 },
    { event: "tether/plan.approved" },
    async ({ event, step }) => {
      const runId = event.data.runId;
      const run = await step.run("load-run", async () => {
        const [r] = await db().select().from(runs).where(eq(runs.id, runId));
        if (!r?.plan) throw new Error("run or plan missing");
        return r;
      });
      const plan = run.plan!;
      const runRef = { id: run.id, orgId: run.orgId, source: run.source, request: run.request };

      const stepRows = await step.run("create-steps", async () => {
        const rows = [];
        for (const s of plan.steps.filter((s) => s.enabled)) {
          const [row] = await db().insert(steps).values({ runId, stepKey: s.id, agent: s.agent, instruction: s.instruction }).returning();
          rows.push({ stepKey: s.id, stepId: row!.id });
        }
        await db().update(runs).set({ status: "running", updatedAt: new Date() }).where(eq(runs.id, runId));
        return rows;
      });
      const stepIdByKey = Object.fromEntries(stepRows.map((r) => [r.stepKey, r.stepId]));

      const outputs: Record<string, string> = {};
      const enabled = plan.steps.filter((s) => s.enabled);
      // Structured step state; the status card builder does all the formatting.
      const state: Record<string, StepState> = Object.fromEntries(enabled.map((s) => [s.id, { id: s.id, agent: s.agent, instruction: s.instruction, status: "pending" }]));
      const dashboardUrl = dashboardRunUrl(runId);
      const renderStatus = (status: string) =>
        notifier.updateStatus({ run: runRef, status, card: statusCard({ runId, request: run.request, status, steps: enabled.map((s) => state[s.id]!), dashboardUrl }) });

      await step.run("status-initial", () => renderStatus("running"));

      for (const [li, level] of levels(plan).entries()) {
        for (const s of level) state[s.id]!.status = "running";
        await step.run(`status-level-${li}`, () => renderStatus("running"));

        const results = await Promise.all(level.map((s) =>
          step.invoke(`step-${s.id}`, {
            function: runAgentStepFn(notifier),
            data: {
              runId, stepId: stepIdByKey[s.id]!, agent: s.agent, instruction: s.instruction,
              dependencyOutputs: Object.fromEntries(s.dependsOn.filter((d) => outputs[d]).map((d) => [d, outputs[d]!])),
              actorDiscordId: run.actorDiscordId ?? undefined,
              sessionThreadId: run.trigger === "thread" ? run.source.threadId : undefined,
            },
          }),
        ));
        for (const [i, s] of level.entries()) {
          const r = results[i]!;
          outputs[s.id] = r.output;
          Object.assign(state[s.id]!, { status: r.status === "done" ? "done" : "failed", finishedAt: r.finishedAt });
        }
      }

      const failed = Object.values(state).some((v) => v.status === "failed");
      const summary = enabled.map((s) => `**${agentMeta(s.agent).label}**\n${outputs[s.id] ?? "(no output)"}`).join("\n\n");
      await step.run("finish", async () => {
        await db().update(runs).set({ status: failed ? "failed" : "done", summary, updatedAt: new Date() }).where(eq(runs.id, runId));
        await db().insert(events).values({ orgId: run.orgId, runId, kind: failed ? "run_failed" : "run_done", data: {} });
        await renderStatus(failed ? "failed" : "done");
        await notifier.postSummary({
          run: runRef,
          card: summaryCard({
            runId, request: run.request, plan, status: failed ? "failed" : "done", finishedAt: new Date(), dashboardUrl,
            steps: plan.steps.map((s) => ({ id: s.id, agent: s.agent, status: !s.enabled ? "skipped" : state[s.id]!.status === "done" ? "done" : "failed", output: outputs[s.id] })),
          }),
        });
      });

      // Tier 1 escalation: a single agent said the rest needs other agents.
      const needsPlan = Object.values(outputs).map((o) => o.match(/NEEDS_PLAN:\s*(.+)$/m)?.[1]).find(Boolean);
      if (needsPlan && plan.steps.length === 1 && run.trigger !== "cron") {
        await step.sendEvent("escalate-to-plan", {
          name: "tether/request.received",
          data: { orgId: run.orgId, trigger: "mention", mode: "auto", text: `${run.request}\n\n(Follow-up from ${plan.steps[0]!.agent}: ${needsPlan})`, source: run.source, actorDiscordId: run.actorDiscordId ?? undefined },
        });
      }
      return { status: failed ? "failed" : "done", outputs };
    },
  );
}

export function runPlanFn(notifier: Notifier) {
  let fn = cache.get(notifier);
  if (!fn) { fn = build(notifier); cache.set(notifier, fn); }
  return fn;
}
