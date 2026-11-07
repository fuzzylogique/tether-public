import { agents } from "@tether/core";
import { firstOrg, policiesList } from "@/lib/data";
import { AgentName, Card, PageTitle } from "@/components/ui";

export default async function Agents() {
  const org = await firstOrg();
  const policies = org ? await policiesList(org.id) : [];
  return (
    <div className="space-y-8">
      <PageTitle sub="Who the planner can hand work to, which tools each one holds, and the rules that gate them.">Agents & policies</PageTitle>

      <section className="panel divide-y rule">
        {Object.values(agents()).map((a) => (
          <div key={a.name} className="grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)] gap-x-8 gap-y-2 px-5 py-4">
            <div>
              <AgentName name={a.label} color={a.color} />
              <div className="label mt-1">{a.name}</div>
            </div>
            <div>
              <p className="text-sm muted">{a.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-3">{a.tools.map((t) => <span key={t} className="tag">{t}</span>)}</div>
              <details className="mt-3 text-sm">
                <summary className="muted cursor-pointer link w-fit">System prompt</summary>
                <pre className="code-block whitespace-pre-wrap mt-2">{a.prompt}</pre>
              </details>
            </div>
          </div>
        ))}
      </section>

      <Card title="Org policies">
        <p className="muted text-sm mb-4">Defaults: reads run, low-risk writes run, everything else asks. High-risk external actions need a lead. Rows below override, lowest priority first.</p>
        {policies.length > 0 ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b rule"><th className="label py-2 font-normal">Tool</th><th className="label font-normal">Condition</th><th className="label font-normal">Decision</th><th className="label font-normal text-right">Priority</th></tr></thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className="border-b rule last:border-0">
                  <td className="py-2 font-mono">{p.tool}</td>
                  <td className="font-mono text-xs muted">{JSON.stringify(p.condition)}</td>
                  <td>{p.decision}</td>
                  <td className="num text-right">{p.priority}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted text-sm">No overrides yet.</p>}
      </Card>
    </div>
  );
}
