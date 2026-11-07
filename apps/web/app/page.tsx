import Link from "next/link";
import { agents } from "@tether/core";
import { firstOrg, overview } from "@/lib/data";
import { AgentName, Bar, Card, PageTitle, StatStrip, StatusPill, fmt, rel } from "@/components/ui";

export default async function Overview() {
  const org = await firstOrg();
  if (!org) return <p className="muted">No organization yet. Run <code>/tether setup</code> in Discord or <code>pnpm db:seed</code>.</p>;
  const o = await overview(org.id);
  const colors = Object.fromEntries(Object.values(agents()).map((a) => [a.name, a.color]));
  const allocated = o.budget.reduce((a, b) => a + b.allocated, 0), spent = o.budget.reduce((a, b) => a + b.spent, 0);
  const confirmedSponsors = o.sponsors.filter((s) => s.stage === "confirmed");
  const confirmed = confirmedSponsors.reduce((a, s) => a + Number(s.amount ?? 0), 0);
  const openTasks = o.tasks.filter((t) => t.status !== "done");
  const overdue = openTasks.filter((t) => t.dueAt && t.dueAt < new Date()).length;
  const runsToday = o.recentRuns.filter((r) => Date.now() - r.createdAt.getTime() < 86400_000).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <PageTitle sub="What the agents are doing and what needs a decision from you.">{org.name}</PageTitle>
        <Link href="/approvals" className="text-sm link shrink-0" style={o.pending.length ? { color: "var(--accent)" } : undefined}>
          <span className="num">{o.pending.length}</span> awaiting approval
        </Link>
      </div>

      <StatStrip items={[
        { label: "Budget used", value: `${allocated ? Math.round((spent / allocated) * 100) : 0}%`, sub: `${fmt(spent)} of ${fmt(allocated)}` },
        { label: "Sponsorship confirmed", value: fmt(confirmed), sub: `${confirmedSponsors.length} sponsors` },
        { label: "Overdue tasks", value: String(overdue), sub: `${openTasks.length} open`, alert: overdue > 0 },
        { label: "Runs today", value: String(runsToday) },
      ]} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Budget by category">
          <div className="space-y-4">
            {o.budget.map((b) => {
              const pct = b.allocated ? (b.spent / b.allocated) * 100 : 0;
              return (
                <div key={b.category}>
                  <div className="flex justify-between text-sm mb-1.5"><span>{b.category}</span><span className="num muted">{fmt(b.spent)} / {fmt(b.allocated)}</span></div>
                  <Bar pct={pct} />
                </div>
              );
            })}
            {!o.budget.length && <p className="muted text-sm">No budget lines yet.</p>}
          </div>
        </Card>
        <Card title="Sponsor pipeline">
          <ul className="text-sm divide-y rule -my-2">
            {o.sponsors.map((s) => (
              <li key={s.id} className="flex justify-between items-center gap-4 py-2">
                <span>{s.name}{s.tier && <span className="muted"> · {s.tier}</span>}</span>
                <span className="flex items-center gap-4"><span className="num muted">{s.amount ? fmt(Number(s.amount)) : ""}</span><StatusPill status={s.stage} /></span>
              </li>
            ))}
            {!o.sponsors.length && <li className="muted py-2">No sponsors yet.</li>}
          </ul>
        </Card>
        <Card title="Recent runs" right={<Link href="/runs" className="text-sm link">All runs</Link>}>
          <ul className="text-sm divide-y rule -my-2">
            {o.recentRuns.map((r) => (
              <li key={r.id} className="flex justify-between gap-4 py-2">
                <Link href={`/runs/${r.id}`} className="truncate hover:underline underline-offset-3">{r.request}</Link>
                <span className="flex gap-3 items-center shrink-0"><span className="num muted text-xs">{rel(r.createdAt)}</span><StatusPill status={r.status} /></span>
              </li>
            ))}
            {!o.recentRuns.length && <li className="muted py-2">Nothing yet. Mention the bot in Discord.</li>}
          </ul>
        </Card>
        <Card title="Activity">
          <ul className="space-y-1.5 text-xs max-h-72 overflow-y-auto">
            {o.activity.map((e, i) => (
              <li key={i} className="flex gap-3 items-center">
                <span className="num muted shrink-0 w-16">{rel(e.time)}</span>
                <span className="shrink-0"><AgentName name={e.agent ?? "system"} color={colors[e.agent ?? ""]} /></span>
                <span className="font-mono muted truncate">{e.kind}{e.data && "tool" in e.data ? ` ${String(e.data.tool)}` : ""}</span>
              </li>
            ))}
            {!o.activity.length && <li className="muted">No activity yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
