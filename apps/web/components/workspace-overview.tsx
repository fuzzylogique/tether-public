import Link from "next/link";
import { AGENT_COLORS, agents, daysUntil, type Progress, type WorkspaceSummary } from "@tether/core";
import { IntegrationMark } from "@/components/marks";
import { IntegrationSwitch } from "@/components/integration-switch";
import { AgentName, Bar, Card, fmt, rel } from "@/components/ui";

const TZ = "America/Toronto";
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

function Metric({ label, p, money, spend, empty, children }: {
  label: string; p: Progress | undefined; money?: boolean; spend?: boolean; empty: React.ReactNode; children?: React.ReactNode;
}) {
  const f = (n: number) => (money ? fmt(n) : n.toLocaleString("en-CA"));
  const pct = p?.target ? (p.current / p.target) * 100 : undefined;
  return (
    <div className="px-5 py-4 flex flex-col">
      <div className="label">{label}</div>
      {p ? (
        <>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <span className="num text-2xl">{f(p.current)}</span>
            <span className="muted text-sm">{p.target ? `of ${f(p.target)}` : "no target set"}</span>
          </div>
          <div className="mt-3">{pct !== undefined ? <Bar pct={pct} spend={spend} /> : <div className="h-1.5" style={{ background: "var(--sheet-2)" }} />}</div>
          {children}
          <p className="muted text-xs mt-auto pt-3">From {p.source}{p.updatedAt ? ` · ${rel(p.updatedAt)}` : ""}</p>
        </>
      ) : (
        <p className="muted text-sm mt-2">{empty}</p>
      )}
    </div>
  );
}

/**
 * The workspace overview, shared by the signed-in page (`/w/[id]`) and the public read-only page (`/demo/[id]`).
 * `publicView` hides everything a stranger should not see or touch: the integration switches and the sponsor inbox
 * snippets (real email). Totals, today's calendar, the activity chart and agent summaries stay, which is what a
 * judge, a sponsor or a parent club wants to glance at.
 */
