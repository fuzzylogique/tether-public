import {
  pgTable, pgView, uuid, text, timestamp, jsonb, integer, bigint, numeric, boolean, index, vector, primaryKey,
} from "drizzle-orm/pg-core";

// ---------- Tenancy & identity ----------
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  guildId: text("guild_id").notNull().unique(),
  name: text("name").notNull(),
  sheetId: text("sheet_id"),
  driveFolderId: text("drive_folder_id"),
  calendarId: text("calendar_id"),
  // { ops, finance, sponsorship, socials, announcements, help, config } -> channel ids
  channels: jsonb("channels").$type<Record<string, string>>().default({}).notNull(),
  // channel id -> agent name (Tier 1 bindings)
  channelAgents: jsonb("channel_agents").$type<Record<string, string>>().default({}).notNull(),
  // team key (lead, finance, sponsorship, socials, logistics) -> Discord role id, created by `/tether channels`
  roles: jsonb("roles").$type<Record<string, string>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  discordId: text("discord_id"),
  auth0Sub: text("auth0_sub"),
  email: text("email"),
  name: text("name"),
  roles: text("roles").array().default(["organizer"]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("users_org_discord_idx").on(t.orgId, t.discordId)]);

// ---------- Plans, runs, steps, actions ----------
export type PlanStep = {
  id: string;
  agent: string;
  instruction: string;
  dependsOn: string[];
  needsApproval: boolean;
  enabled: boolean;
};
export type Plan = { summary: string; steps: PlanStep[] };

export type RunStatus =
  | "proposed" | "approved" | "running" | "awaiting_approval" | "done" | "failed" | "cancelled" | "expired";

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  trigger: text("trigger").notNull(), // slash | mention | thread | cron | watcher | workflow | dm
  // where to render: { channelId, messageId, threadId, statusMessageId, planMessageId }
  source: jsonb("source").$type<Record<string, string | undefined>>().default({}).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  actorDiscordId: text("actor_discord_id"),
  request: text("request").notNull(),
  plan: jsonb("plan").$type<Plan>(),
  planHistory: jsonb("plan_history").$type<Plan[]>().default([]).notNull(),
  status: text("status").$type<RunStatus>().default("proposed").notNull(),
  summary: text("summary"),
  cancelledBy: text("cancelled_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("runs_org_created_idx").on(t.orgId, t.createdAt)]);

export type StepStatus = "pending" | "running" | "awaiting_approval" | "done" | "failed" | "skipped" | "cancelled";

export const steps = pgTable("steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => runs.id).notNull(),
  stepKey: text("step_key").notNull(),
  agent: text("agent").notNull(),
  instruction: text("instruction").notNull(),
  status: text("status").$type<StepStatus>().default("pending").notNull(),
  output: text("output"),
  messages: jsonb("messages").$type<unknown[]>().default([]).notNull(),
  tokensIn: integer("tokens_in").default(0).notNull(),
  tokensOut: integer("tokens_out").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("steps_run_idx").on(t.runId)]);

/** `approved` is transient: a human said yes and the executor has not run yet (docs/CARDS.md §2). */
export type ActionStatus = "pending" | "approved" | "rejected" | "executed" | "failed" | "denied" | "expired" | "cancelled";

