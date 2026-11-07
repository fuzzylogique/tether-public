/**
 * Card builders that need data: approval cards look up the budget line and channel ids,
 * every run card links to the dashboard. The builders in ui/cards stay pure.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { actions, budgetLines, expenses, orgs } from "../db/schema.js";
import { env } from "../env.js";
import type { ActionRef } from "../tools/types.js";
import { approvalCard, type ApprovalContext, type ApprovalDecision } from "../ui/cards/approval.js";

type Org = typeof orgs.$inferSelect;
type ActionRow = typeof actions.$inferSelect;

/** Dashboard link for a run. Discord only accepts public https URLs on link buttons. */
export function dashboardRunUrl(runId: string) {
  const base = env().WEB_PUBLIC_URL.replace(/\/$/, "");
  return base.startsWith("https://") ? `${base}/runs/${runId}` : undefined;
}

export async function approvalContext(org: Org, a: Pick<ActionRef, "tool" | "args">): Promise<ApprovalContext> {
  const ctx: ApprovalContext = { channels: org.channels };
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
  return { id: a.id, tool: a.tool, agent: a.agent, summary: a.summary, risk: a.risk as ActionRef["risk"], effect: a.effect as ActionRef["effect"], args };
}

/** The approval card for an action row, optionally re-rendered with its decision. */
export async function approvalCardFor(org: Org, a: ActionRow, decision?: ApprovalDecision, args?: Record<string, unknown>) {
  const ref = actionRef(a, args);
  return approvalCard(ref, { context: await approvalContext(org, ref), decision });
}

/** Decision for a settled action row, for the final re-render after execution. */
export function settledDecision(a: ActionRow, deciderName?: string): ApprovalDecision | undefined {
  const at = a.executedAt ?? a.decidedAt ?? new Date();
  const err = a.result && typeof a.result === "object" && "error" in a.result ? String((a.result as { error: unknown }).error) : undefined;
  switch (a.status) {
    case "executed": return { status: "executed", by: deciderName, at };
    case "failed": return { status: "failed", by: deciderName, at, note: err };
    case "rejected": return { status: "rejected", by: deciderName, at, note: a.decisionNote ?? undefined };
    case "expired": return { status: "expired", at };
    default: return undefined;
  }
}
