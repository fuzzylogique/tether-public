import Link from "next/link";
import { firstOrg, overview } from "@/lib/data";
import { Bar, Card, Stat, StatusPill, fmt, rel } from "@/components/ui";

export default async function Overview() {
  const org = await firstOrg();
  if (!org) return <p className="muted">No organization yet. Run <code>/tether setup</code> in Discord or <code>pnpm db:seed</code>.</p>;
  const o = await overview(org.id);
  const allocated = o.budget.reduce((a, b) => a + b.allocated, 0), spent = o.budget.reduce((a, b) => a + b.spent, 0);
  const confirmed = o.sponsors.filter((s) => s.stage === "confirmed").reduce((a, s) => a + Number(s.amount ?? 0), 0);
  const overdue = o.tasks.filter((t) => t.status !== "done" && t.dueAt && t.dueAt < new Date()).length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="muted text-sm">Live view of what the agents are doing and what needs you.</p>
        </div>
        <Link href="/approvals" className="pill" style={{ color: o.pending.length ? "var(--amber)" : undefined }}>{o.pending.length} awaiting approval</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Budget used" value={`${allocated ? Math.round((spent / allocated) * 100) : 0}%`} sub={`${fmt(spent)} of ${fmt(allocated)}`} />
        <Stat label="Sponsorship confirmed" value={fmt(confirmed)} sub={`${o.sponsors.filter((s) => s.stage === "confirmed").length} sponsors`} />
        <Stat label="Overdue tasks" value={String(overdue)} sub={`${o.tasks.filter((t) => t.status !== "done").length} open`} />
        <Stat label="Runs today" value={String(o.recentRuns.filter((r) => Date.now() - r.createdAt.getTime() < 86400_000).length)} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card title="Budget by category">
          <div className="space-y-3">
            {o.budget.map((b) => {
              const pct = b.allocated ? (b.spent / b.allocated) * 100 : 0;
              return (
                <div key={b.category}>
                  <div className="flex justify-between text-sm mb-1"><span>{b.category}</span><span className="muted">{fmt(b.spent)} / {fmt(b.allocated)}</span></div>
                  <Bar pct={pct} />
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Sponsor pipeline">
          <ul className="space-y-2 text-sm">
            {o.sponsors.map((s) => (
              <li key={s.id} className="flex justify-between items-center">
                <span>{s.name}<span className="muted"> · {s.tier ?? "—"}</span></span>
                <span className="flex items-center gap-3"><span className="muted">{s.amount ? fmt(Number(s.amount)) : ""}</span><StatusPill status={s.stage} /></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Recent runs" right={<Link href="/runs" className="muted text-sm">All runs</Link>}>
          <ul className="space-y-2 text-sm">
            {o.recentRuns.map((r) => (
              <li key={r.id} className="flex justify-between gap-4">
                <Link href={`/runs/${r.id}`} className="truncate hover:underline">{r.request}</Link>
                <span className="flex gap-2 items-center shrink-0"><span className="muted">{rel(r.createdAt)}</span><StatusPill status={r.status} /></span>
              </li>
            ))}
            {!o.recentRuns.length && <li className="muted">Nothing yet. Mention the bot in Discord.</li>}
          </ul>
        </Card>
        <Card title="Activity">
          <ul className="space-y-1 text-xs font-mono">
            {o.activity.map((e, i) => (
              <li key={i} className="flex gap-3"><span className="muted shrink-0">{rel(e.time)}</span><span style={{ color: "var(--accent)" }}>{e.agent ?? "system"}</span><span className="muted truncate">{e.kind}{e.data && "tool" in e.data ? ` ${String(e.data.tool)}` : ""}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