export const actions = pgTable("actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  runId: uuid("run_id").references(() => runs.id).notNull(),
  stepId: uuid("step_id").references(() => steps.id),
  agent: text("agent").notNull(),
  tool: text("tool").notNull(),
  args: jsonb("args").$type<Record<string, unknown>>().notNull(),
  summary: text("summary").notNull(),
  effect: text("effect").notNull(),
  risk: text("risk").notNull(),
  status: text("status").$type<ActionStatus>().default("pending").notNull(),
  /** Minimum Tether role that may decide this action, copied from `policy.decide()` ("lead" or null = organizer). */
  approverRole: text("approver_role"),
  approverUserId: uuid("approver_user_id").references(() => users.id),
  approverDiscordId: text("approver_discord_id"),
  editedBy: text("edited_by"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editedFields: text("edited_fields").array(),
  decisionNote: text("decision_note"),
  result: jsonb("result"),
  undoRef: jsonb("undo_ref"),
  messageRef: jsonb("message_ref").$type<{ channelId: string; messageId: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
}, (t) => [index("actions_org_status_idx").on(t.orgId, t.status)]);

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  tool: text("tool").notNull(), // tool name or "*"
  // { field?: string, op?: "lt"|"lte"|"gt"|"gte"|"eq"|"in", value?: unknown, roles?: string[] }
  condition: jsonb("condition").$type<Record<string, unknown>>().default({}).notNull(),
  decision: text("decision").$type<"run" | "approve" | "deny">().notNull(),
  priority: integer("priority").default(100).notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Audit / activity stream. Hypertable on Tiger (see sql/tiger.sql). No foreign keys on purpose:
// chunks are dropped by retention, and the stream must never block a run on a missing parent row.
export const events = pgTable("events", {
  time: timestamp("time", { withTimezone: true }).defaultNow().notNull(),
  orgId: uuid("org_id").notNull(),
  runId: uuid("run_id"),
  kind: text("kind").notNull(),
  agent: text("agent"),
  data: jsonb("data").$type<Record<string, unknown>>().default({}).notNull(),
}, (t) => [
  index("events_org_time_idx").on(t.orgId, t.time),
  // The status card's tool log reads a run's tool_call events on every redraw (docs/GUIDE.md §5.2).
  index("events_run_time_idx").on(t.runId, t.time),
  // `create_hypertable` creates this default index (time DESC). Declaring it here keeps drizzle-kit from
  // dropping it as "unknown"; on a fresh DB drizzle creates it first and create_hypertable skips its own.
  index("events_time_idx").on(t.time.desc().nullsFirst()),
]);

// Timescale continuous aggregate over `events`, created in sql/tiger.sql. Postgres exposes it as a plain
// view (relkind `v`), so it is declared as an *existing* pgView: drizzle-kit must never create, alter or
// drop it (`DROP VIEW` on a continuous aggregate is an error, and it would take the dashboard chart with it).
export const agentActivityHourly = pgView("agent_activity_hourly", {
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  orgId: uuid("org_id").notNull(),
  agent: text("agent"),
  kind: text("kind").notNull(),
  n: bigint("n", { mode: "number" }).notNull(),
}).existing();

// Tier 1 persistent agent sessions bound to a Discord thread
export const agentSessions = pgTable("agent_sessions", {
  threadId: text("thread_id").primaryKey(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  agent: text("agent").notNull(),
  messages: jsonb("messages").$type<unknown[]>().default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------- Mirror of Google data ----------
export const budgetLines = pgTable("budget_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  category: text("category").notNull(),
  allocated: numeric("allocated", { precision: 12, scale: 2 }).notNull(),
  sheetRow: integer("sheet_row"),
});

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  category: text("category").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  vendor: text("vendor"),
  description: text("description"),
  date: text("date"), // ISO date
  receiptUrl: text("receipt_url"),
  // Tax portion of `amount` (HST on Ontario receipts); amount is always the total paid.
  tax: numeric("tax", { precision: 12, scale: 2 }),
  // Who fronted the money when an organizer paid out of pocket; null when paid from the org account.
  paidBy: text("paid_by"),
  reimbursement: text("reimbursement").$type<ReimbursementStatus>().default("none").notNull(),
  sheetRow: integer("sheet_row"),
  loggedByDiscordId: text("logged_by_discord_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ReimbursementStatus = "none" | "pending" | "paid";
export type IncomeStatus = "pledged" | "invoiced" | "received";

// Money coming in: sponsorship payments, club funding, ticket sales. Mirror of the Income sheet tab.
export const income = pgTable("income", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  source: text("source").notNull(),
  sponsorId: uuid("sponsor_id").references(() => sponsors.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status").$type<IncomeStatus>().default("pledged").notNull(),
  date: text("date"), // ISO date
  notes: text("notes"),
  sheetRow: integer("sheet_row"),
  loggedByDiscordId: text("logged_by_discord_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SponsorStage = "lead" | "contacted" | "replied" | "negotiating" | "confirmed" | "declined";

export const sponsors = pgTable("sponsors", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  stage: text("stage").$type<SponsorStage>().default("lead").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  tier: text("tier"),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  notes: text("notes"),
  sheetRow: integer("sheet_row"),
  // contract obligations checklist (fulfillment tracker)
  deliverables: jsonb("deliverables").$type<{ title: string; done: boolean }[]>().default([]).notNull(),
});

export const sponsorThreads = pgTable("sponsor_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  // A thread outlives its sponsor row: seed/reset delete and re-insert sponsors, so detach instead of failing.
  sponsorId: uuid("sponsor_id").references(() => sponsors.id, { onDelete: "set null" }),
  gmailThreadId: text("gmail_thread_id").notNull().unique(),
  lastMessageId: text("last_message_id"),
  lastDirection: text("last_direction"), // inbound | outbound
  lastSnippet: text("last_snippet"),
  classification: text("classification"), // interested | declined | needs_info | other
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Gmail message ids the inbound poller has already dispatched. Primary key on message_id is the
// dedup guarantee: `insert ... on conflict do nothing returning` wins exactly once per message.
export const processedMail = pgTable("processed_mail", {
  messageId: text("message_id").primaryKey(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  threadId: text("thread_id").notNull(),
  seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("processed_mail_org_thread_idx").on(t.orgId, t.threadId)]);

export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  title: text("title").notNull(),
  ownerDiscordId: text("owner_discord_id"),
  ownerName: text("owner_name"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: text("status").$type<TaskStatus>().default("todo").notNull(),
  nudgeCount: integer("nudge_count").default(0).notNull(),
  lastNudgedAt: timestamp("last_nudged_at", { withTimezone: true }),
  escalated: boolean("escalated").default(false).notNull(),
  // What the owner said the last time they answered a nudge (DM or reply in #tasks), and when.
  lastReply: text("last_reply"),
  lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
  notes: text("notes"),
  sheetRow: integer("sheet_row"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  googleEventId: text("google_event_id").unique(),
  title: text("title").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  location: text("location"),
  attendees: jsonb("attendees").$type<string[]>().default([]).notNull(),
});

// ---------- Knowledge (helpdesk + sponsor memory) ----------
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => orgs.id).notNull(),
  kind: text("kind").notNull(), // faq | schedule | rules | sponsor_email | post | doc
  title: text("title").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("documents_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  // BM25 index from pg_textsearch (Tiger Cloud). sql/tiger.sql also creates it, guarded, for DBs without the
  // extension; declaring it here stops drizzle-kit from dropping it as "unknown".
  index("documents_bm25_idx").using("bm25", t.content.op("text_bm25_ops")).with({ text_config: "english" }),
]);

// ---------- Brand kit (socials) ----------
export const brandKits = pgTable("brand_kits", {
  orgId: uuid("org_id").references(() => orgs.id).primaryKey(),
  primaryColor: text("primary_color").default("#6D5DF6").notNull(),
  secondaryColor: text("secondary_color").default("#0EA5A4").notNull(),
  fontFamily: text("font_family").default("Inter").notNull(),
  tone: text("tone").default("energetic, friendly, concise").notNull(),
  logoUrl: text("logo_url"),
  templates: jsonb("templates").$type<string[]>().default(["poster-square", "story-portrait"]).notNull(),
});

export const schema = {
  orgs, users, runs, steps, actions, policies, events, agentActivityHourly, agentSessions,
  budgetLines, expenses, sponsors, sponsorThreads, processedMail, tasks, calendarEvents, documents, brandKits,
};
