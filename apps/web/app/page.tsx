import Link from "next/link";
import { INTEGRATIONS, daysUntil, integrationEnabled } from "@tether/core";
import { currentUser } from "@/lib/auth0";
import { workspacesFor } from "@/lib/data";
import { IntegrationMark } from "@/components/marks";
import { PageTitle, rel } from "@/components/ui";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "short", month: "short", day: "numeric", year: "numeric" });

function countdown(at: Date | null) {
  const d = daysUntil(at);
  if (d === undefined) return "No event date set";
  if (d > 1) return `${d} days to go`;
  if (d === 1) return "Tomorrow";
  if (d === 0) return "Today";
  return `Ended ${dateFmt.format(at!)}`;
}

export default async function Workspaces() {
  const user = await currentUser();
  const list = user ? await workspacesFor(user) : [];
  return (
    <div className="space-y-8">
      <PageTitle sub="Each event runs from its own Discord server. Pick one to see where it stands and which services its agents may use.">Workspaces</PageTitle>
      {list.length ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map(({ org, pending, lastActivity }) => (
            <li key={org.id}>
              <Link href={`/w/${org.id}`} className="ws-card panel block p-5 h-full">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-xl font-semibold">{org.name}</h2>
                  {pending > 0 && <span className="tag shrink-0" style={{ color: "var(--accent)", borderColor: "var(--brand)" }}>{pending} to approve</span>}
                </div>
                <p className="num text-sm mt-1">{countdown(org.eventStartAt)}{org.eventStartAt && daysUntil(org.eventStartAt)! >= 0 ? <span className="muted"> · {dateFmt.format(org.eventStartAt)}</span> : null}</p>
                <div className="flex items-center justify-between gap-3 mt-6 pt-3 border-t rule">
                  <span className="flex gap-2.5" aria-label="Integrations">
                    {INTEGRATIONS.map((i) => {
                      const on = integrationEnabled(org, i.key);
                      return <span key={i.key} title={`${i.label}: ${on ? "on" : "off"}`} style={{ color: on ? "var(--ink)" : "var(--rule)" }}><IntegrationMark kind={i.key} size={18} /><span className="sr-only">{i.label} {on ? "on" : "off"}</span></span>;
                    })}
                  </span>
                  <span className="label">{lastActivity ? `Active ${rel(lastActivity)}` : "No agent work yet"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel p-6 max-w-xl space-y-3 text-sm">
          <p className="font-medium">No workspaces linked to {user?.email || "this account"} yet.</p>
          {user && !user.emailVerified && <p className="muted">Verify this email with Auth0 first; workspaces only match verified addresses.</p>}
          <p className="muted">In the Discord server for your event, run <code className="tag">/workspace web email:{user?.email || "you@example.com"}</code>. The workspace shows up here once you refresh.</p>
          <p className="muted">Setting up a new event? Invite the bot to its server and run <code className="tag">/tether setup</code> first.</p>
        </div>
      )}
    </div>
  );
}
