import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { orgs, users, budgetLines, expenses, sponsors, tasks, brandKits, policies, documents } from "./schema.js";
import { embed } from "../runtime/gemini.js";

const guildId = process.env.DISCORD_DEV_GUILD_ID;
if (!guildId) throw new Error("DISCORD_DEV_GUILD_ID required to seed an org");

const d = db();
const existing = await d.select().from(orgs).where(eq(orgs.guildId, guildId));
const [org] = existing.length
  ? existing
  : await d.insert(orgs).values({ guildId, name: process.env.SEED_ORG_NAME ?? "HackTrent 2026", channels: {}, channelAgents: {} }).returning();
console.log("org", org!.id);

await d.delete(budgetLines).where(eq(budgetLines.orgId, org!.id));
await d.insert(budgetLines).values([
  { orgId: org!.id, category: "Food", allocated: "4000.00" },
  { orgId: org!.id, category: "Venue", allocated: "2500.00" },
  { orgId: org!.id, category: "Swag", allocated: "1500.00" },
  { orgId: org!.id, category: "Prizes", allocated: "3000.00" },
  { orgId: org!.id, category: "Marketing", allocated: "600.00" },
]);
await d.delete(expenses).where(eq(expenses.orgId, org!.id));
await d.insert(expenses).values([
  { orgId: org!.id, category: "Food", amount: "1850.00", vendor: "Pizza Nova", description: "Friday dinner", date: "2026-11-06" },
  { orgId: org!.id, category: "Swag", amount: "920.00", vendor: "Stickermule", description: "Stickers + lanyards", date: "2026-11-01" },
  { orgId: org!.id, category: "Marketing", amount: "140.00", vendor: "Meta Ads", description: "Launch promo", date: "2026-10-20" },
]);

await d.delete(sponsors).where(eq(sponsors.orgId, org!.id));
await d.insert(sponsors).values([
  { orgId: org!.id, name: "Shopify", contactName: "Priya N.", contactEmail: "priya@example.com", stage: "negotiating", amount: "2000.00", tier: "Gold", lastContactAt: new Date(Date.now() - 6 * 86400_000), deliverables: [] },
  { orgId: org!.id, name: "Vultr", contactName: "Sam R.", contactEmail: "sam@example.com", stage: "confirmed", amount: "1500.00", tier: "Silver", lastContactAt: new Date(Date.now() - 2 * 86400_000), deliverables: [{ title: "Logo on website", done: true }, { title: "Social mention", done: false }, { title: "Booth table", done: false }] },
  { orgId: org!.id, name: "TigerData", contactName: "Ana L.", contactEmail: "ana@example.com", stage: "contacted", amount: null, tier: null, lastContactAt: new Date(Date.now() - 9 * 86400_000), deliverables: [] },
  { orgId: org!.id, name: "Local Bakery", contactName: "Jo", contactEmail: "jo@example.com", stage: "lead", amount: null, tier: null, lastContactAt: null, deliverables: [] },
]);

await d.delete(tasks).where(eq(tasks.orgId, org!.id));
await d.insert(tasks).values([
  { orgId: org!.id, title: "Confirm judge list", ownerName: "Alex", dueAt: new Date(Date.now() - 5 * 3600_000), status: "in_progress" },
  { orgId: org!.id, title: "Print name badges", ownerName: "Sam", dueAt: new Date(Date.now() + 20 * 3600_000), status: "todo" },
  { orgId: org!.id, title: "Book A/V for closing ceremony", ownerName: "Jordan", dueAt: new Date(Date.now() + 30 * 3600_000), status: "todo" },
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

if (process.env.SEED_LEAD_DISCORD_ID) {
  await d.insert(users).values({ orgId: org!.id, discordId: process.env.SEED_LEAD_DISCORD_ID, name: "Lead", roles: ["lead"] }).onConflictDoNothing();
}
console.log("seeded");
process.exit(0);
