import { agents } from "@tether/core";
import { firstOrg, policiesList } from "@/lib/data";
import { Card } from "@/components/ui";

export default async function Agents() {
  const org = await firstOrg();
  const policies = org ? await policiesList(org.id) : [];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Agents & policies</h1>
      <div className="grid md:grid-cols-2 gap-4">
        {Object.values(agents()).map((a) => (
          <Card key={a.name} title={a.label} right={<span className="w-3 h-3 rounded-full inline-block" style={{ background: a.color }} />}>
            <p className="text-sm muted mb-3">{a.description}</p>
            <div className="flex flex-wrap gap-2">{a.tools.map((t) => <span key={t} className="pill">{t}</span>)}</div>
            <details className="mt-3 text-sm"><summary className="muted cursor-pointer">System prompt</summary><pre className="whitespace-pre-wrap text-xs mt-2 p-3 rounded-lg" style={{ background: "var(--panel-2)" }}>{a.prompt}</pre></details>
          </Card>
        ))}
      </div>
      <Card title="Org policies">
        <p className="muted text-sm mb-3">Defaults: reads run, low-risk writes run, everything else asks. High-risk external actions need a lead. Rows below override, lowest priority first.</p>
        <table className="w-full text-sm">
          <thead className="muted text-left text-xs uppercase"><tr><th className="py-1">Tool</th><th>Condition</th><th>Decision</th><th>Priority</th></tr></thead>
          <tbody>{policies.map((p) => <tr key={p.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-2 font-mono">{p.tool}</td><td className="font-mono text-xs">{JSON.stringify(p.condition)}</td><td>{p.decision}</td><td>{p.priority}</td></tr>)}</tbody>
        </table>
        {!policies.length && <p className="muted text-sm">No overrides yet.</p>}
      </Card>
    </div>
  );
}
