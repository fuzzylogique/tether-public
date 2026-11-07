import { STATUS_COLORS, TETHER, statusEmoji } from "../tokens.js";
import { quote, stepSquares, shortId, text, truncate, ts, type Card } from "../card.js";
import { agentMeta } from "./agent.js";

export type StepState = {
  id: string;
  agent: string;
  instruction: string;
  status: "pending" | "running" | "awaiting_approval" | "done" | "failed" | "skipped";
  finishedAt?: string | number;
};

const TITLES: Record<string, string> = {
  running: "Working…", awaiting_approval: "Waiting for approval", done: "Done", failed: "Failed", cancelled: "Cancelled",
};

/**
 * Live status card (§8.2). Text-only on purpose: it is edited in place on every level change,
 * and an edit that references `attachment://` would drop the file.
 */
export function statusCard(input: {
  runId: string; request: string; status: string; steps: StepState[]; note?: string; dashboardUrl?: string;
}): Card {
  const { steps } = input;
  const finished = steps.filter((s) => s.status === "done" || s.status === "failed").length;
  const lines = steps.map((s) => {
    const a = agentMeta(s.agent);
    const when = s.finishedAt && (s.status === "done" || s.status === "failed") ? ` · ${ts(s.finishedAt)}` : "";
    const waiting = s.status === "awaiting_approval" ? " · _awaiting approval_" : "";
    return `${statusEmoji(s.status)} ${a.emoji} **${a.label}** — ${truncate(s.instruction, 140)}${waiting}${when}`;
  });
  return {
    accent: STATUS_COLORS[input.status] ?? TETHER,
    title: TITLES[input.status] ?? input.status,
    blocks: [
      text(quote(input.request, 200)),
      ...(steps.length ? [text(`${stepSquares(steps.map((s) => s.status))}  **${finished}/${steps.length}** steps finished`), text(lines.join("\n"))] : []),
      ...(input.note ? [text(input.note)] : []),
    ],
    actions: input.dashboardUrl ? [[{ kind: "link", url: input.dashboardUrl, label: "Open run" }]] : undefined,
    footer: `run ${shortId(input.runId)}`,
  };
}
