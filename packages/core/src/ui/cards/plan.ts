import type { Plan } from "../../db/schema.js";
import { GREEN, GREY, TETHER } from "../tokens.js";
import { quote, shortId, text, truncate, ts, type Action, type Block, type Card } from "../card.js";
import { agentMeta } from "./agent.js";
import { planGraphSpec } from "./graph.js";

export type PlanDecision = { approved: boolean; by: string; at?: Date | string | number };

/** Past this many steps the per-step sections would blow the 40-component budget. */
const MAX_STEP_SECTIONS = 6;

/** Plan card (docs/DISCORD_UI.md §8.1): one section per step with a toggle, step graph, Run/Edit/Cancel. */
export function planCard(input: {
  runId: string; request: string; plan: Plan;
  requester?: { discordId?: string | null; name?: string | null }; createdAt?: Date | string | number;
  decision?: PlanDecision; dashboardUrl?: string;
}): Card {
  const { runId, plan, decision } = input;
  const open = !decision;
  const index = new Map(plan.steps.map((s, i) => [s.id, i + 1]));
  const who = input.requester?.discordId ? `<@${input.requester.discordId}>` : input.requester?.name;
  const subtitle = [who ? `requested by ${who}` : "", input.createdAt ? ts(input.createdAt) : "", `${plan.steps.filter((s) => s.enabled).length}/${plan.steps.length} steps on`].filter(Boolean).join(" · ");

  const stepLine = (s: Plan["steps"][number], i: number) => {
    const a = agentMeta(s.agent);
    const deps = s.dependsOn.length ? ` _after ${s.dependsOn.map((d) => index.get(d) ?? d).join(", ")}_` : "";
    // `**1. x**` at the start of a line parses as a list item in Discord, so the number is a code badge.
    const name = s.enabled ? `**${a.label}**` : `~~${a.label}~~`;
    const head = `\`${i + 1}\` ${a.emoji} ${name}${s.needsApproval ? " :tether_locked:" : ""}${deps}`;
    const body = s.enabled ? truncate(s.instruction, 400) : `-# skipped · ${truncate(s.instruction, 200)}`;
    return { head, body };
  };

  const blocks: Block[] = [{ kind: "text", md: quote(input.request, 300) }];
  if (decision) {
    blocks.unshift(text(`${decision.approved ? ":tether_done: **Approved**" : ":tether_failed: **Cancelled**"} by ${decision.by}${decision.at ? ` · ${ts(decision.at)}` : ""}`));
  }
  if (plan.steps.length <= MAX_STEP_SECTIONS) {
    for (const [i, s] of plan.steps.entries()) {
      const { head, body } = stepLine(s, i);
      const toggle: Action | undefined = open
        ? { kind: "button", id: `plan:toggle:${runId}:${s.id}`, label: s.enabled ? "On" : "Off", style: s.enabled ? "success" : "secondary" }
        : undefined;
      blocks.push({ kind: "section", md: [head, body], button: toggle });
    }
  } else {
    blocks.push(text(plan.steps.map((s, i) => { const l = stepLine(s, i); return `${l.head}\n${l.body}`; }).join("\n")));
  }
  blocks.push({ kind: "chart", name: `plan-${shortId(runId)}`, spec: planGraphSpec(plan), alt: `Step graph: ${plan.steps.map((s, i) => `${i + 1} ${agentMeta(s.agent).label}`).join(", ")}` });

  const actions: Action[][] = [];
  if (open) {
    actions.push([{
      kind: "select", id: `plan:select:${runId}`, placeholder: "Choose which steps run", min: 0, max: plan.steps.length,
      options: plan.steps.map((s, i) => ({ label: `${i + 1}. ${agentMeta(s.agent).label}`, description: truncate(s.instruction, 100), value: s.id, default: s.enabled })),
    }]);
    actions.push([
      { kind: "button", id: `plan:run:${runId}`, label: "Run", style: "success" },
      { kind: "button", id: `plan:edit:${runId}`, label: "Edit steps", style: "secondary" },
      { kind: "button", id: `plan:cancel:${runId}`, label: "Cancel", style: "danger" },
      ...(input.dashboardUrl ? [{ kind: "link" as const, url: input.dashboardUrl, label: "Open run" }] : []),
    ]);
  } else if (input.dashboardUrl) {
    actions.push([{ kind: "link", url: input.dashboardUrl, label: "Open run" }]);
  }

  return {
    accent: decision ? (decision.approved ? GREEN : GREY) : TETHER,
    title: `Plan · ${truncate(plan.summary, 120)}`,
    subtitle,
    blocks,
    actions,
    footer: open ? `run ${shortId(runId)} · toggle steps you don't want, then Run` : `run ${shortId(runId)}`,
  };
}
