/**
 * Card builders that need data: approval cards look up the budget line and channel ids,
 * every run card links to the dashboard. The builders in ui/cards stay pure.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { actions, budgetLines, expenses, orgs, runs } from "../db/schema.js";
import { env } from "../env.js";
import type { ActionRef } from "../tools/types.js";
import { approvalCard, type ApprovalContext, type ApprovalDecision, type ApprovalEdit } from "../ui/cards/approval.js";

type Org = typeof orgs.$inferSelect;
type ActionRow = typeof actions.$inferSelect;
type RunRow = typeof runs.$inferSelect;

/** Dashboard link for a run. Discord only accepts public https URLs on link buttons. */
export function dashboardRunUrl(runId: string) {
  const base = env().WEB_PUBLIC_URL.replace(/\/$/, "");
  return base.startsWith("https://") ? `${base}/runs/${runId}` : undefined;
}

/** Deep link to a Discord message. */
export function messageUrl(guildId: string, channelId: string, messageId: string) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Deep link to a run's live status card, when it has been posted. */
export function statusCardUrl(org: Pick<Org, "guildId">, run: Pick<RunRow, "source">) {
  const channelId = run.source.threadId ?? run.source.channelId;
  const messageId = run.source.statusMessageId;
  return channelId && messageId ? messageUrl(org.guildId, channelId, messageId) : undefined;
}

export async function approvalContext(org: Org, a: Pick<ActionRef, "tool" | "args">, run?: Pick<RunRow, "source">): Promise<ApprovalContext> {
  const ctx: ApprovalContext = { channels: org.channels, runUrl: run ? statusCardUrl(org, run) : undefined };
  if (a.tool === "log_expense" && typeof a.args.category === "string") {
    const [line] = await db().select().from(budgetLines)
      .where(and(eq(budgetLines.orgId, org.id), sql`lower(${budgetLines.category}) = lower(${a.args.category})`));
    if (line) {
      const [s] = await db().select({ total: sql<string>`coalesce(sum(${expenses.amount}),0)` }).from(expenses)
        .where(and(eq(expenses.orgId, org.id), eq(expenses.category, line.category)));
      ctx.budget = { category: line.category, allocated: Number(line.allocated), spent: Number(s?.total ?? 0) };
    }
  }
  return ctx;
}

export function actionRef(a: ActionRow, args: Record<string, unknown> = a.args): ActionRef {
  return { id: a.id, tool: a.tool, agent: a.agent, summary: a.summary, risk: a.risk as ActionRef["risk"], effect: a.effect as ActionRef["effect"], args, approverRole: a.approverRole ?? undefined };
}

/** What the card shows about a saved edit, from the row. */
export function editOf(a: ActionRow): ApprovalEdit | undefined {
  return a.editedAt ? { by: a.editedBy ? `<@${a.editedBy}>` : undefined, at: a.editedAt, fields: a.editedFields ?? undefined } : undefined;
}

/**
 * The approval card for an action row: pending, mid-decision or settled, always from the row so every
 * writer (button handler, executor, expiry, Stop) draws the same thing. `edited` overrides the row's
 * edit line for the render right after a save.
 */
export async function approvalCardFor(org: Org, a: ActionRow, decision?: ApprovalDecision, args?: Record<string, unknown>, edited?: ApprovalEdit) {
  const ref = actionRef(a, args);
  const [run] = await db().select({ source: runs.source }).from(runs).where(eq(runs.id, a.runId));
  return approvalCard(ref, { context: await approvalContext(org, ref, run), decision, edited: edited ?? editOf(a) });
}

/**
 * Decision for an action row in any non-pending state, so a card can always be re-rendered from
 * the row (the executor's final render, and the in-place repair of a stale card on a late click).
 */
export function settledDecision(a: ActionRow, deciderName?: string): ApprovalDecision | undefined {
  const at = a.executedAt ?? a.decidedAt ?? new Date();
  const by = deciderName ?? (a.approverDiscordId ? `<@${a.approverDiscordId}>` : undefined);
  const err = a.result && typeof a.result === "object" && "error" in a.result ? String((a.result as { error: unknown }).error) : undefined;
  switch (a.status) {
    case "approved": return { status: "approved", by, at };
    case "executed": return { status: "executed", by, at };
    case "failed": return { status: "failed", by, at, note: err };
    case "rejected": return { status: "rejected", by, at, note: a.decisionNote ?? undefined };
    case "expired": return { status: "expired", at, note: a.decisionNote ?? undefined };
    case "cancelled": return { status: "cancelled", by, at, note: a.decisionNote ?? undefined };
    default: return undefined;
  }
}
