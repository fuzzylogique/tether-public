import Link from "next/link";
import { firstOrg, runsList } from "@/lib/data";
import { StatusPill, rel } from "@/components/ui";

export default async function Runs() {
  const org = await firstOrg();
  if (!org) return <p className="muted">No organization yet.</p>;
  const rows = await runsList(org.id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Runs</h1>
      <div className="panel divide-y" style={{ borderColor: "var(--border)" }}>
        {rows.map((r) => (
          <Link key={r.id} href={`/runs/${r.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-white/5">
            <div className="min-w-0">
              <div className="truncate">{r.request}</div>
              <div className="muted text-xs">{r.trigger} · {r.plan?.steps.filter((s) => s.enabled).length ?? 0} steps · {rel(r.createdAt)}</div>
            </div>
            <StatusPill status={r.status} />
          </Link>
        ))}
        {!rows.length && <p className="muted p-5">No runs yet.</p>}
      </div>
    </div>
  );
}
