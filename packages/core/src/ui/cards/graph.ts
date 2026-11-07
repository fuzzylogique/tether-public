import type { Plan } from "../../db/schema.js";
import type { StepGraphSpec } from "../charts/types.js";
import { agentMeta } from "./agent.js";

type NodeStatus = NonNullable<StepGraphSpec["nodes"][number]["status"]>;

/** Dependency depth of every step (disabled steps keep their place so the card does not reflow). */
function depths(plan: Plan) {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const memo = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = byId.get(id)?.dependsOn.filter((d) => byId.has(d)) ?? [];
    const d = deps.length ? 1 + Math.max(...deps.map((x) => depth(x, seen))) : 0;
    memo.set(id, d);
    return d;
  };
  return new Map(plan.steps.map((s) => [s.id, depth(s.id)]));
}

/** Step graph spec for a plan; pass `status` per step id to colour the summary by outcome. */
export function planGraphSpec(plan: Plan, status?: Record<string, NodeStatus>): StepGraphSpec {
  const d = depths(plan);
  return {
    type: "stepGraph",
    nodes: plan.steps.map((s, i) => {
      const a = agentMeta(s.agent);
      return {
        id: s.id, label: `${i + 1}. ${a.label}`, color: a.color, level: d.get(s.id) ?? 0,
        locked: s.needsApproval, disabled: !s.enabled, status: s.enabled ? status?.[s.id] : "skipped",
      };
    }),
    edges: plan.steps.flatMap((s) => s.dependsOn.filter((dep) => plan.steps.some((x) => x.id === dep)).map((dep) => [dep, s.id] as [string, string])),
  };
}
