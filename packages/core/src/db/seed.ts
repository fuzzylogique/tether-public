import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { and, eq } from "drizzle-orm";
import { db } from "./client.js";
import { orgs, users, budgetLines, expenses, income, sponsors, tasks, brandKits, policies, documents } from "./schema.js";
import { embed } from "../runtime/gemini.js";

const guildId = process.env.DISCORD_DEV_GUILD_ID;
if (!guildId) throw new Error("DISCORD_DEV_GUILD_ID required to seed an org");

// Stage-readiness knobs (all optional; see .env.example and docs/ONBOARDING.md).
const ownerDiscordId = process.env.SEED_OWNER_DISCORD_ID || null;     // task owners -> nudge DMs go somewhere real
const leadDiscordId = process.env.SEED_LEAD_DISCORD_ID || null;       // who escalations mention
const sponsorEmail = process.env.SEED_SPONSOR_EMAIL || null;          // Shopify contact -> a real inbox for the Gmail watcher
const channelPatch: Record<string, string> = {};
if (process.env.SEED_OPS_CHANNEL_ID) channelPatch["ops"] = process.env.SEED_OPS_CHANNEL_ID;
if (process.env.SEED_SPONSORSHIP_CHANNEL_ID) channelPatch["sponsorship"] = process.env.SEED_SPONSORSHIP_CHANNEL_ID;

const d = db();
const existing = await d.select().from(orgs).where(eq(orgs.guildId, guildId));
let org = existing[0];
if (!org) {
  [org] = await d.insert(orgs).values({ guildId, name: process.env.SEED_ORG_NAME ?? "HackTrent 2026", channels: channelPatch, channelAgents: {} }).returning();
} else if (Object.keys(channelPatch).length) {
  // Merge, never replace: `/tether setup` may have bound other channels already.
  [org] = await d.update(orgs).set({ channels: { ...org.channels, ...channelPatch } }).where(eq(orgs.id, org.id)).returning();
}
console.log("org", org!.id, "channels", JSON.stringify(org!.channels));
if (!org!.channels["ops"]) console.warn("warn: org has no ops channel; monitor-tasks will skip it (set SEED_OPS_CHANNEL_ID or run /tether setup)");
if (!ownerDiscordId) console.warn("warn: SEED_OWNER_DISCORD_ID unset; the overdue task has no Discord owner and monitor-tasks will skip it");
if (!sponsorEmail) console.warn("warn: SEED_SPONSOR_EMAIL unset; sponsor contacts are example.com addresses and the Gmail watcher has nothing real to match");

await d.delete(budgetLines).where(eq(budgetLines.orgId, org!.id));
await d.insert(budgetLines).values([
  { orgId: org!.id, category: "Food", allocated: "4000.00" },
  { orgId: org!.id, category: "Venue", allocated: "2500.00" },
  { orgId: org!.id, category: "Swag", allocated: "1500.00" },
  { orgId: org!.id, category: "Prizes", allocated: "3000.00" },
  { orgId: org!.id, category: "Marketing", allocated: "600.00" },
]);
await d.delete(expenses).where(eq(expenses.orgId, org!.id));
// amount is the total paid (HST included); tax is the 13% Ontario HST line. Sam fronted the swag order.
await d.insert(expenses).values([
  { orgId: org!.id, category: "Food", amount: "1850.00", tax: "212.83", vendor: "Pizza Nova", description: "Friday dinner", date: "2026-11-06" },
  { orgId: org!.id, category: "Swag", amount: "920.00", tax: "105.84", vendor: "Stickermule", description: "Stickers + lanyards", date: "2026-11-01", paidBy: "Sam", reimbursement: "pending" },
  { orgId: org!.id, category: "Marketing", amount: "140.00", tax: "16.11", vendor: "Meta Ads", description: "Launch promo", date: "2026-10-20" },
]);

// income.sponsor_id references sponsors, so income has to go first.
await d.delete(income).where(eq(income.orgId, org!.id));
await d.delete(sponsors).where(eq(sponsors.orgId, org!.id));
const seededSponsors = await d.insert(sponsors).values([
  { orgId: org!.id, name: "Shopify", contactName: "Priya N.", contactEmail: sponsorEmail ?? "priya@example.com", stage: "negotiating", amount: "2000.00", tier: "Gold", lastContactAt: new Date(Date.now() - 6 * 86400_000), deliverables: [] },
  { orgId: org!.id, name: "Vultr", contactName: "Sam R.", contactEmail: "sam@example.com", stage: "confirmed", amount: "1500.00", tier: "Silver", lastContactAt: new Date(Date.now() - 2 * 86400_000), deliverables: [{ title: "Logo on website", done: true }, { title: "Social mention", done: false }, { title: "Booth table", done: false }] },
  { orgId: org!.id, name: "TigerData", contactName: "Ana L.", contactEmail: "ana@example.com", stage: "contacted", amount: null, tier: null, lastContactAt: new Date(Date.now() - 9 * 86400_000), deliverables: [] },
  { orgId: org!.id, name: "Local Bakery", contactName: "Jo", contactEmail: "jo@example.com", stage: "lead", amount: null, tier: null, lastContactAt: null, deliverables: [] },
]).returning();

