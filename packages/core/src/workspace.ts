import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { env } from "./env.js";
import {
  actions, agentActivityHourly, budgetLines, calendarEvents, expenses, orgs, sponsorThreads, sponsors,
  type IntegrationKey, type MetricKey, type WorkspaceGoals,
} from "./db/schema.js";
import { listEvents } from "./google/calendar.js";

type Org = typeof orgs.$inferSelect;

// ---------- Integrations ----------

export const INTEGRATIONS: { key: IntegrationKey; label: string; description: string; tools: string[] }[] = [
  { key: "gmail", label: "Gmail", description: "Sponsor replies, drafts and sends, inbox digest", tools: ["send_email", "create_email_draft", "search_sponsor_replies", "inbox_digest"] },
  { key: "calendar", label: "Google Calendar", description: "Today's schedule, new events, conflict checks", tools: ["list_events", "create_event", "find_conflicts"] },
  { key: "sheets", label: "Google Sheets", description: "Budget, expenses and income tabs", tools: ["sync_budget_from_sheet"] },
  { key: "docs", label: "Google Docs", description: "No agent reads Docs yet; the setting is kept for when one does", tools: [] },
];

export const integrationKeys = INTEGRATIONS.map((i) => i.key);

const toolIntegration = new Map(INTEGRATIONS.flatMap((i) => i.tools.map((t) => [t, i.key] as const)));

export function integrationEnabled(org: Pick<Org, "integrations">, key: IntegrationKey) {
  return org.integrations?.[key] !== false;
}

export type IntegrationStatus = "connected" | "off" | "needs_setup";

/** What the overview icon shows: switched off, switched on but missing credentials or ids, or working. */
export function integrationStatus(org: Org, key: IntegrationKey): IntegrationStatus {
  if (!integrationEnabled(org, key)) return "off";
  if (key !== "docs" && !env().GOOGLE_REFRESH_TOKEN) return "needs_setup";
  if (key === "calendar" && !org.calendarId) return "needs_setup";
  if (key === "sheets" && !org.sheetId) return "needs_setup";
  return "connected";
}

/** False when the tool belongs to an integration this workspace has switched off. Agents never see such tools. */
export function toolAllowed(org: Pick<Org, "integrations">, toolName: string) {
  const key = toolIntegration.get(toolName);
  return !key || integrationEnabled(org, key);
}

/**
 * The org as tools should see it. Tools already treat a missing sheet or calendar id as "not configured",
 * so switching Sheets off keeps expenses in the database mirror and stops writes to the spreadsheet.
 */
export function maskOrg<T extends Org>(org: T): T {
  return {
    ...org,
    sheetId: integrationEnabled(org, "sheets") ? org.sheetId : null,
    calendarId: integrationEnabled(org, "calendar") ? org.calendarId : null,
  };
}

export async function setIntegration(orgId: string, key: IntegrationKey, enabled: boolean) {
  // jsonb `||` merges one key, so two people toggling different integrations at once both win.
  const [row] = await db().update(orgs)
    .set({ integrations: sql`${orgs.integrations} || ${JSON.stringify({ [key]: enabled })}::jsonb` })
    .where(eq(orgs.id, orgId)).returning();
  return row;
}

// ---------- Goals ----------

export const METRICS: { key: MetricKey; label: string; unit: "money" | "count"; manualCurrent: boolean }[] = [
  { key: "sponsorship", label: "Sponsorship", unit: "money", manualCurrent: false },
  { key: "registrations", label: "Registrations", unit: "count", manualCurrent: true },
  { key: "volunteers", label: "Volunteers", unit: "count", manualCurrent: true },
  { key: "mentors", label: "Mentors", unit: "count", manualCurrent: true },
  { key: "judges", label: "Judges", unit: "count", manualCurrent: true },
];

export const PEOPLE_METRICS = ["volunteers", "mentors", "judges"] as const;

export async function setGoal(orgId: string, key: MetricKey, patch: { target?: number; current?: number; source: string }) {
  const [org] = await db().select({ goals: orgs.goals }).from(orgs).where(eq(orgs.id, orgId));
  if (!org) throw new Error("workspace not found");
  const prev = org.goals[key] ?? {};
  const next: WorkspaceGoals = {
    ...org.goals,
    [key]: {
      ...prev,
      ...(patch.target !== undefined ? { target: patch.target } : {}),
      ...(patch.current !== undefined ? { current: patch.current, source: patch.source, updatedAt: new Date().toISOString() } : {}),
    },
  };
  await db().update(orgs).set({ goals: next }).where(eq(orgs.id, orgId));
  return next[key]!;
}

