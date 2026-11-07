export function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="panel p-5">
      {(title || right) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h2 className="text-sm font-medium muted uppercase tracking-wide">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-5">
      <div className="muted text-xs uppercase tracking-wide">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
      {sub && <div className="muted text-sm mt-1">{sub}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const color: Record<string, string> = {
    done: "var(--teal)", executed: "var(--teal)", approved: "var(--teal)", running: "var(--amber)", awaiting_approval: "var(--amber)",
    pending: "var(--amber)", proposed: "var(--accent)", failed: "var(--red)", rejected: "var(--red)", denied: "var(--red)", cancelled: "var(--muted)", expired: "var(--muted)",
  };
  return <span className="pill" style={{ color: color[status] ?? "var(--text)" }}>{status.replace("_", " ")}</span>;
}

export function Bar({ pct, color = "var(--accent)" }: { pct: number; color?: string }) {
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--panel-2)" }}>
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: pct > 95 ? "var(--red)" : pct > 80 ? "var(--amber)" : color }} />
    </div>
  );
}

export const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
export const rel = (d: Date | string) => {
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60000);
  if (Math.abs(m) < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
