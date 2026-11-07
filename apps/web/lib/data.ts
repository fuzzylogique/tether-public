import { db, schema } from "@tether/core";
import { desc, eq, sql } from "drizzle-orm";

export async function firstOrg() {
  const [org] = await db().select().from(schema.orgs).limit(1);
  return org;
}

export async function overview(orgId: string) {
  const lines = await db().select().from(schema.budgetLines).where(eq(schema.budgetLines.orgId, orgId));
  const spent = await db().select({ category: schema.expenses.category, total: sql<string>`coalesce(sum(${schema.expenses.amount}),0)` })
    .from(schema.expenses).where(eq(schema.expenses.orgId, orgId)).groupBy(schema.expenses.category);
  const spentBy = Object.fromEntries(spent.map((s) => [s.category, Number(s.total)]));
  const budget = lines.map((l) => ({ category: l.category, allocated: Number(l.allocated), spent: spentBy[l.category] ?? 0 }));
  const sponsors = await db().select().from(schema.sponsors).where(eq(schema.sponsors.orgId, orgId));
  const tasks = await db().select().from(schema.tasks).where(eq(schema.tasks.orgId, orgId));
  const pending = await db().select().from(schema.actions).where(sql`${schema.actions.orgId} = ${orgId} and ${schema.actions.status} = 'pending'`);
  const recentRuns = await db().select().from(schema.runs).where(eq(schema.runs.orgId, orgId)).orderBy(desc(schema.runs.createdAt)).limit(8);
  const activity = await db().select().from(schema.events).where(eq(schema.events.orgId, orgId)).orderBy(desc(schema.events.time)).limit(30);
  return { budget, sponsors, tasks, pending, recentRuns, activity };
}

export async function pendingActions(orgId: string) {
  return db().select().from(schema.actions).where(sql`${schema.actions.orgId} = ${orgId} and ${schema.actions.status} = 'pending'`).orderBy(desc(schema.actions.createdAt));
}

export async function runsList(orgId: string) {
  return db().select().from(schema.runs).where(eq(schema.runs.orgId, orgId)).orderBy(desc(schema.runs.createdAt)).limit(50);
}

export async function runDetail(runId: string) {
  const [run] = await db().select().from(schema.runs).where(eq(schema.runs.id, runId));
  if (!run) return undefined;
  const stepRows = await db().select().from(schema.steps).where(eq(schema.steps.runId, runId));
  const actionRows = await db().select().from(schema.actions).where(eq(schema.actions.runId, runId));
  const evs = await db().select().from(schema.events).where(eq(schema.events.runId, runId)).orderBy(schema.events.time);
  return { run, steps: stepRows, actions: actionRows, events: evs };
}

export async function policiesList(orgId: string) {
  return db().select().from(schema.policies).where(eq(schema.policies.orgId, orgId)).orderBy(schema.policies.priority);
}
