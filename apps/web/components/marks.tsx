import { AGENT_COLORS } from "@tether/core";
import type { IntegrationKey } from "@tether/core";

/** The Tether mark: two linked rings on a square purple tile, the same drawing as the bot avatar. */
export function TetherMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" fill="var(--brand)" />
      <circle cx="12.4" cy="16" r="6.2" fill="none" stroke="#fff" strokeWidth="2.3" />
      <circle cx="19.6" cy="16" r="6.2" fill="none" stroke="#fff" strokeWidth="2.3" />
    </svg>
  );
}

/** Agent colours in agent order, as flat segments: the ribbon along the bottom of the bot banner. */
export function Ribbon() {
  return (
    <div className="ribbon" aria-hidden>
      {Object.values(AGENT_COLORS).map((c) => <span key={c} style={{ background: c }} />)}
    </div>
  );
}

/** Line glyphs for each integration, drawn to sit beside the mark rather than borrowed from a stock set. */
export function IntegrationMark({ kind, size = 20 }: { kind: IntegrationKey; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "miter" as const };
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      {kind === "gmail" && <><rect x="2.5" y="4.5" width="15" height="11" {...common} /><path d="M2.5 5 10 11l7.5-6" {...common} /></>}
      {kind === "calendar" && <><rect x="2.5" y="4" width="15" height="13" {...common} /><path d="M2.5 8h15M6.5 2v4M13.5 2v4" {...common} /><rect x="6" y="11" width="3" height="3" fill="currentColor" /></>}
      {kind === "sheets" && <><rect x="3.5" y="2.5" width="13" height="15" {...common} /><path d="M3.5 7.5h13M3.5 12.5h13M8.5 7.5v10" {...common} /></>}
      {kind === "docs" && <><path d="M4.5 2.5h7l4 4v11h-11z" {...common} /><path d="M11.5 2.5v4h4M7 10h6M7 13h6" {...common} /></>}
    </svg>
  );
}
