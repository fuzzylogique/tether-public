/**
 * Fixture cards for `pnpm discord:preview` and the chart snapshot test. Values mirror
 * src/db/seed.ts so the preview looks like the demo org.
 */
import type { Plan } from "../db/schema.js";
import type { ActionRef } from "../tools/types.js";
import { TETHER } from "./tokens.js";
import { kv, sep, text, type Card } from "./card.js";
import { activityCard, approvalCard, budgetCard, calendarCard, planCard, sponsorsCard, statusCard, summaryCard, tasksCard, type StepState } from "./cards/index.js";

export const DEFAULT_AVATAR = "https://cdn.discordapp.com/embed/avatars/0.png";

export type Fixture = { name: string; card: Card };

export function primitivesCard(): Card {
  return {
    accent: TETHER,
    title: "Tether design system",
    subtitle: "every Components V2 primitive the cards are built from",
    blocks: [
      text("Text display with **markdown**, `code`, a <t:1794070800:R> timestamp and an app emoji :tether_done:."),
      sep(),
      { kind: "section", md: ["**Section with a thumbnail**", "Up to three text displays and exactly one accessory."], thumb: { url: DEFAULT_AVATAR, alt: "default avatar" } },
      { kind: "section", md: ["**Section with a button**", "-# accessories can be buttons too"], button: { kind: "button", id: "preview:noop", label: "Button", style: "secondary" } },
      sep(false, true),
      kv([["Label", "value"], ["Amount", "$1,850"], ["Empty", ""]]),
    ],
    actions: [[
      { kind: "button", id: "preview:primary", label: "Primary", style: "primary" },
      { kind: "button", id: "preview:success", label: "Success", style: "success", emoji: ":tether_done:" },
      { kind: "button", id: "preview:danger", label: "Danger", style: "danger" },
      { kind: "link", url: "https://hacktrent.ca", label: "Link" },
    ]],
    footer: "fixture · primitives",
  };
}

const RUN = "7f3c2a91-5b4e-4d2a-9c11-0e8f6a2b4c7d";
const NOW = Date.UTC(2026, 10, 7, 18, 30);
const MIN = 60_000, HOUR = 3600_000, DAY = 86400_000;
export const DEMO_REQUEST = "Shopify confirmed $2k! Kick off onboarding: thank them, book the kickoff call, update the budget and tell the team.";
export const HERO_URL = "https://picsum.photos/seed/hacktrent-hero/1200/675";
export const RECEIPT_URL = "https://picsum.photos/seed/hacktrent-receipt/400/600";

/** Demo 2 from docs/ARCHITECTURE.md, with the socials step unticked. */
export const DEMO_PLAN: Plan = {
  summary: "Onboard Shopify as a Gold sponsor",
  steps: [
    { id: "s1", agent: "outreach", instruction: "Mark Shopify confirmed at $2,000 (Gold) and email Priya a thank-you with next steps and the logo spec request.", dependsOn: [], needsApproval: true, enabled: true },
    { id: "s2", agent: "calendar", instruction: "Book a 30-minute sponsor kickoff call with Shopify on Monday morning and invite Priya.", dependsOn: ["s1"], needsApproval: true, enabled: true },
    { id: "s3", agent: "finance", instruction: "Record Shopify's $2,000 against the Prizes line and report what is left.", dependsOn: ["s1"], needsApproval: false, enabled: true },
    { id: "s4", agent: "socials", instruction: "Draft an announcement thanking Shopify with a hero image.", dependsOn: ["s1"], needsApproval: true, enabled: false },
    { id: "s5", agent: "coordination", instruction: "Create a task for Sam to send Shopify our booth requirements by Wednesday.", dependsOn: ["s2"], needsApproval: false, enabled: true },
  ],
};

const steps = (statuses: StepState["status"][]): StepState[] =>
  DEMO_PLAN.steps.filter((s) => s.enabled).map((s, i) => ({ id: s.id, agent: s.agent, instruction: s.instruction, status: statuses[i] ?? "pending", finishedAt: statuses[i] === "done" || statuses[i] === "failed" ? NOW - (4 - i) * MIN : undefined }));

