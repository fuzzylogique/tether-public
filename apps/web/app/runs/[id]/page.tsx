import { notFound } from "next/navigation";
import { agents } from "@tether/core";
import { runDetail } from "@/lib/data";
import { Card, StatusPill, rel } from "@/components/ui";
import { PlanGraph } from "@/components/plan-graph";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await runDetail(id);
  if (!d) notFound();
  const colors = Object.fromEntries(Object.values(agents()).map((a) => [a.name, a.color]));
  const stepStatus = Object.fromEntries(d.steps.map((s) => [s.stepKey, s.status]));
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold">{d.run.request}</h1>
          <p className="muted text-sm">{d.run.trigger} · {rel(d.run.createdAt)} · {d.run.planHistory.length > 1 ? `plan edited ${d.run.planHistory.length - 1}×` : "plan as proposed"}</p>
        </div>
        <StatusPill status={d.run.status} />
      </div>
      {d.run.plan && <Card title="Plan"><PlanGraph plan={d.run.plan} stepStatus={stepStatus} colors={colors} /></Card>}
      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Steps">
          <div className="space-y-4">
            {d.steps.map((s) => (
              <div key={s.id}>
                <div className="flex justify-between text-sm"><span className="font-medium" style={{ color: colors[s.agent] }}>{s.agent}</span><StatusPill status={s.status} /></div>
                <div className="muted text-sm">{s.instruction}</div>
                {s.output && <pre className="text-xs mt-2 p-3 rounded-lg whitespace-pre-wrap" style={{ background: "var(--panel-2)" }}>{s.output}</pre>}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Actions">
          <ul className="space-y-2 text-sm">
            {d.actions.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>{a.summary}<span className="muted"> · {a.tool}{a.approverDiscordId ? ` · by ${a.approverDiscordId}` : ""}</span></span>
                <StatusPill status={a.status} />
              </li>
            ))}
            {!d.actions.length && <li className="muted">No gated actions.</li>}
          </ul>
        </Card>
      </div>
      <Card title="Trace">
        <ul className="text-xs font-mono space-y-1">
          {d.events.map((e, i) => <li key={i} className="flex gap-3"><span className="muted shrink-0 w-28">{new Date(e.time).toLocaleTimeString()}</span><span style={{ color: colors[e.agent ?? ""] ?? "var(--muted)" }}>{e.agent ?? "system"}</span><span>{e.kind}</span><span className="muted truncate">{JSON.stringify(e.data)}</span></li>)}
        </ul>
      </Card>
    </div>
  );
}
