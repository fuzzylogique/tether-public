export function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="panel">
      {(title || right) && (
        <div className="flex items-center justify-between px-5 py-3 border-b rule">
          {title && <h2 className="label">{title}</h2>}
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">{children}</h1>
      {sub && <p className="muted text-sm mt-1">{sub}</p>}
    </div>
  );
}

/** A row of figures read like a ledger line: one ruled strip, not separate cards. */
export function StatStrip({ items }: { items: { label: string; value: string; sub?: string; alert?: boolean }[] }) {
  return (
    <div className="panel grid grid-cols-2 md:grid-cols-4">
      {items.map((s, i) => (
        <div key={s.label} className={`px-5 py-4 rule ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}>
          <div className="label">{s.label}</div>
          <div className="num text-3xl mt-2" style={s.alert ? { color: "var(--accent)" } : undefined}>{s.value}</div>
          {s.sub && <div className="muted text-sm mt-1">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

const statusColor: Record<string, string> = {
  done: "var(--ok)", executed: "var(--ok)", approved: "var(--ok)", confirmed: "var(--ok)", low: "var(--ok)",
  running: "var(--wait)", awaiting_approval: "var(--wait)", pending: "var(--wait)", negotiating: "var(--wait)", medium: "var(--wait)",
  proposed: "var(--accent)",
  failed: "var(--fail)", rejected: "var(--fail)", denied: "var(--fail)", high: "var(--fail)",
  cancelled: "var(--muted)", expired: "var(--muted)",
};

export function StatusPill({ status }: { status: string }) {
  return <span className="status" style={{ color: statusColor[status] ?? "var(--muted)" }}>{status.replaceAll("_", " ")}</span>;
}

export function AgentName({ name, color }: { name: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      <span className="swatch" style={{ background: color ?? "var(--muted)" }} />
      {name}
    </span>
  );
}

export function Bar({ pct }: { pct: number }) {
  const color = pct > 95 ? "var(--fail)" : pct > 80 ? "var(--wait)" : "var(--ink)";
  return (
    <div className="h-1.5" style={{ background: "var(--sheet-2)" }}>
      <div className="h-full" style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
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
