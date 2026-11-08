import { STATUS_COLORS, TETHER, statusEmoji } from "../tokens.js";
import { quote, stepSquares, shortId, text, truncate, ts, type Action, type Card } from "../card.js";
import { agentMeta, toolEmoji } from "./agent.js";

export type StepState = {
  id: string;
  agent: string;
  instruction: string;
  status: "pending" | "running" | "awaiting_approval" | "done" | "failed" | "skipped" | "cancelled";
  finishedAt?: string | number;
  /** Last tool calls of a running step, oldest first (docs/GUIDE.md §5.1). */
  recent?: ToolLogLine[];
};

/** One `tool_call` event as the card shows it. */
export type ToolLogLine = { tool: string; summary?: string; at: string | number; error?: string };

export const TOOL_LOG_LINES = 3;

/** The grey lines under a running step: what ran, then "thinking…" because the model turn is in flight. */
export function toolLog(step: Pick<StepState, "agent" | "status" | "recent">): string[] {
  if (step.status !== "running") return [];
  const lines = (step.recent ?? []).slice(-TOOL_LOG_LINES).map((l) => {
    const what = l.error ? `⚠️ ${l.tool} · ${truncate(l.error, 60)}` : `${toolEmoji(l.tool, step.agent)} ${l.tool}${l.summary ? ` · ${l.summary}` : ""}`;
    return `-# ${what} · ${ts(l.at)}`;
  });
  return [...lines, "-# :tether_running: thinking…"];
}

const TITLES: Record<string, string> = {
  running: "Working…", awaiting_approval: "Waiting for approval", done: "Done", failed: "Failed", cancelled: "Cancelled", expired: "Expired",
};

/** An approval card still open for a step: shown under its line, with a Jump link when the message is known. */
export type PendingApproval = { stepKey: string; summary: string; channelId?: string; url?: string };

const STEP_NOTE: Partial<Record<StepState["status"], string>> = {
  awaiting_approval: " · _awaiting approval_", cancelled: " · _stopped_", skipped: " · _not started_",
};

/** Stop is offered while the run can still do something (docs/CARDS.md §7). */
export const isLiveRun = (status: string) => status === "running" || status === "awaiting_approval" || status === "approved";

/**
 * Live status card (§8.2), the run's control surface. Text-only on purpose: it is edited in place
 * on every transition, and an edit that references `attachment://` would drop the file.
 */
export function statusCard(input: {
  runId: string; request: string; status: string; steps: StepState[]; note?: string; dashboardUrl?: string;
  /** Mention of whoever pressed Stop; turns a `cancelled` run with steps into "Stopped". */
  stoppedBy?: string;
  /** Open approval cards, grouped under their steps (docs/CARDS.md §10). */
  pending?: PendingApproval[];
}): Card {
  const { steps } = input;
  const finished = steps.filter((s) => s.status === "done" || s.status === "failed").length;
  const lines = steps.map((s) => {
    const a = agentMeta(s.agent);
    const when = s.finishedAt && (s.status === "done" || s.status === "failed") ? ` · ${ts(s.finishedAt)}` : "";
    const open = (input.pending ?? []).filter((p) => p.stepKey === s.id);
    const waiting = open.length ? `\n-# waiting on: ${open.slice(0, 3).map((p) => `${truncate(p.summary, 60)}${p.channelId ? ` (<#${p.channelId}>)` : ""}`).join(" · ")}${open.length > 3 ? ` · +${open.length - 3} more` : ""}` : "";
    const log = toolLog(s).map((l) => `\n${l}`).join("");
    return `${statusEmoji(s.status)} ${a.emoji} **${a.label}** — ${truncate(s.instruction, 140)}${STEP_NOTE[s.status] ?? ""}${when}${waiting}${log}`;
  });
  const jumps: Action[] = (input.pending ?? []).filter((p) => p.url).slice(0, 5)
    .map((p) => ({ kind: "link", url: p.url!, label: truncate(`Jump: ${p.summary}`, 40) }));
  const stopped = input.status === "cancelled" && (input.stoppedBy || steps.length);
  const note = input.note ?? (stopped ? `⏹ **Stopped**${input.stoppedBy ? ` by ${input.stoppedBy}` : ""} · tool calls already in flight finished; nothing new started.` : undefined);
  const row: Action[] = [
    ...(isLiveRun(input.status) ? [{ kind: "button", id: `run:stop:${input.runId}`, label: "Stop", style: "danger" } as Action] : []),
    ...(input.dashboardUrl ? [{ kind: "link", url: input.dashboardUrl, label: "Open run" } as Action] : []),
  ];
  return {
    accent: STATUS_COLORS[input.status] ?? TETHER,
    title: stopped ? "Stopped" : TITLES[input.status] ?? input.status,
    blocks: [
      text(quote(input.request, 200)),
      ...(steps.length ? [text(`${stepSquares(steps.map((s) => s.status))}  **${finished}/${steps.length}** steps finished`), text(lines.join("\n"))] : []),
      ...(note ? [text(note)] : []),
    ],
    actions: [row, jumps].filter((r) => r.length),
    footer: `run ${shortId(input.runId)}`,
  };
}
