import { eq } from "drizzle-orm";
import type { Content, Part } from "@google/genai";
import { inngest } from "../client.js";
import { db } from "../../db/client.js";
import { steps, actions, agentSessions, events } from "../../db/schema.js";
import { agents } from "../../agents/registry.js";
import { runAgentLoop, settleAction, userMessage, type StepRunner } from "../../runtime/loop.js";
import { buildToolCtx, loadActor } from "../../runtime/context.js";
import type { Notifier } from "../../tools/types.js";
import { runs } from "../../db/schema.js";
import { actionRef, approvalCardFor, approvalContext, settledDecision } from "../../runtime/cards.js";
import { approvalCard } from "../../ui/cards/approval.js";
import { shortId } from "../../ui/card.js";

const cache = new WeakMap<Notifier, ReturnType<typeof build>>();

function build(notifier: Notifier) {
  return inngest.createFunction(
    { id: "run-agent-step", retries: 1 },
    { event: "tether/step.requested" },
    async ({ event, step }) => {
      const d = event.data;
      const agent = agents()[d.agent];
      if (!agent) throw new Error(`unknown agent ${d.agent}`);

      const run = await step.run("load-run", async () => {
        const [r] = await db().select().from(runs).where(eq(runs.id, d.runId));
        if (!r) throw new Error("run missing");
        return r;
      });
      const actor = await step.run("load-actor", () => loadActor(run.orgId, d.actorDiscordId, d.actorName));
      const ctx = await buildToolCtx({ orgId: run.orgId, actor, runId: d.runId, stepId: d.stepId, agent: d.agent, notify: notifier, attachments: d.attachments });
      const runRef = { id: run.id, orgId: run.orgId, source: run.source, request: run.request };

      // Tier 1 sessions carry prior messages from the thread.
      const prior: Content[] = d.sessionThreadId
        ? await step.run("load-session", async () => {
            const [s] = await db().select().from(agentSessions).where(eq(agentSessions.threadId, d.sessionThreadId!));
            return (s?.messages ?? []) as Content[];
          })
        : [];

      const depText = Object.entries(d.dependencyOutputs).map(([k, v]) => `Result of ${k}:\n${v}`).join("\n\n");
      let messages: Content[] = [...prior, userMessage(`${depText ? `${depText}\n\n` : ""}${d.instruction}`)];
      await step.run("mark-running", () => db().update(steps).set({ status: "running", updatedAt: new Date() }).where(eq(steps.id, d.stepId)));

      for (let resume = 0; resume < 4; resume++) {
        const prefixed = ((id: string, fn: () => Promise<unknown>) => step.run(`r${resume}:${id}`, fn)) as unknown as StepRunner;
        const outcome = await runAgentLoop({ agent, messages, ctx, step: prefixed });
        messages = outcome.messages;

        if (outcome.kind !== "await_approval") {
          const status = outcome.kind === "done" ? "done" : "failed";
          const output = outcome.kind === "done" ? outcome.output : `Failed: ${outcome.error}`;
          const { finishedAt } = await step.run("finish-step", async () => {
            await db().update(steps).set({ status, output, messages, updatedAt: new Date() }).where(eq(steps.id, d.stepId));
            if (d.sessionThreadId) {
              await db().insert(agentSessions).values({ threadId: d.sessionThreadId, orgId: run.orgId, agent: d.agent, messages })
                .onConflictDoUpdate({ target: agentSessions.threadId, set: { messages, updatedAt: new Date() } });
            }
            return { finishedAt: new Date().toISOString() };
          });
          return { status, output, finishedAt };
        }

        // Post approval cards for every gated action in this turn.
        const cards = await step.run(`r${resume}:post-approvals`, async () => {
          const rows = await Promise.all(outcome.actionIds.map(async (id) => (await db().select().from(actions).where(eq(actions.id, id)))[0]!));
          await db().update(steps).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(steps.id, d.stepId));
          await db().update(runs).set({ status: "awaiting_approval", updatedAt: new Date() }).where(eq(runs.id, d.runId));
          const refs = await notifier.postApprovalCards({
            run: runRef,
            actions: await Promise.all(rows.map(async (a) => {
              const ref = actionRef(a);
              return { ...ref, card: approvalCard(ref, { context: await approvalContext(ctx.org, ref) }) };
            })),
          });
          for (const ref of refs) await db().update(actions).set({ messageRef: { channelId: ref.channelId, messageId: ref.messageId } }).where(eq(actions.id, ref.id));
          return refs;
        });

        const parts: Part[] = [];
        for (const actionId of outcome.actionIds) {
          let decided = await step.waitForEvent(`r${resume}:wait:${actionId}`, {
            event: "tether/action.decided", if: `async.data.actionId == "${actionId}"`, timeout: "2h",
          });
          if (!decided) {
            await step.run(`r${resume}:remind:${actionId}`, async () => {
              const ops = ctx.org.channels["ops"];
              if (ops) {
                const ref = cards.find((c) => c.id === actionId);
                const link = ref ? `https://discord.com/channels/${ctx.org.guildId}/${ref.channelId}/${ref.messageId}` : undefined;
                await notifier.postToChannel({
                  channelId: ops,
                  card: {
                    accent: "#EF9F27",
                    blocks: [{ kind: "section", md: [`⏰ An approval from **${agent.label}** has been waiting 2 hours`, `-# run ${shortId(d.runId)}`], button: link ? { kind: "link", url: link, label: "Jump to card" } : undefined }],
                  },
                });
              }
              await db().insert(events).values({ orgId: run.orgId, runId: d.runId, kind: "approval_reminder", agent: d.agent, data: { actionId } });
            });
            decided = await step.waitForEvent(`r${resume}:wait2:${actionId}`, {
              event: "tether/action.decided", if: `async.data.actionId == "${actionId}"`, timeout: "22h",
            });
          }
          if (!decided) {
            await step.run(`r${resume}:expire:${actionId}`, async () => {
              const [row] = await db().update(actions).set({ status: "expired", decidedAt: new Date() }).where(eq(actions.id, actionId)).returning();
              const ref = cards.find((c) => c.id === actionId);
              if (row && ref) {
                await notifier.editMessage({ channelId: ref.channelId, messageId: ref.messageId, card: await approvalCardFor(ctx.org, row, { status: "expired", at: new Date() }) })
                  .catch((e) => console.warn("approval re-render failed", e));
              }
            });
            parts.push({ functionResponse: { name: "approval", response: { status: "rejected", reason: "approval timed out" } } });
            continue;
          }
          const deciderCtx = { ...ctx, actor: await loadActor(run.orgId, decided.data.deciderDiscordId, decided.data.deciderName) };
          const settled = await settleAction({
            actionId, approved: decided.data.approved, note: decided.data.note, editedArgs: decided.data.editedArgs,
            ctx: deciderCtx, step: ((id: string, fn: () => Promise<unknown>) => step.run(`r${resume}:${id}`, fn)) as unknown as StepRunner,
          });
          parts.push(settled.part);
          // Re-render the card with the outcome (executed / failed / rejected) and drop its buttons.
          await step.run(`r${resume}:rerender:${actionId}`, async () => {
            const [row] = await db().select().from(actions).where(eq(actions.id, actionId));
            const ref = cards.find((c) => c.id === actionId);
            const decision = row && settledDecision(row, decided.data.deciderName);
            if (!row || !ref || !decision) return;
            await notifier.editMessage({ channelId: ref.channelId, messageId: ref.messageId, card: await approvalCardFor(ctx.org, row, decision) })
              .catch((e) => console.warn("approval re-render failed", e));
          });
        }
        messages.push({ role: "user", parts });
        await step.run(`r${resume}:mark-running`, () => db().update(steps).set({ status: "running", messages, updatedAt: new Date() }).where(eq(steps.id, d.stepId)));
      }
      const finishedAt = await step.run("too-many-resumes", async () => {
        await db().update(steps).set({ status: "failed", output: "too many approval rounds", updatedAt: new Date() }).where(eq(steps.id, d.stepId));
        return new Date().toISOString();
      });
      return { status: "failed" as const, output: "too many approval rounds", finishedAt };
    },
  );
}

export function runAgentStepFn(notifier: Notifier) {
  let fn = cache.get(notifier);
  if (!fn) { fn = build(notifier); cache.set(notifier, fn); }
  return fn;
}
