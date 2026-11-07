import Link from "next/link";
import { notFound } from "next/navigation";
import { agents } from "@tether/core";
import { runDetail } from "@/lib/data";
import { AgentName, Card, StatusPill, rel } from "@/components/ui";
import { PlanGraph } from "@/components/plan-graph";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await runDetail(id);
  if (!d) notFound();
  const colors = Object.fromEntries(Object.values(agents()).map((a) => [a.name, a.color]));
  const stepStatus = Object.fromEntries(d.steps.map((s) => [s.stepKey, s.status]));
  return (
    <div className="space-y-6">
      <Link href="/runs" className="label hover:text-[var(--ink)]">Runs /</Link>
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="font-display text-2xl font-semibold">{d.run.request}</h1>
          <p className="label mt-2">{d.run.trigger} · {rel(d.run.createdAt)} · {d.run.planHistory.length > 1 ? `plan edited ${d.run.planHistory.length - 1}×` : "plan as proposed"}</p>
        </div>
        <StatusPill status={d.run.status} />
      </div>
      {d.run.plan && <Card title="Plan"><PlanGraph plan={d.run.plan} stepStatus={stepStatus} colors={colors} /></Card>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Steps">
          <div className="divide-y rule -my-3">
            {d.steps.map((s) => (
              <div key={s.id} className="py-3">
                <div className="flex justify-between items-center text-sm"><AgentName name={s.agent} color={colors[s.agent]} /><StatusPill status={s.status} /></div>
                <div className="muted text-sm mt-1">{s.instruction}</div>
                {s.output && <pre className="code-block mt-2 whitespace-pre-wrap">{s.output}</pre>}
              </div>
            ))}
            {!d.steps.length && <p className="muted text-sm py-3">No steps have run yet.</p>}
          </div>
        </Card>
        <Card title="Actions">
          <ul className="text-sm divide-y rule -my-2">
            {d.actions.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2">
                <span>{a.summary}<span className="muted"> · <span className="font-mono text-xs">{a.tool}</span>{a.approverDiscordId ? ` · by ${a.approverDiscordId}` : ""}</span></span>
                <StatusPill status={a.status} />
              </li>
            ))}
            {!d.actions.length && <li className="muted py-2">No gated actions.</li>}
          </ul>
        </Card>
      </div>
      <Card title="Trace">
        <ul className="text-xs font-mono space-y-1">
          {d.events.map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className="num muted shrink-0 w-24">{new Date(e.time).toLocaleTimeString()}</span>
              <span className="shrink-0 w-28 truncate">{e.agent ?? "system"}</span>
              <span className="shrink-0">{e.kind}</span>
              <span className="muted truncate">{JSON.stringify(e.data)}</span>
            </li>
          ))}
          {!d.events.length && <li className="muted">No events recorded.</li>}
        </ul>
      </Card>
    </div>
  );
}
