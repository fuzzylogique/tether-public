import { firstOrg, pendingActions } from "@/lib/data";
import { Card, StatusPill, rel } from "@/components/ui";
import { decideAction } from "../actions";

export default async function Approvals() {
  const org = await firstOrg();
  if (!org) return <p className="muted">No organization yet.</p>;
  const rows = await pendingActions(org.id);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Approvals</h1>
      {!rows.length && <p className="muted">Inbox zero. Agents will post here when they need a decision.</p>}
      {rows.map((a) => (
        <Card key={a.id} title={`${a.agent} · ${a.tool}`} right={<span className="flex gap-2"><StatusPill status={a.risk} /><span className="muted text-xs">{rel(a.createdAt)}</span></span>}>
          <p className="font-medium mb-3">{a.summary}</p>
          <pre className="text-xs p-3 rounded-lg overflow-auto max-h-64" style={{ background: "var(--panel-2)" }}>{a.tool === "send_email" ? `To: ${a.args.to}\nSubject: ${a.args.subject}\n\n${a.args.body}` : JSON.stringify(a.args, null, 2)}</pre>
          <form className="flex gap-2 mt-4" action={async (fd) => { "use server"; await decideAction(a.id, fd.get("verb") === "approve", String(fd.get("note") ?? "") || undefined); }}>
            <input name="note" placeholder="Note (optional)" className="flex-1 px-3 py-2 rounded-lg text-sm" style={{ background: "var(--panel-2)", border: "1px solid var(--border)" }} />
            <button name="verb" value="approve" className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--teal)" }}>Approve</button>
            <button name="verb" value="reject" className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--red)" }}>Reject</button>
          </form>
        </Card>
      ))}
    </div>
  );
}
