import { eq } from "drizzle-orm";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { events, orgs, runs } from "../../db/schema.js";
import { WORKFLOWS } from "../../workflows/registry.js";
import type { Notifier } from "../../tools/types.js";
import { runPlanFn } from "./plans.js";
import { failRunUnlessCancelled } from "../../runtime/cancel.js";

const cache = new WeakMap<Notifier, ReturnType<typeof build>>();

/**
 * Standing workflow runner. The plan is prebuilt from the template (no planner call, no plan
 * card: the org approved the workflow when it turned it on), recorded as a run with
 * trigger "workflow", and executed by run-plan exactly like an approved organizer plan.
 */
function build(notifier: Notifier) {
  return inngest.createFunction(
    { id: "run-workflow", retries: 1 },
    { event: "tether/workflow.triggered" },
    async ({ event, step }) => {
      const d = event.data;
      const wf = WORKFLOWS[d.name];
      if (!wf) throw new Error(`unknown workflow ${d.name}`);
      const parsed = wf.params.safeParse(d.params);
      if (!parsed.success) {
        await step.run("bad-params", () => db().insert(events).values({ orgId: d.orgId, kind: "workflow_skipped", data: { name: d.name, reason: "invalid params", issues: parsed.error.issues } }));
        return { skipped: "invalid params", issues: parsed.error.issues };
      }
      const params = parsed.data;

      const run = await step.run("create-run", async () => {
        const [org] = await db().select().from(orgs).where(eq(orgs.id, d.orgId));
        if (!org) throw new Error("org missing");
        const channelId = org.channels[wf.channel] ?? org.channels["ops"] ?? d.source?.channelId;
        if (!channelId) {
          await db().insert(events).values({ orgId: d.orgId, kind: "workflow_skipped", data: { name: d.name, reason: `no ${wf.channel} or ops channel configured` } });
          return null;
        }
        const plan = wf.build(params);
        const [row] = await db().insert(runs).values({
          orgId: d.orgId, trigger: "workflow", source: { channelId, threadId: d.source?.threadId }, actorDiscordId: d.actorDiscordId,
          request: `${wf.label}: ${wf.describe(params)}`, plan, planHistory: [plan], status: "approved",
        }).returning();
        await db().insert(events).values({ orgId: d.orgId, runId: row!.id, kind: "workflow_started", data: { name: d.name, params } });
        await notifier.postToChannel({
          channelId,
          card: { accent: "#6D5DF6", blocks: [{ kind: "text", md: `⚙️ **${wf.label}** · ${wf.describe(params)}\n-# standing workflow · ${plan.steps.length} steps${d.actorName ? ` · triggered by ${d.actorName}` : ""}` }] },
        });
        return row!;
      });
      if (!run) return { skipped: "no channel" };

      const result = await step.invoke("execute", { function: runPlanFn(notifier), data: { runId: run.id } })
        .catch(async (e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          const status = await step.run("mark-failed", () => failRunUnlessCancelled(run.id, error));
          return { status, error };
        });
      return { runId: run.id, ...result };
    },
  );
}

export function runWorkflowFn(notifier: Notifier) {
  let fn = cache.get(notifier);
  if (!fn) { fn = build(notifier); cache.set(notifier, fn); }
  return fn;
}
