import { eq } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { runs, steps, events } from "../../db/schema.js";
import { levels } from "../../runtime/planner.js";
import { agents } from "../../agents/registry.js";
import type { Notifier } from "../../tools/types.js";
import { runAgentStepFn } from "./steps.js";

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
      const statusLines: Record<string, string> = {};
      const label = (agent: string) => agents()[agent]?.label ?? agent;
      const renderStatus = (status: string) =>
        notifier.updateStatus({ run: runRef, lines: plan.steps.filter((s) => s.enabled).map((s) => `${statusLines[s.id] ?? "⬜"} **${label(s.agent)}** — ${s.instruction}`), status });

      for (const s of plan.steps.filter((s) => s.enabled)) statusLines[s.id] = "⬜";
      await step.run("status-initial", () => renderStatus("running"));

      for (const [li, level] of levels(plan).entries()) {
        for (const s of level) statusLines[s.id] = "⏳";
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
          // Swallow a child that exhausted its own retries: rethrowing would make this function's
          // retry start a fresh child run and repeat every Gemini call it already paid for.
          }).catch((e: unknown) => ({ status: "failed" as const, output: `Failed: ${e instanceof Error ? e.message : String(e)}`, crashed: true })),
        ));
        for (const [i, s] of level.entries()) {
          const r = results[i]!;
          if ("crashed" in r) {
            await step.run(`mark-crashed-${s.id}`, () => db().update(steps).set({ status: "failed", output: r.output, updatedAt: new Date() }).where(eq(steps.id, stepIdByKey[s.id]!)));
          }
          outputs[s.id] = r.output;
          statusLines[s.id] = r.status === "done" ? "✅" : "❌";
        }
      }

      const failed = Object.values(statusLines).some((v) => v === "❌");
      const summary = plan.steps.filter((s) => s.enabled).map((s) => `**${label(s.agent)}**\n${outputs[s.id] ?? "(no output)"}`).join("\n\n");
      await step.run("finish", async () => {
        await db().update(runs).set({ status: failed ? "failed" : "done", summary, updatedAt: new Date() }).where(eq(runs.id, runId));
        await db().insert(events).values({ orgId: run.orgId, runId, kind: failed ? "run_failed" : "run_done", data: {} });
        await renderStatus(failed ? "failed" : "done");
        await notifier.postSummary({ run: runRef, text: summary.slice(0, 1900) });
      });

      // Tier 1 escalation: a single agent said the rest needs other agents.
      const needsPlan = Object.values(outputs).map((o) => o.match(/NEEDS_PLAN:\s*(.+)$/m)?.[1]).find(Boolean);
      // One hop only: a follow-up that again comes back as a single step must not re-escalate forever.
      const isFollowUp = run.request.includes("(Follow-up from ");
      if (needsPlan && plan.steps.length === 1 && run.trigger !== "cron" && !isFollowUp) {
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
