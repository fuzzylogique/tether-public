import { STATUS_COLORS, statusEmoji } from "../tokens.js";
import type { Plan } from "../../db/schema.js";
import { quote, sep, shortId, text, truncate, ts, type Block, type Card } from "../card.js";
import { agentMeta } from "./agent.js";
import { planGraphSpec } from "./graph.js";

export type SummaryStep = { id: string; agent: string; status: "done" | "failed" | "skipped" | "cancelled"; output?: string };

/** An approved action that executed before a Stop: the part of a stopped run that cannot be taken back. */
export type SideEffect = { agent: string; summary: string; at?: Date | string | number };

/** Room for model output once header, footer, request quote and separators are paid for. */
const OUTPUT_BUDGET = 3200;

const TITLE: Record<"done" | "failed" | "cancelled", string> = { done: "Done", failed: "Finished with failures", cancelled: "Stopped" };

/** Run summary (§8.4): one block per step with the agent's output, then the graph coloured by outcome. */
export function summaryCard(input: {
  runId: string; request: string; plan: Plan; status: "done" | "failed" | "cancelled"; steps: SummaryStep[];
  finishedAt?: Date | string | number; dashboardUrl?: string;
  /** Stopped runs: who pressed Stop, and what had already gone out (docs/CARDS.md §7). */
  stoppedBy?: string; sideEffects?: SideEffect[];
}): Card {
  const ran = input.steps.filter((s) => s.status !== "skipped");
  const per = Math.max(200, Math.floor(OUTPUT_BUDGET / Math.max(1, ran.length)));
  const blocks: Block[] = [text(quote(input.request, 200))];
  if (input.status === "cancelled") {
    blocks.push(text(`⏹ **Stopped**${input.stoppedBy ? ` by ${input.stoppedBy}` : ""}${input.finishedAt ? ` · ${ts(input.finishedAt)}` : ""} · tool calls already in flight finished; nothing new started.`));
  }
  for (const s of ran) {
    const a = agentMeta(s.agent);
    blocks.push(sep());
    // NEEDS_PLAN is the agents' escalation protocol (plans.ts), not something to show people.
    const output = (s.output ?? "").replace(/^\s*NEEDS_PLAN:.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    const empty = s.status === "cancelled" ? "_(stopped before finishing)_" : "_(no output)_";
    blocks.push(text(`### ${statusEmoji(s.status)} ${a.emoji} ${a.label}\n${truncate(output || empty, per)}`));
  }
  if (input.sideEffects?.length) {
    blocks.push(sep());
    const shown = input.sideEffects.slice(0, 8);
    const more = input.sideEffects.length - shown.length;
    blocks.push(text([
      "### Approved actions that already ran",
      ...shown.map((e) => `• ${agentMeta(e.agent).emoji} ${truncate(e.summary, 160)}${e.at ? ` · ${ts(e.at)}` : ""}`),
      ...(more > 0 ? [`-# +${more} more`] : []),
    ].join("\n")));
  }
  if (input.plan.steps.length > 1) {
    // The graph has no "cancelled" node style; a stopped step draws like one that never ran.
    const status = Object.fromEntries(input.steps.map((s) => [s.id, s.status === "cancelled" ? "skipped" as const : s.status]));
    blocks.push({ kind: "chart", name: `summary-${shortId(input.runId)}`, spec: planGraphSpec(input.plan, status), alt: `Outcome: ${ran.filter((s) => s.status === "done").length}/${ran.length} steps done` });
  }
  const done = ran.filter((s) => s.status === "done").length;
  return {
    accent: STATUS_COLORS[input.status],
    title: `${TITLE[input.status]} · ${truncate(input.plan.summary, 120)}`,
    subtitle: input.status === "cancelled"
      ? `${done}/${ran.length} steps finished before the stop${input.sideEffects?.length ? ` · ${input.sideEffects.length} action${input.sideEffects.length === 1 ? "" : "s"} already ran` : ""}`
      : `${done}/${ran.length} steps succeeded${input.finishedAt ? ` · ${ts(input.finishedAt)}` : ""}`,
    blocks,
    actions: input.dashboardUrl ? [[{ kind: "link", url: input.dashboardUrl, label: "Open run" }]] : undefined,
    footer: `run ${shortId(input.runId)}`,
  };
}