// Money in so far: the confirmed sponsor has paid, plus the student union grant. Shopify is still negotiating, so nothing is logged for them.
await d.insert(income).values([
  { orgId: org!.id, source: "Trent Student Union grant", amount: "2500.00", status: "received", date: "2026-10-15", notes: "Annual club allocation" },
  { orgId: org!.id, source: "Vultr sponsorship (Silver)", sponsorId: seededSponsors.find((x) => x.name === "Vultr")?.id, amount: "1500.00", status: "received", date: "2026-10-28" },
]);

await d.delete(tasks).where(eq(tasks.orgId, org!.id));
await d.insert(tasks).values([
  // Overdue on purpose: this is the Demo 3 task. With an owner id the cron nudges, then escalates
  // after ESCALATE_AFTER_NUDGES nudges spaced NUDGE_INTERVAL_MIN apart.
  { orgId: org!.id, title: "Confirm judge list", ownerDiscordId, ownerName: "Alex", dueAt: new Date(Date.now() - 5 * 3600_000), status: "in_progress" },
  { orgId: org!.id, title: "Print name badges", ownerDiscordId, ownerName: "Sam", dueAt: new Date(Date.now() + 20 * 3600_000), status: "todo" },
  { orgId: org!.id, title: "Book A/V for closing ceremony", ownerDiscordId, ownerName: "Jordan", dueAt: new Date(Date.now() + 30 * 3600_000), status: "todo" },
]);

await d.insert(brandKits).values({ orgId: org!.id }).onConflictDoNothing();

await d.delete(policies).where(eq(policies.orgId, org!.id));
await d.insert(policies).values([
  { orgId: org!.id, tool: "log_expense", condition: { field: "amount", op: "lt", value: 50 }, decision: "run", priority: 10 },
  { orgId: org!.id, tool: "nudge_owner", condition: {}, decision: "run", priority: 10 },
  { orgId: org!.id, tool: "escalate", condition: {}, decision: "run", priority: 10 },
  { orgId: org!.id, tool: "escalate_to_organizer", condition: {}, decision: "run", priority: 10 },
]);

const faqs = [
  { kind: "faq", title: "Team size", content: "Teams can have 1 to 4 members. You can form teams in the #team-formation channel." },
  { kind: "schedule", title: "Submission deadline", content: "Projects must be submitted on Devpost by 11:00 AM Sunday November 8, 2026. Judging starts at 11:30 AM." },
  { kind: "rules", title: "Code of conduct", content: "Be respectful. Harassment of any kind is not tolerated. Report issues to any organizer or email organizers@hacktrent.ca." },
  { kind: "faq", title: "Food", content: "Meals are provided Friday dinner through Sunday lunch. Dietary restrictions from your registration form are accommodated at the labeled tables." },
];
await d.delete(documents).where(eq(documents.orgId, org!.id));
for (const f of faqs) {
  let embedding: number[] | null = null;
  if (process.env.GEMINI_API_KEY) { try { embedding = await embed(f.content); } catch { embedding = null; } }
  await d.insert(documents).values({ orgId: org!.id, ...f, embedding });
}

// Always make sure a lead exists when SEED_LEAD_DISCORD_ID is set. `users` has no unique
// constraint on discord_id, so look it up by hand instead of relying on onConflictDoNothing.
if (leadDiscordId) {
  const [lead] = await d.select().from(users).where(and(eq(users.orgId, org!.id), eq(users.discordId, leadDiscordId)));
  if (!lead) await d.insert(users).values({ orgId: org!.id, discordId: leadDiscordId, name: "Lead", roles: ["lead"] });
  else if (!lead.roles.includes("lead")) await d.update(users).set({ roles: [...lead.roles, "lead"] }).where(eq(users.id, lead.id));
} else {
  console.warn("warn: SEED_LEAD_DISCORD_ID unset; no lead user seeded, lead-gated approvals have nobody to approve them");
}
console.log("seeded");
process.exit(0);