export function WorkspaceOverview({ s, canEdit, publicView = false }: { s: WorkspaceSummary; canEdit: boolean; publicView?: boolean }) {
  const days = daysUntil(s.org.eventStartAt);
  const labels = Object.fromEntries(Object.values(agents()).map((a) => [a.name, a.label]));
  const activityTotal = s.agentActivity.hours.reduce((sum, h) => sum + h.n, 0);
  const activityPeak = Math.max(...s.agentActivity.hours.map((h) => h.n));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          {publicView ? <span className="label">Public read-only view</span> : <Link href="/" className="label hover:text-[var(--ink)]">Workspaces /</Link>}
          <h1 className="font-display text-3xl font-semibold mt-1">{s.org.name}</h1>
          <p className="num text-sm mt-1">
            {days === undefined ? <span className="muted">No event date. Run <code className="tag">/workspace date</code> in Discord.</span>
              : <>{days > 1 ? `${days} days to go` : days === 1 ? "Tomorrow" : days === 0 ? "Event day" : "Event over"}<span className="muted"> · {dateFmt.format(s.org.eventStartAt!)}</span></>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          {s.pendingApprovals > 0 && (
            <p style={{ color: "var(--accent)" }}><span className="num">{s.pendingApprovals}</span> action{s.pendingApprovals === 1 ? "" : "s"} waiting for approval in Discord</p>
          )}
          {publicView
            ? <p className="muted text-xs">Shared by the organizers. Settings and the sponsor inbox are hidden; <Link href="/" className="link">sign in</Link> for the full workspace.</p>
            : <Link href={`/demo/${s.org.id}`} className="muted link text-xs">Public read-only link</Link>}
        </div>
      </div>

      <section className="panel" aria-labelledby="int-h">
        <h2 id="int-h" className="label px-5 pt-3">Integrations</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {s.integrations.map((i, idx) => (
            <li key={i.key} className={`px-5 py-4 rule ${idx ? "border-t sm:border-t-0" : ""} ${idx % 2 ? "sm:border-l" : ""} ${idx > 1 ? "sm:border-t lg:border-t-0" : ""} ${idx === 2 ? "lg:border-l" : ""}`}>
              <div className="flex items-center gap-2.5" style={{ color: i.status === "off" ? "var(--muted)" : "var(--ink)" }}>
                <IntegrationMark kind={i.key} />
                <span className="font-medium text-sm">{i.label}</span>
              </div>
              <p className="muted text-xs mt-1 min-h-8">{i.description}</p>
              <div className="mt-2">{publicView ? <span className="label">{i.status === "off" ? "Off" : "Connected"}</span> : <IntegrationSwitch orgId={s.org.id} kind={i.key} label={i.label} status={i.status} canEdit={canEdit} />}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 rule" aria-label="Progress">
        <Metric label="Sponsorship" p={s.sponsorship} money empty={null} />
        <div className="sm:border-l rule">
          <Metric label="Budget spent" p={s.budget.target || s.budget.current ? s.budget : undefined} money spend empty={<>No budget yet. Fill the Budget tab, then ask finance to sync it.</>} />
        </div>
        <div className="sm:border-t lg:border-t-0 lg:border-l rule">
          <Metric label="Registrations" p={s.registrations} empty={<>Not tracked yet. <code className="tag">/goal set registrations</code></>} />
        </div>
        <div className="sm:border-t sm:border-l lg:border-t-0 rule">
          <Metric label="People confirmed" p={s.people.total} empty={<>Not tracked yet. <code className="tag">/goal set volunteers</code>, mentors or judges</>}>
            {s.people.parts.length > 1 && (
              <p className="num text-xs mt-2">{s.people.parts.map((x) => `${x.label} ${x.current}${x.target !== undefined ? `/${x.target}` : ""}`).join(" · ")}</p>
            )}
          </Metric>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Today" right={s.todaySource === "mirror" ? <span className="label">Saved copy</span> : undefined}>
          {s.todaySource === "off" ? <p className="muted text-sm">Google Calendar is disconnected for this workspace.</p>
            : s.today.length ? (
              <ul className="text-sm divide-y rule -my-2">
                {s.today.map((e, i) => (
                  <li key={i} className="flex gap-4 py-2">
                    <span className="num muted w-20 shrink-0">{e.start.length <= 10 ? "All day" : timeFmt.format(new Date(e.start))}</span>
                    <span className="min-w-0">{e.title}{e.location && <span className="muted"> · {e.location}</span>}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted text-sm">Nothing on the calendar today.</p>}
        </Card>
        {publicView ? (
          <Card title="Inbox"><p className="muted text-sm">Sponsor email is only shown to signed-in organizers.</p></Card>
        ) : (
        <Card title="Inbox" right={s.inbox.count ? <span className="num text-sm" style={{ color: "var(--accent)" }}>{s.inbox.count} waiting</span> : undefined}>
          {s.integrations.find((i) => i.key === "gmail")?.status === "off" ? <p className="muted text-sm">Gmail is disconnected for this workspace.</p>
            : s.inbox.threads.length ? (
              <ul className="text-sm divide-y rule -my-2">
                {s.inbox.threads.map((t, i) => (
                  <li key={i} className="py-2">
                    <div className="flex justify-between gap-4"><span className="font-medium">{t.sponsor}</span><span className="num muted text-xs shrink-0">{rel(t.updatedAt)}</span></div>
                    <p className="muted truncate">{t.snippet}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="muted text-sm">No sponsor emails waiting on a reply.</p>}
          {s.inbox.count > s.inbox.threads.length && <p className="muted text-xs mt-3">Run <code className="tag">/digest</code> in Discord for the full list.</p>}
        </Card>
        )}
      </div>

      <Card title="Agent activity, last 24 hours" right={activityTotal ? <span className="num text-sm">{activityTotal.toLocaleString("en-CA")} events</span> : undefined}>
        {activityTotal ? (
          <>
            <div className="flex items-end gap-px h-16" role="img" aria-label={`${activityTotal} agent events in the last 24 hours, by hour`}>
              {s.agentActivity.hours.map((h) => (
                <div key={h.at.getTime()} className="flex-1" title={`${timeFmt.format(h.at)}: ${h.n}`}
                  style={h.n ? { height: `${Math.max(6, (h.n / activityPeak) * 100)}%`, background: "var(--brand)" } : { height: 2, background: "var(--sheet-2)" }} />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm mt-4">
              {s.agentActivity.byAgent.map((a) => (
                <li key={a.agent} className="flex items-center gap-2"><AgentName name={labels[a.agent] ?? a.agent} color={AGENT_COLORS[a.agent]} /><span className="num muted">{a.n}</span></li>
              ))}
            </ul>
            <p className="muted text-xs mt-3">From the TigerData continuous aggregate, refreshed every 5 minutes</p>
          </>
        ) : <p className="muted text-sm">No agent activity in the last 24 hours.</p>}
      </Card>

      <Card title="Recent agent work">
        {s.activity.length ? (
          <ul className="text-sm divide-y rule -my-2">
            {s.activity.map((a, i) => (
              <li key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1 py-2">
                <span className="sm:w-44 shrink-0"><AgentName name={labels[a.agent] ?? a.agent} color={AGENT_COLORS[a.agent]} /></span>
                <span className="flex-1 min-w-0">{a.summary}</span>
                <span className="num muted text-xs shrink-0">{rel(a.at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted text-sm">Nothing yet. Mention the bot in Discord to hand it a task.</p>}
      </Card>
    </div>
  );
}
