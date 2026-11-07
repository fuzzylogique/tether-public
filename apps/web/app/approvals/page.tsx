import { agents } from "@tether/core";
import { firstOrg, pendingActions } from "@/lib/data";
import { AgentName, Card, PageTitle, StatusPill, rel } from "@/components/ui";
import { decideAction } from "../actions";

export default async function Approvals() {
  const org = await firstOrg();
  if (!org) return <p className="muted">No organization yet.</p>;
  const rows = await pendingActions(org.id);
  const colors = Object.fromEntries(Object.values(agents()).map((a) => [a.name, a.color]));
  return (
    <div className="space-y-6">
      <PageTitle sub="Actions the policy gateway held for a human decision.">Approvals</PageTitle>
      {!rows.length && <div className="panel p-5 muted">Nothing waiting. Agents will post here when they need a decision.</div>}
      {rows.map((a) => (
        <Card
          key={a.id}
          title={a.tool}
          right={<span className="flex gap-4 items-center"><StatusPill status={a.risk} /><span className="num muted text-xs">{rel(a.createdAt)}</span></span>}
        >
          <div className="text-sm mb-2"><AgentName name={a.agent} color={colors[a.agent]} /></div>
          <p className="font-medium mb-3">{a.summary}</p>
          <pre className="code-block overflow-auto max-h-64 whitespace-pre-wrap">{a.tool === "send_email" ? `To: ${a.args.to}\nSubject: ${a.args.subject}\n\n${a.args.body}` : JSON.stringify(a.args, null, 2)}</pre>
          <form className="flex gap-2 mt-4" action={async (fd) => { "use server"; await decideAction(a.id, fd.get("verb") === "approve", String(fd.get("note") ?? "") || undefined); }}>
            <input name="note" placeholder="Note (optional)" className="input flex-1" />
            <button name="verb" value="approve" className="btn btn-primary">Approve</button>
            <button name="verb" value="reject" className="btn btn-danger">Reject</button>
          </form>
        </Card>
      ))}
    </div>
  );
}