const action = (tool: string, agent: string, summary: string, risk: ActionRef["risk"], args: Record<string, unknown>, effect: ActionRef["effect"] = "external"): ActionRef =>
  ({ id: `a1b2c3d4-${tool.length.toString(16).padStart(4, "0")}-4000-8000-000000000000`, tool, agent, summary, risk, effect, args });

export const APPROVALS = {
  email: action("send_email", "outreach", "Send email to priya@shopify.com: \"Welcome aboard, Shopify!\"", "high", {
    to: "priya@shopify.com", subject: "Welcome aboard, Shopify!", sponsorName: "Shopify",
    body: "Hi Priya,\n\nThank you so much for confirming Shopify as a Gold sponsor of HackTrent 2026. We're thrilled to have you.\n\nNext steps:\n- We'll send a calendar invite for a short kickoff call on Monday.\n- Could you share your logo (SVG preferred) and brand guidelines by Wednesday?\n\nBest,\nFayez · HackTrent organizing team",
  }),
  announcement: action("post_announcement", "socials", "Post announcement: Huge thanks to Shopify, our newest Gold sponsor!", "medium", {
    text: "🎉 Huge thanks to **Shopify**, our newest Gold sponsor! Their team will be on site Saturday with mentors and swag. #HackTrent2026", imageUrl: HERO_URL,
  }),
  expense: action("log_expense", "finance", "Log $84.20 to Food (Pizza Nova)", "medium", {
    category: "Food", amount: 84.2, vendor: "Pizza Nova", date: "2026-11-07", description: "Late-night slices for volunteers", receiptUrl: RECEIPT_URL,
  }, "write"),
  event: action("create_event", "calendar", "Create event \"Shopify kickoff\" at 2026-11-09T14:00:00Z with 2 invitees", "medium", {
    title: "Shopify kickoff", start: "2026-11-09T14:00:00Z", end: "2026-11-09T14:30:00Z", location: "Google Meet",
    attendees: ["priya@shopify.com", "sponsorship@hacktrent.ca"], description: "Intro, deliverables, booth logistics.",
  }, "write"),
  nudge: action("nudge_owner", "coordination", "Nudge <@000000000000000001>: Judge list was due 5 hours ago", "medium", {
    discordId: "000000000000000001", taskTitle: "Confirm judge list", message: "Hey Alex, the judge list was due 5 hours ago. Can you confirm the last two judges or tell us what's blocking?",
  }),
  escalate: action("escalate", "coordination", "Escalate: Confirm judge list is 5h overdue after 2 nudges", "medium", {
    taskTitle: "Confirm judge list", message: "Confirm judge list is 5 hours overdue and Alex hasn't replied to 2 nudges. Can a lead step in?",
  }),
  fallback: action("update_sponsor", "outreach", "Update sponsor Vultr → confirmed", "low", {
    sponsorName: "Vultr", stage: "confirmed", amount: 1500, tier: "Silver",
    deliverables: [{ title: "Logo on website", done: true }, { title: "Social mention", done: false }, { title: "Booth table", done: false }],
  }, "write"),
};

// Seed values (src/db/seed.ts), with the receipt above already logged.
const budgetRows = [["Food", 4000, 1850], ["Venue", 2500, 2450], ["Swag", 1500, 920], ["Prizes", 3000, 0], ["Marketing", 600, 520]] as const;
export const BUDGET = {
  rows: budgetRows.map(([category, allocated, spent]) => ({ category, allocated, spent, remaining: allocated - spent, pctUsed: Math.round((spent / allocated) * 100) })),
  totals: budgetRows.reduce((t, [, a, s]) => ({ allocated: t.allocated + a, spent: t.spent + s, remaining: t.remaining + a - s }), { allocated: 0, spent: 0, remaining: 0 }),
};

