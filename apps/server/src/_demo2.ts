import "./env.js";
import { and, eq, gt, notInArray } from "drizzle-orm";
import { db, inngest, loadOrgByGuild, schema } from "@tether/core";

const CHANNEL = "1568699100117999762";
const org = (await loadOrgByGuild(process.env.DISCORD_DEV_GUILD_ID!))!;
const d = db();
const sponsorsBefore = await d.select().from(schema.sponsors).where(eq(schema.sponsors.orgId, org.id));
const taskIds = (await d.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.orgId, org.id))).map((t) => t.id);
const expenseIds = (await d.select({ id: schema.expenses.id }).from(schema.expenses).where(eq(schema.expenses.orgId, org.id))).map((t) => t.id);
const t0 = new Date();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await inngest.send({ name: "tether/request.received", data: {
  orgId: org.id, trigger: "mention", mode: "auto",
  text: "Shopify confirmed $2k! Kick off onboarding: thank Priya by email, book a kickoff call with her Monday morning, check what's left in the Prizes budget, and make Sam a task to send our booth requirements by Wednesday.",
  source: { channelId: CHANNEL }, actorDiscordId: process.env.SEED_OWNER_DISCORD_ID, actorName: "Fayez (demo)",
} });
console.log("request sent");

let runId: string | undefined, decided = false;
const rejected = new Set<string>();
for (let i = 0; i < 180; i++) {
  await sleep(3000);
  const [run] = await d.select().from(schema.runs).where(and(eq(schema.runs.orgId, org.id), gt(schema.runs.createdAt, t0))).limit(1);
  if (!run) continue;
  if (!runId) { runId = run.id; console.log("run", run.id); }
  if (!decided && run.plan && run.source.planMessageId) {
    console.log("plan:", run.plan.summary, run.plan.steps.map((s) => `${s.id}:${s.agent}${s.needsApproval ? "🔒" : ""}`).join(" "));
    await sleep(4000);
    await inngest.send({ name: "tether/plan.decided", data: { runId: run.id, approved: true, plan: run.plan, deciderDiscordId: process.env.SEED_OWNER_DISCORD_ID } });
    decided = true; console.log("plan approved");
  }
  if (!decided && run.status === "approved") decided = true; // single-step plans skip the card
  const pending = await d.select().from(schema.actions).where(and(eq(schema.actions.runId, run.id), eq(schema.actions.status, "pending")));
  for (const a of pending) {
    if (rejected.has(a.id) || !a.messageRef) continue;
    await sleep(5000);
    console.log("rejecting", a.tool, a.summary);
    await inngest.send({ name: "tether/action.decided", data: { actionId: a.id, runId: run.id, approved: false, note: "demo run: not sending for real", deciderDiscordId: process.env.SEED_OWNER_DISCORD_ID, deciderName: "Fayez (demo)" } });
    rejected.add(a.id);
  }
  if (["done", "failed", "cancelled"].includes(run.status)) { console.log("run finished:", run.status); break; }
}

// Put the shared demo data back the way it was.
for (const s of sponsorsBefore) {
  await d.update(schema.sponsors).set({ stage: s.stage, amount: s.amount, tier: s.tier, notes: s.notes, deliverables: s.deliverables, lastContactAt: s.lastContactAt }).where(eq(schema.sponsors.id, s.id));
}
const newTasks = await d.delete(schema.tasks).where(and(eq(schema.tasks.orgId, org.id), taskIds.length ? notInArray(schema.tasks.id, taskIds) : undefined)).returning();
const newExpenses = await d.delete(schema.expenses).where(and(eq(schema.expenses.orgId, org.id), expenseIds.length ? notInArray(schema.expenses.id, expenseIds) : undefined)).returning();
console.log(`restored ${sponsorsBefore.length} sponsors; removed ${newTasks.length} tasks, ${newExpenses.length} expenses`);
const acts = runId ? await d.select().from(schema.actions).where(eq(schema.actions.runId, runId)) : [];
console.log("actions:", acts.map((a) => `${a.tool}=${a.status}`).join(", "));
process.exit(0);
