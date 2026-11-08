/**
 * Stop a live run (docs/CARDS.md §7). The cleanup is done here, eagerly, because the person who
 * pressed Stop is looking at the cards: run → cancelled, live steps → cancelled, unstarted → skipped,
 * pending approvals → cancelled with their cards redrawn, then `run.cancelled` so Inngest schedules
 * nothing further. A tool call already in flight finishes; nothing new starts. No undo.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { actions, events, orgs, runs, steps } from "../db/schema.js";
import { inngest } from "../inngest/client.js";
import type { Notifier } from "../tools/types.js";
import { summaryCard, type SummaryStep } from "../ui/cards/summary.js";
import { approvalCardFor, dashboardRunUrl, settledDecision } from "./cards.js";
import { refreshRunCard } from "./status.js";

const LIVE = ["approved", "running", "awaiting_approval"] as const;

export async function cancelRun(input: { runId: string; by: string; byName?: string; notifier: Notifier }) {
  const now = new Date();
  const [run] = await db().update(runs).set({ status: "cancelled", cancelledBy: input.by, updatedAt: now })
    .where(and(eq(runs.id, input.runId), inArray(runs.status, [...LIVE]))).returning();
  if (!run) {
    const [current] = await db().select({ status: runs.status }).from(runs).where(eq(runs.id, input.runId));
    return { ok: false as const, status: current?.status };
  }

  await db().update(steps).set({ status: "cancelled", updatedAt: now }).where(and(eq(steps.runId, run.id), inArray(steps.status, ["running", "awaiting_approval"])));
  await db().update(steps).set({ status: "skipped", updatedAt: now }).where(and(eq(steps.runId, run.id), eq(steps.status, "pending")));
  const closed = await db().update(actions)
    .set({ status: "cancelled", decidedAt: now, approverDiscordId: input.by, decisionNote: "run stopped" })
    .where(and(eq(actions.runId, run.id), eq(actions.status, "pending"))).returning();

  // Wake Inngest first so no new step starts while the cards are being redrawn.
  await inngest.send({ name: "tether/run.cancelled", data: { runId: run.id, orgId: run.orgId, by: input.by, byName: input.byName } });

  const [org] = await db().select().from(orgs).where(eq(orgs.id, run.orgId));
  for (const row of closed) {
    const decision = settledDecision(row, input.byName);
    if (!row.messageRef || !org || !decision) continue;
    await input.notifier.editMessage({ ...row.messageRef, card: await approvalCardFor(org, row, decision) })
      .catch((e) => console.warn("approval re-render failed", e));
  }
  await refreshRunCard(run.id, input.notifier).catch((e) => console.warn("status re-render failed", e));

  // What already went out: approved actions that executed before the stop. Low-risk writes that ran
  // without a card are in `events` (tool_call) and the dashboard, not here.
  const executed = await db().select().from(actions).where(and(eq(actions.runId, run.id), eq(actions.status, "executed"))).orderBy(actions.executedAt);
  const stepRows = await db().select().from(steps).where(eq(steps.runId, run.id));
  if (run.plan) {
    const byKey = new Map(stepRows.map((r) => [r.stepKey, r]));
    const summarySteps: SummaryStep[] = run.plan.steps.map((s) => {
      const r = byKey.get(s.id);
      const status: SummaryStep["status"] = !s.enabled || !r || r.status === "skipped" ? "skipped" : r.status === "done" ? "done" : r.status === "failed" ? "failed" : "cancelled";
      return { id: s.id, agent: s.agent, status, output: r?.output ?? undefined };
    });
    await input.notifier.postSummary({
      run: { id: run.id, orgId: run.orgId, source: run.source, request: run.request },
      card: summaryCard({
        runId: run.id, request: run.request, plan: run.plan, status: "cancelled", steps: summarySteps, finishedAt: now,
        dashboardUrl: dashboardRunUrl(run.id), stoppedBy: `<@${input.by}>`,
        sideEffects: executed.map((a) => ({ agent: a.agent, summary: a.summary, at: a.executedAt ?? undefined })),
      }),
    }).catch((e) => console.warn("stop summary failed", e));
  }
  await db().insert(events).values({ orgId: run.orgId, runId: run.id, kind: "run_cancelled", data: { by: input.by, closedApprovals: closed.length, executed: executed.length } });
  return { ok: true as const, closed: closed.length, executed: executed.length };
}

/**
 * For the `.catch` around `step.invoke(run-plan)`: a Stop surfaces there as an invoke error after the
 * run is already `cancelled`, and must not be relabelled a failure.
 */
export async function failRunUnlessCancelled(runId: string, error: string): Promise<"failed" | "cancelled"> {
  const [current] = await db().select({ status: runs.status, orgId: runs.orgId }).from(runs).where(eq(runs.id, runId));
  if (!current || current.status === "cancelled") return "cancelled";
  await db().update(runs).set({ status: "failed", updatedAt: new Date() }).where(eq(runs.id, runId));
  await db().insert(events).values({ orgId: current.orgId, runId, kind: "run_failed", data: { error } });
  return "failed";
}
