/**
 * The live status card, rendered from the database rather than from a function's memory, so any
 * transition (a level finishing in run-plan, an approval posted or settled in run-agent-step, a Stop
 * from the button handler, a step dying) can redraw it and they all agree (docs/CARDS.md §8, §10).
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { actions, orgs, runs, steps } from "../db/schema.js";
import type { Notifier } from "../tools/types.js";
import { statusCard, type PendingApproval, type StepState } from "../ui/cards/status.js";
import { dashboardRunUrl, messageUrl } from "./cards.js";

export async function refreshRunCard(runId: string, notifier: Notifier) {
  const [run] = await db().select().from(runs).where(eq(runs.id, runId));
  if (!run) return;
  const [org] = await db().select({ guildId: orgs.guildId }).from(orgs).where(eq(orgs.id, run.orgId));
  const rows = await db().select().from(steps).where(eq(steps.runId, runId));
  // Plan order, not insertion order: parallel levels are inserted in one batch.
  const order = new Map((run.plan?.steps ?? []).map((s, i) => [s.id, i]));
  rows.sort((a, b) => (order.get(a.stepKey) ?? 99) - (order.get(b.stepKey) ?? 99));
  const states: StepState[] = rows.map((r) => ({
    id: r.stepKey, agent: r.agent, instruction: r.instruction, status: r.status,
    finishedAt: r.status === "done" || r.status === "failed" ? r.updatedAt.toISOString() : undefined,
  }));

  const open = await db().select().from(actions).where(and(eq(actions.runId, runId), eq(actions.status, "pending")));
  const keyOf = new Map(rows.map((r) => [r.id, r.stepKey]));
  const pending: PendingApproval[] = open.flatMap((a) => {
    const stepKey = a.stepId ? keyOf.get(a.stepId) : undefined;
    if (!stepKey) return [];
    const ref = a.messageRef;
    return [{ stepKey, summary: a.summary, channelId: ref?.channelId, url: ref && org ? messageUrl(org.guildId, ref.channelId, ref.messageId) : undefined }];
  });

  const status = deriveRunStatus(run.status, states.map((s) => s.status));

  await notifier.updateStatus({
    run: { id: run.id, orgId: run.orgId, source: run.source, request: run.request },
    status,
    card: statusCard({
      runId, request: run.request, status, steps: states, pending, dashboardUrl: dashboardRunUrl(runId),
      stoppedBy: run.status === "cancelled" && run.cancelledBy ? `<@${run.cancelledBy}>` : undefined,
    }),
  });
}

/**
 * The run row says `running` or `awaiting_approval`, but several steps flip it independently, so the
 * steps decide which it really is right now. Any other row status (proposed, done, cancelled…) is final.
 */
export function deriveRunStatus(runStatus: string, stepStatuses: string[]): string {
  const live = runStatus === "running" || runStatus === "awaiting_approval";
  if (!live) return runStatus;
  return stepStatuses.some((s) => s === "awaiting_approval") ? "awaiting_approval" : "running";
}