export const SPONSORS = [
  { name: "Shopify", stage: "negotiating", amount: "2000.00", tier: "Gold", lastContactAt: new Date(NOW - 6 * DAY), deliverables: [] },
  { name: "Vultr", stage: "confirmed", amount: "1500.00", tier: "Silver", lastContactAt: new Date(NOW - 2 * DAY), deliverables: [{ title: "Logo on website", done: true }, { title: "Social mention", done: false }, { title: "Booth table", done: false }] },
  { name: "TigerData", stage: "contacted", amount: null, tier: null, lastContactAt: new Date(NOW - 9 * DAY), deliverables: [] },
  { name: "GoDaddy", stage: "replied", amount: "1000.00", tier: "Bronze", lastContactAt: new Date(NOW - 1 * DAY), deliverables: [] },
  { name: "Local Bakery", stage: "lead", amount: null, tier: null, lastContactAt: null, deliverables: [] },
];

const avatar = (i: number) => `https://cdn.discordapp.com/embed/avatars/${i}.png`;
export const TASKS = [
  { id: "t1", title: "Confirm judge list", status: "in_progress", ownerName: "Alex", ownerDiscordId: null, dueAt: new Date(NOW - 5 * HOUR), overdue: true, avatarUrl: avatar(1) },
  { id: "t2", title: "Print name badges", status: "todo", ownerName: "Sam", ownerDiscordId: null, dueAt: new Date(NOW + 4 * HOUR), overdue: false, avatarUrl: avatar(2) },
  { id: "t3", title: "Book A/V for closing ceremony", status: "blocked", ownerName: "Jordan", ownerDiscordId: null, dueAt: new Date(NOW + 30 * HOUR), overdue: false, avatarUrl: avatar(3) },
  { id: "t4", title: "Send Shopify booth requirements", status: "todo", ownerName: "Sam", ownerDiscordId: null, dueAt: new Date(NOW + 4 * DAY), overdue: false, avatarUrl: avatar(2) },
  { id: "t5", title: "Order late-night pizza", status: "done", ownerName: "Fayez", ownerDiscordId: null, dueAt: new Date(NOW - 2 * HOUR), overdue: false },
];

// Nov 7 2026 in Toronto (EST, UTC-5).
const DAY_START = Date.UTC(2026, 10, 7, 5);
const at = (h: number, m = 0) => new Date(DAY_START + h * HOUR + m * MIN).toISOString();
export const EVENTS = [
  { title: "Doors + check-in", start: at(9), end: at(10), location: "Atrium" },
  { title: "Opening ceremony", start: at(10), end: at(11), location: "Main hall", htmlLink: "https://calendar.google.com/calendar/event?eid=opening" },
  { title: "Lunch", start: at(12), end: at(13), location: "Cafeteria" },
  { title: "Sponsor fair", start: at(13), end: at(16), location: "Atrium" },
  { title: "Gemini API workshop", start: at(14), end: at(15), location: "Room 204", htmlLink: "https://calendar.google.com/calendar/event?eid=gemini" },
  { title: "Dinner", start: at(18), end: at(19), location: "Cafeteria" },
  { title: "Midnight snack", start: at(23, 30), end: at(24), location: "Atrium" },
];

