import { and, eq, inArray, ne } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { runs, steps, events } from "../../db/schema.js";
import { levels } from "../../runtime/planner.js";
import type { Notifier } from "../../tools/types.js";
import { runAgentStepFn } from "./steps.js";
import type { StepState } from "../../ui/cards/status.js";
import { refreshRunCard } from "../../runtime/status.js";
import { summaryCard } from "../../ui/cards/summary.js";
import { agentMeta } from "../../ui/cards/agent.js";
import { dashboardRunUrl } from "../../runtime/cards.js";

const cache = new WeakMap<Notifier, ReturnType<typeof build>>();

function build(notifier: Notifier) {
  return inngest.createFunction(
    // Stop: no further step is scheduled once the matching run.cancelled arrives. Children invoked
    // with step.invoke are not cancelled with their parent, so run-agent-step carries the same rule.
    { id: "run-plan", retries: 1, cancelOn: [{ event: "tether/run.cancelled", if: "event.data.runId == async.data.runId" }] },
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
      // Outcome per step for the summary card; the live status card reads the rows instead (runtime/status.ts).
      const state: Record<string, StepState> = Object.fromEntries(enabled.map((s) => [s.id, { id: s.id, agent: s.agent, instruction: s.instruction, status: "pending" }]));
      const dashboardUrl = dashboardRunUrl(runId);
      const refresh = () => refreshRunCard(runId, notifier).catch((e) => console.warn("status re-render failed", e));

      await step.run("status-initial", refresh);

      for (const [li, level] of levels(plan).entries()) {
        // cancelOn stops this function and each child separately, so a level boundary can race a Stop
        // and invoke a child the cancel event no longer matches. The row is the authority.
        const stopped = await step.run(`check-stopped-${li}`, async () => {
          const [r] = await db().select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
          return r?.status === "cancelled";
        });
        if (stopped) return { status: "cancelled" as const, outputs };
        for (const s of level) state[s.id]!.status = "running";
        await step.run(`status-level-${li}`, async () => {
          await db().update(steps).set({ status: "running", updatedAt: new Date() })
            .where(and(inArray(steps.id, level.map((s) => stepIdByKey[s.id]!)), eq(steps.status, "pending")));
          await refresh();
        });

        const results = await Promise.all(level.map((s) =>
          step.invoke(`step-${s.id}`, {
            function: runAgentStepFn(notifier),
            data: {
              runId, stepId: stepIdByKey[s.id]!, agent: s.agent, instruction: s.instruction,
              dependencyOutputs: Object.fromEntries(s.dependsOn.filter((d) => outputs[d]).map((d) => [d, outputs[d]!])),
              actorDiscordId: run.actorDiscordId ?? undefined,
              // Receipts and photos on the triggering message; parse_receipt reads these.
              attachments: event.data.attachments,
              sessionThreadId: run.trigger === "thread" ? run.source.threadId : undefined,
            },
          // Swallow a child that exhausted its own retries: rethrowing would make this function's
          // retry start a fresh child run and repeat every Gemini call it already paid for.
          }).catch((e: unknown) => ({ status: "failed" as const, output: `Failed: ${e instanceof Error ? e.message : String(e)}`, crashed: true })),
        ));
        for (const [i, s] of level.entries()) {
          const r = results[i]!;
          if ("crashed" in r) {
            // A child cancelled by Stop also surfaces here; cancelRun already marked it, keep that.
            await step.run(`mark-crashed-${s.id}`, () => db().update(steps).set({ status: "failed", output: r.output, updatedAt: new Date() })
              .where(and(eq(steps.id, stepIdByKey[s.id]!), ne(steps.status, "cancelled"))));
          }
          outputs[s.id] = r.output;
          Object.assign(state[s.id]!, { status: r.status === "done" ? "done" : "failed", finishedAt: "finishedAt" in r ? r.finishedAt : undefined });
        }
      }

      const failed = Object.values(state).some((v) => v.status === "failed");
      const summary = enabled.map((s) => `**${agentMeta(s.agent).label}**\n${outputs[s.id] ?? "(no output)"}`).join("\n\n");
      const finished = await step.run("finish", async () => {
        // Stopped during the last level: cancelRun owns the status card and summary.
        const [current] = await db().update(runs).set({ status: failed ? "failed" : "done", summary, updatedAt: new Date() })
          .where(and(eq(runs.id, runId), ne(runs.status, "cancelled"))).returning({ id: runs.id });
        if (!current) return false;
        await db().insert(events).values({ orgId: run.orgId, runId, kind: failed ? "run_failed" : "run_done", data: {} });
        await refresh();
        await notifier.postSummary({
          run: runRef,
          card: summaryCard({
            runId, request: run.request, plan, status: failed ? "failed" : "done", finishedAt: new Date(), dashboardUrl,
            steps: plan.steps.map((s) => ({ id: s.id, agent: s.agent, status: !s.enabled ? "skipped" : state[s.id]!.status === "done" ? "done" : "failed", output: outputs[s.id] })),
          }),
        });
        return true;
      });
      if (!finished) return { status: "cancelled" as const, outputs };

      // Tier 1 escalation: a single agent said the rest needs other agents.
      const needsPlan = Object.values(outputs).map((o) => o.match(/NEEDS_PLAN:\s*(.+)$/m)?.[1]).find(Boolean);
      // One hop only: a follow-up that again comes back as a single step must not re-escalate forever.
      const isFollowUp = run.request.includes("(Follow-up from ");
      if (needsPlan && plan.steps.length === 1 && run.trigger !== "cron" && !isFollowUp) {
        await step.sendEvent("escalate-to-plan", {
          name: "tether/request.received",
          data: { orgId: run.orgId, trigger: "mention", mode: "auto", text: `${run.request}\n\n(Follow-up from ${plan.steps[0]!.agent}: ${needsPlan})`, source: run.source, actorDiscordId: run.actorDiscordId ?? undefined, attachments: event.data.attachments },
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