// ---------- Overview ----------

const TZ = "America/Toronto";

/** Midnight to midnight in the organizer's timezone, as UTC instants. */
export function todayBounds(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" }).formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "+00:00";
  const start = new Date(`${day}T00:00:00${offset}`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export type Progress = { current: number; target?: number; source: string; updatedAt?: string };

export type AgentActivity = { hours: { at: Date; n: number }[]; byAgent: { agent: string; n: number }[] };

/**
 * Agent events per hour for the last 24 hours, read from the TigerData continuous aggregate
 * (`agent_activity_hourly`, refreshed every 5 minutes) so neither the dashboard card nor `/tether status`
 * ever scans the raw `events` hypertable. Hours with no activity are present with `n: 0`.
 */
export async function agentActivityLast24h(orgId: string): Promise<AgentActivity> {
  const HOUR = 3_600_000;
  const thisHour = Math.floor(Date.now() / HOUR) * HOUR;
  const hours = Array.from({ length: 24 }, (_, i) => ({ at: new Date(thisHour - (23 - i) * HOUR), n: 0 }));
  const hourly = await db().select({ bucket: agentActivityHourly.bucket, agent: agentActivityHourly.agent, n: agentActivityHourly.n })
    .from(agentActivityHourly)
    .where(and(eq(agentActivityHourly.orgId, orgId), gte(agentActivityHourly.bucket, hours[0]!.at), isNotNull(agentActivityHourly.agent)));
  const perAgent = new Map<string, number>();
  for (const row of hourly) {
    const slot = hours[23 - (thisHour - row.bucket.getTime()) / HOUR];
    if (slot) slot.n += Number(row.n);
    perAgent.set(row.agent!, (perAgent.get(row.agent!) ?? 0) + Number(row.n));
  }
  return { hours, byAgent: [...perAgent].map(([agent, n]) => ({ agent, n })).sort((a, b) => b.n - a.n) };
}

export type WorkspaceSummary = {
  org: { id: string; name: string; eventStartAt: Date | null };
  integrations: { key: IntegrationKey; label: string; description: string; status: IntegrationStatus }[];
  sponsorship: Progress;
  budget: Progress;
  registrations: Progress | undefined;
  people: { total: Progress | undefined; parts: { key: string; label: string; current: number; target?: number }[] };
  today: { title: string; start: string; end: string; location?: string }[];
  todaySource: "google" | "mirror" | "off";
  inbox: { count: number; threads: { sponsor: string; snippet: string; updatedAt: Date }[] };
  activity: { agent: string; summary: string; at: Date }[];
  agentActivity: AgentActivity;
  pendingApprovals: number;
};

function manual(goals: WorkspaceGoals, key: MetricKey): Progress | undefined {
  const g = goals[key];
  if (!g || (g.current === undefined && g.target === undefined)) return undefined;
  return { current: g.current ?? 0, target: g.target, source: g.source ?? "not reported yet", updatedAt: g.updatedAt };
}

export async function workspaceSummary(org: Org): Promise<WorkspaceSummary> {
  const d = db();
  const { start, end } = todayBounds();

  const [confirmed] = await d.select({ total: sql<string>`coalesce(sum(${sponsors.amount}),0)`, n: sql<number>`count(*)::int` })
    .from(sponsors).where(and(eq(sponsors.orgId, org.id), eq(sponsors.stage, "confirmed")));
  const [allocated] = await d.select({ total: sql<string>`coalesce(sum(${budgetLines.allocated}),0)` }).from(budgetLines).where(eq(budgetLines.orgId, org.id));
  const [spent] = await d.select({ total: sql<string>`coalesce(sum(${expenses.amount}),0)`, last: sql<Date | null>`max(${expenses.createdAt})` })
    .from(expenses).where(eq(expenses.orgId, org.id));

  const people = PEOPLE_METRICS.map((k) => ({ key: k, label: METRICS.find((m) => m.key === k)!.label, g: org.goals[k] }));
  const tracked = people.filter((p) => p.g && (p.g.current !== undefined || p.g.target !== undefined));
  const latest = tracked.map((p) => p.g!.updatedAt).filter((x): x is string => !!x).sort().at(-1);
  const peopleTotal: Progress | undefined = tracked.length ? {
    current: tracked.reduce((a, p) => a + (p.g!.current ?? 0), 0),
    target: tracked.every((p) => p.g!.target !== undefined) ? tracked.reduce((a, p) => a + p.g!.target!, 0) : undefined,
    source: tracked.length === 1 ? tracked[0]!.g!.source ?? "not reported yet" : `${tracked.length} roles reported`,
    updatedAt: latest,
  } : undefined;

  // Today's schedule: live from Google when the calendar is connected, else whatever the mirror holds.
  let today: WorkspaceSummary["today"] = [];
  let todaySource: WorkspaceSummary["todaySource"] = "off";
  if (integrationStatus(org, "calendar") === "connected") {
    try {
      today = (await listEvents(org.calendarId!, start.toISOString(), end.toISOString())).map((e) => ({ title: e.title, start: e.start, end: e.end, location: e.location }));
      todaySource = "google";
    } catch { /* fall back to the mirror below */ }
  }
  if (todaySource !== "google" && integrationEnabled(org, "calendar")) {
    const rows = await d.select().from(calendarEvents)
      .where(and(eq(calendarEvents.orgId, org.id), gte(calendarEvents.startAt, start), lt(calendarEvents.startAt, end))).orderBy(calendarEvents.startAt);
    today = rows.map((r) => ({ title: r.title, start: r.startAt.toISOString(), end: r.endAt.toISOString(), location: r.location ?? undefined }));
    todaySource = "mirror";
  }

  // Inbox: sponsor threads whose last message came in and has not been answered.
  const waitingWhere = and(eq(sponsorThreads.orgId, org.id), eq(sponsorThreads.lastDirection, "inbound"));
  const [waiting] = await d.select({ n: sql<number>`count(*)::int` }).from(sponsorThreads).where(waitingWhere);
  const threads = integrationEnabled(org, "gmail") ? await d.select({ snippet: sponsorThreads.lastSnippet, updatedAt: sponsorThreads.updatedAt, sponsor: sponsors.name })
    .from(sponsorThreads).leftJoin(sponsors, eq(sponsors.id, sponsorThreads.sponsorId))
    .where(waitingWhere).orderBy(desc(sponsorThreads.updatedAt)).limit(3) : [];

  const activity = await d.select({ agent: actions.agent, summary: actions.summary, at: actions.executedAt })
    .from(actions).where(and(eq(actions.orgId, org.id), eq(actions.status, "executed")))
    .orderBy(desc(actions.executedAt)).limit(5);
  const [pending] = await d.select({ n: sql<number>`count(*)::int` }).from(actions).where(and(eq(actions.orgId, org.id), eq(actions.status, "pending")));

  const agentActivity = await agentActivityLast24h(org.id);

  return {
    org: { id: org.id, name: org.name, eventStartAt: org.eventStartAt },
    integrations: INTEGRATIONS.map((i) => ({ key: i.key, label: i.label, description: i.description, status: integrationStatus(org, i.key) })),
    sponsorship: {
      current: Number(confirmed?.total ?? 0), target: org.goals.sponsorship?.target,
      source: `${confirmed?.n ?? 0} confirmed sponsor${confirmed?.n === 1 ? "" : "s"} in the pipeline`,
    },
    budget: {
      current: Number(spent?.total ?? 0), target: Number(allocated?.total ?? 0) || undefined,
      source: "Budget and Expenses", updatedAt: spent?.last ? new Date(spent.last).toISOString() : undefined,
    },
    registrations: manual(org.goals, "registrations"),
    people: { total: peopleTotal, parts: tracked.map((p) => ({ key: p.key, label: p.label, current: p.g!.current ?? 0, target: p.g!.target })) },
    today, todaySource,
    inbox: { count: integrationEnabled(org, "gmail") ? waiting?.n ?? 0 : 0, threads: threads.map((t) => ({ sponsor: t.sponsor ?? "Unknown sender", snippet: t.snippet ?? "", updatedAt: t.updatedAt })) },
    activity: activity.filter((a): a is typeof a & { at: Date } => !!a.at),
    agentActivity,
    pendingApprovals: pending?.n ?? 0,
  };
}

export function daysUntil(at: Date | null, now = new Date()) {
  if (!at) return undefined;
  const a = todayBounds(at).start.getTime(), b = todayBounds(now).start.getTime();
  return Math.round((a - b) / 86_400_000);
}