export function fixtures(): Fixture[] {
  const channels = { announcements: "000000000000000010", ops: "000000000000000011" };
  return [
    { name: "primitives", card: primitivesCard() },
    { name: "plan", card: planCard({ runId: RUN, request: DEMO_REQUEST, plan: DEMO_PLAN, requester: { name: "Fayez" }, createdAt: NOW - 2 * MIN }) },
    { name: "plan-approved", card: planCard({ runId: RUN, request: DEMO_REQUEST, plan: DEMO_PLAN, requester: { name: "Fayez" }, createdAt: NOW - 2 * MIN, decision: { status: "approved", by: "Fayez", at: NOW - MIN } }) },
    { name: "status-running", card: statusCard({ runId: RUN, request: DEMO_REQUEST, status: "running", steps: steps(["done", "running", "running", "pending"]) }) },
    { name: "status-done", card: statusCard({ runId: RUN, request: DEMO_REQUEST, status: "done", steps: steps(["done", "done", "done", "done"]) }) },
    {
      name: "status-waiting", card: statusCard({
        runId: RUN, request: DEMO_REQUEST, status: "awaiting_approval", steps: steps(["done", "awaiting_approval", "running", "pending"]), dashboardUrl: "https://tether.example.com/runs/1",
        pending: [
          { stepKey: DEMO_PLAN.steps[1]!.id, summary: 'Send email to priya@shopify.com: "Gold confirmed — thank you"', channelId: "1568699100117999762", url: "https://discord.com/channels/1/2/3" },
          { stepKey: DEMO_PLAN.steps[1]!.id, summary: "Create event \"Shopify kickoff\" at 2026-11-09T09:00", channelId: "1568699100117999762", url: "https://discord.com/channels/1/2/4" },
        ],
      }),
    },
    { name: "approval-edited", card: approvalCard({ ...APPROVALS.email, approverRole: "lead" }, { context: { runUrl: "https://discord.com/channels/1/2/3" }, edited: { by: "Fayez", at: NOW - MIN, fields: ["subject", "body"] } }) },
    { name: "status-stopped", card: statusCard({ runId: RUN, request: DEMO_REQUEST, status: "cancelled", steps: steps(["done", "cancelled", "cancelled", "skipped"]), stoppedBy: "Fayez" }) },
    { name: "approval-email", card: approvalCard(APPROVALS.email) },
    { name: "approval-announcement", card: approvalCard(APPROVALS.announcement, { context: { channels } }) },
    { name: "approval-expense", card: approvalCard(APPROVALS.expense, { context: { budget: { category: "Food", allocated: 4000, spent: 1850 } } }) },
    { name: "approval-event", card: approvalCard(APPROVALS.event) },
    { name: "approval-nudge", card: approvalCard(APPROVALS.nudge) },
    { name: "approval-escalate", card: approvalCard(APPROVALS.escalate, { context: { channels } }) },
    { name: "approval-fallback", card: approvalCard(APPROVALS.fallback) },
    { name: "approval-decided", card: approvalCard(APPROVALS.email, { decision: { status: "executed", by: "Fayez", at: NOW - 30 * 1000 } }) },
    { name: "approval-rejected", card: approvalCard(APPROVALS.expense, { context: { budget: { category: "Food", allocated: 4000, spent: 1850 } }, decision: { status: "rejected", by: "Fayez", at: NOW } }) },
    // docs/CARDS.md §2: the transient and terminal states a card can be redrawn into from its row.
    { name: "approval-approving", card: approvalCard({ ...APPROVALS.email, approverRole: "lead" }, { decision: { status: "approved", by: "Fayez", at: NOW } }) },
    { name: "approval-failed", card: approvalCard(APPROVALS.email, { decision: { status: "failed", by: "Fayez", at: NOW, note: "Gmail: 403 insufficient permissions" } }) },
    { name: "approval-orphaned", card: approvalCard(APPROVALS.nudge, { decision: { status: "expired", at: NOW - 5 * MIN, note: "the run failed before a decision" } }) },
    { name: "approval-cancelled", card: approvalCard(APPROVALS.announcement, { context: { channels }, decision: { status: "cancelled", by: "Fayez", at: NOW - MIN } }) },
    { name: "plan-expired", card: planCard({ runId: RUN, request: DEMO_REQUEST, plan: DEMO_PLAN, requester: { name: "Fayez" }, createdAt: NOW - 24 * 60 * MIN, decision: { status: "expired", at: NOW } }) },
    {
      name: "summary", card: summaryCard({
        runId: RUN, request: DEMO_REQUEST, plan: DEMO_PLAN, status: "done", finishedAt: NOW,
        steps: [
          { id: "s1", agent: "outreach", status: "done", output: "Shopify is now **confirmed** at $2,000 (Gold). Thank-you email sent to Priya with the logo spec request." },
          { id: "s2", agent: "calendar", status: "done", output: "Booked **Shopify kickoff** Mon Nov 9, 9:00–9:30 AM on Google Meet. Invited priya@shopify.com." },
          { id: "s3", agent: "finance", status: "done", output: "Recorded $2,000 sponsorship. Prizes: $0 spent of $3,000 allocated." },
          { id: "s4", agent: "socials", status: "skipped" },
          { id: "s5", agent: "coordination", status: "done", output: "Created task *Send Shopify booth requirements* for Sam, due Wed Nov 11." },
        ],
      }),
    },
    {
      name: "summary-stopped", card: summaryCard({
        runId: RUN, request: DEMO_REQUEST, plan: DEMO_PLAN, status: "cancelled", finishedAt: NOW, stoppedBy: "Fayez",
        steps: [
          { id: "s1", agent: "outreach", status: "done", output: "Shopify is now **confirmed** at $2,000 (Gold). Thank-you email sent to Priya." },
          { id: "s2", agent: "calendar", status: "cancelled" },
          { id: "s3", agent: "finance", status: "cancelled", output: "" },
          { id: "s4", agent: "socials", status: "skipped" },
          { id: "s5", agent: "coordination", status: "skipped" },
        ],
        sideEffects: [
          { agent: "outreach", summary: "Email Priya Nair (Shopify): Thank you — Gold confirmed", at: NOW - 4 * MIN },
          { agent: "outreach", summary: "Move Shopify to confirmed ($2,000, Gold)", at: NOW - 4 * MIN },
        ],
      }),
    },
    {
      name: "summary-parallel", card: summaryCard({
        runId: "0b1c2d3e-0000-4000-8000-000000000002", request: "Status check: budget left, sponsor pipeline, and anything overdue?", status: "failed", finishedAt: NOW,
        plan: { summary: "Status check across finance, outreach and coordination", steps: [
          { id: "s1", agent: "finance", instruction: "Summarize budget left per category.", dependsOn: [], needsApproval: false, enabled: true },
          { id: "s2", agent: "outreach", instruction: "List sponsors not contacted in 5 days.", dependsOn: [], needsApproval: false, enabled: true },
          { id: "s3", agent: "coordination", instruction: "List overdue tasks and owners.", dependsOn: [], needsApproval: false, enabled: true },
          { id: "s4", agent: "calendar", instruction: "List today's remaining events.", dependsOn: [], needsApproval: false, enabled: true },
        ] },
        steps: [
          { id: "s1", agent: "finance", status: "done", output: "**$5,860 left** of $11,600. Venue is at 98% and Marketing at 87%." },
          { id: "s2", agent: "outreach", status: "done", output: "Shopify (6 days) and TigerData (9 days) need a follow-up.\nNEEDS_PLAN: draft follow-ups for both" },
          { id: "s3", agent: "coordination", status: "done", output: "1 overdue: *Confirm judge list* (Alex, 5 hours late)." },
          { id: "s4", agent: "calendar", status: "failed", output: "Failed: no calendar configured" },
        ],
      }),
    },
    { name: "budget", card: budgetCard({ ...BUDGET, sheetUrl: "https://docs.google.com/spreadsheets/d/example", syncedAt: NOW - 20 * MIN }) },
    { name: "sponsors", card: sponsorsCard({ sponsors: SPONSORS, now: NOW }) },
    { name: "tasks", card: tasksCard({ tasks: TASKS, now: NOW }) },
    { name: "calendar", card: calendarCard({ events: EVENTS, dayStart: DAY_START, now: NOW, timeZone: "America/Toronto", calendarUrl: "https://calendar.google.com/calendar" }) },
    { name: "activity", card: activityCard({ agent: "finance", emoji: "💸", title: "Log $84.20 to Food (Pizza Nova)", who: "Fayez", link: { url: "https://docs.google.com/spreadsheets/d/example", label: "Open sheet" } }) },
  ];
}

export const FIXTURE_TIME = { NOW, MIN, HOUR, DAY };
