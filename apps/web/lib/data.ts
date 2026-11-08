import { db, hasRole, schema } from "@tether/core";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { authConfigured, currentUser } from "./auth0";

type User = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/**
 * Workspace membership for a signed-in person: `users` rows matched by Auth0 subject or email
 * (`/workspace web email:` in Discord creates them). Without Auth0 configured (local dev) every
 * workspace is visible and editable.
 */
async function memberships(user: User) {
  if (!authConfigured) return undefined;
  const email = user.emailVerified ? user.email.toLowerCase() : "";
  const conds = [user.sub ? eq(schema.users.auth0Sub, user.sub) : undefined, email ? sql`lower(${schema.users.email}) = ${email}` : undefined].filter((c) => c !== undefined);
  if (!conds.length) return [];
  return db().select({ orgId: schema.users.orgId, roles: schema.users.roles }).from(schema.users).where(or(...conds));
}

export async function workspacesFor(user: User) {
  const m = await memberships(user);
  if (m && !m.length) return [];
  const orgRows = await db().select().from(schema.orgs)
    .where(m ? inArray(schema.orgs.id, [...new Set(m.map((r) => r.orgId))]) : undefined)
    .orderBy(schema.orgs.name);
  if (!orgRows.length) return [];
  const pending = await db().select({ orgId: schema.actions.orgId, n: sql<number>`count(*)::int` }).from(schema.actions)
    .where(and(inArray(schema.actions.orgId, orgRows.map((o) => o.id)), eq(schema.actions.status, "pending")))
    .groupBy(schema.actions.orgId);
  const last = await db().select({ orgId: schema.actions.orgId, at: sql<Date | null>`max(${schema.actions.executedAt})` }).from(schema.actions)
    .where(inArray(schema.actions.orgId, orgRows.map((o) => o.id))).groupBy(schema.actions.orgId);
  const pend = new Map(pending.map((p) => [p.orgId, p.n]));
  const lastAt = new Map(last.map((l) => [l.orgId, l.at ? new Date(l.at) : null]));
  return orgRows.map((o) => ({ org: o, pending: pend.get(o.id) ?? 0, lastActivity: lastAt.get(o.id) ?? null }));
}

/** The workspace if this person may see it, plus whether they may change its settings (organizer and up). */
export async function workspaceFor(user: User, orgId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return undefined;
  const [org] = await db().select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!org) return undefined;
  const m = await memberships(user);
  if (!m) return { org, canEdit: true };
  const rows = m.filter((r) => r.orgId === orgId);
  if (!rows.length) return undefined;
  return { org, canEdit: rows.some((r) => hasRole(r.roles, "organizer")) };
}

export async function runDetail(runId: string) {
  const [run] = await db().select().from(schema.runs).where(eq(schema.runs.id, runId));
  if (!run) return undefined;
  const stepRows = await db().select().from(schema.steps).where(eq(schema.steps.runId, runId));
  const actionRows = await db().select().from(schema.actions).where(eq(schema.actions.runId, runId));
  const evs = await db().select().from(schema.events).where(eq(schema.events.runId, runId)).orderBy(schema.events.time);
  return { run, steps: stepRows, actions: actionRows, events: evs };
}

