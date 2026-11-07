import Link from "next/link";
import { firstOrg, runsList } from "@/lib/data";
import { PageTitle, StatusPill, rel } from "@/components/ui";

export default async function Runs() {
  const org = await firstOrg();
  if (!org) return <p className="muted">No organization yet.</p>;
  const rows = await runsList(org.id);
  const stepCount = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;
  return (
    <div className="space-y-6">
      <PageTitle sub="Every request the agents have picked up, newest first.">Runs</PageTitle>
      <div className="panel divide-y rule">
        {rows.map((r) => (
          <Link key={r.id} href={`/runs/${r.id}`} className="row-link flex items-center justify-between gap-6 px-5 py-3">
            <div className="min-w-0">
              <div className="truncate">{r.request}</div>
              <div className="label mt-1">{r.trigger} · {stepCount(r.plan?.steps.filter((s) => s.enabled).length ?? 0)} · {rel(r.createdAt)}</div>
            </div>
            <StatusPill status={r.status} />
          </Link>
        ))}
        {!rows.length && <p className="muted p-5">No runs yet.</p>}
      </div>
    </div>
  );
}
