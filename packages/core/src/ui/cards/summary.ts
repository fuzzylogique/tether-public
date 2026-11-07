import { STATUS_COLORS, statusEmoji } from "../tokens.js";
import type { Plan } from "../../db/schema.js";
import { quote, sep, shortId, text, truncate, ts, type Block, type Card } from "../card.js";
import { agentMeta } from "./agent.js";
import { planGraphSpec } from "./graph.js";

export type SummaryStep = { id: string; agent: string; status: "done" | "failed" | "skipped"; output?: string };

/** Room for model output once header, footer, request quote and separators are paid for. */
const OUTPUT_BUDGET = 3200;

/** Run summary (§8.4): one block per step with the agent's output, then the graph coloured by outcome. */
export function summaryCard(input: {
  runId: string; request: string; plan: Plan; status: "done" | "failed"; steps: SummaryStep[];
  finishedAt?: Date | string | number; dashboardUrl?: string;
}): Card {
  const ran = input.steps.filter((s) => s.status !== "skipped");
  const per = Math.max(200, Math.floor(OUTPUT_BUDGET / Math.max(1, ran.length)));
  const blocks: Block[] = [text(quote(input.request, 200))];
  for (const s of ran) {
    const a = agentMeta(s.agent);
    blocks.push(sep());
    blocks.push(text(`### ${statusEmoji(s.status)} ${a.emoji} ${a.label}\n${truncate((s.output ?? "").trim() || "_(no output)_", per)}`));
  }
  if (input.plan.steps.length > 1) {
    const status = Object.fromEntries(input.steps.map((s) => [s.id, s.status]));
    blocks.push({ kind: "chart", name: `summary-${shortId(input.runId)}`, spec: planGraphSpec(input.plan, status), alt: `Outcome: ${ran.filter((s) => s.status === "done").length}/${ran.length} steps done` });
  }
  const done = ran.filter((s) => s.status === "done").length;
  return {
    accent: STATUS_COLORS[input.status],
    title: `${input.status === "done" ? "Done" : "Finished with failures"} · ${truncate(input.plan.summary, 120)}`,
    subtitle: `${done}/${ran.length} steps succeeded${input.finishedAt ? ` · ${ts(input.finishedAt)}` : ""}`,
    blocks,
    actions: input.dashboardUrl ? [[{ kind: "link", url: input.dashboardUrl, label: "Open run" }]] : undefined,
    footer: `run ${shortId(input.runId)}`,
  };
}
