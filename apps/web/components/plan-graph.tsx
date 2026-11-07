import type { Plan } from "@tether/core";
import { AgentName, StatusPill } from "./ui";

function levelsOf(plan: Plan) {
  const enabled = plan.steps.filter((s) => s.enabled);
  const ids = new Set(enabled.map((s) => s.id));
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const s = enabled.find((x) => x.id === id);
    const v = s ? Math.max(0, ...s.dependsOn.filter((x) => ids.has(x)).map((x) => d(x) + 1)) : 0;
    depth.set(id, v);
    return v;
  };
  const out: typeof enabled[] = [];
  for (const s of enabled) (out[d(s.id)] ??= []).push(s);
  return out;
}

export function PlanGraph({ plan, stepStatus, colors }: { plan: Plan; stepStatus: Record<string, string>; colors: Record<string, string> }) {
  const lv = levelsOf(plan);
  return (
    <div className="flex gap-6 overflow-x-auto py-1">
      {lv.map((level, i) => (
        <div key={i} className="flex flex-col gap-3 min-w-60">
          <div className="label">Level {i + 1}{level.length > 1 ? " · parallel" : ""}</div>
          {level.map((s) => (
            <div key={s.id} className="border rule p-3 text-sm" style={{ background: "var(--paper)", borderRadius: "var(--radius)" }}>
              <div className="flex justify-between items-center gap-3">
                <AgentName name={s.agent} color={colors[s.agent]} />
                <StatusPill status={stepStatus[s.id] ?? "pending"} />
              </div>
              <div className="muted mt-2">{s.instruction}</div>
              {s.dependsOn.length > 0 && <div className="label mt-2">after {s.dependsOn.join(", ")}</div>}
            </div>
          ))}
        </div>
      ))}
      {plan.steps.some((s) => !s.enabled) && (
        <div className="min-w-60">
          <div className="label">Removed by organizer</div>
          {plan.steps.filter((s) => !s.enabled).map((s) => <div key={s.id} className="muted text-sm line-through mt-2">{s.agent}: {s.instruction}</div>)}
        </div>
      )}
    </div>
  );
}
