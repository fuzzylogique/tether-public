/**
 * Design tokens shared by Discord cards, SVG charts and (optionally) the web dashboard.
 * Pure data, no imports: the agent colours mirror `agents/<name>/agent.json` so charts can
 * colour a series without loading the agent registry.
 */

export const TETHER = "#6D5DF6";

export const AGENT_COLORS: Record<string, string> = {
  finance: "#1D9E75",
  outreach: "#7F77DD",
  socials: "#D4537E",
  calendar: "#378ADD",
  coordination: "#EF9F27",
  helpdesk: "#888780",
};

/** Categorical series colours, in agent order, so a chart and the dashboard agree. */
export const SERIES = [
  AGENT_COLORS.finance!, AGENT_COLORS.outreach!, AGENT_COLORS.socials!,
  AGENT_COLORS.calendar!, AGENT_COLORS.coordination!, AGENT_COLORS.helpdesk!,
];

export const STATUS_COLORS: Record<string, string> = {
  proposed: TETHER,
  approved: TETHER,
  pending: "#888780",
  running: "#EF9F27",
  awaiting_approval: "#EF9F27",
  done: "#1D9E75",
  executed: "#1D9E75",
  failed: "#E24B4A",
  rejected: "#E24B4A",
  denied: "#E24B4A",
  expired: "#888780",
  cancelled: "#888780",
  skipped: "#888780",
};

export const AMBER = "#EF9F27";
export const RED = "#E24B4A";
export const GREEN = "#1D9E75";
export const GREY = "#888780";

/** Budget thresholds, same as `Bar` in apps/web/components/ui.tsx. */
export function thresholdColor(pct: number, base = GREEN) {
  return pct > 95 ? RED : pct > 80 ? AMBER : base;
}

/** Chart canvas: Discord dark "tertiary" so one PNG reads as a deliberate card in both themes. */
export const CHART = {
  bg: "#1E1F22",
  surface: "#2B2D31",
  text: "#F2F3F5",
  muted: "#949BA4",
  grid: "#3F4147",
  font: "Inter",
  scale: 2,
  radius: 28,
  pad: 48,
  size: { title: 44, value: 30, label: 26, caption: 22 },
  weight: { regular: 400, semibold: 600 },
} as const;

/**
 * Emoji shortcodes used in card text. Cards write `:tether_<name>:`; the adapter swaps in the
 * uploaded application emoji (`<:tether_x:id>`) or this unicode fallback when none is registered.
 */
export const EMOJI_FALLBACK: Record<string, string> = {
  tether_finance: "💸",
  tether_outreach: "🤝",
  tether_socials: "📣",
  tether_calendar: "📅",
  tether_coordination: "🧭",
  tether_helpdesk: "💬",
  tether_running: "⏳",
  tether_done: "✅",
  tether_failed: "❌",
  tether_locked: "🔒",
  tether_pending: "⬜",
};

export const EMOJI_NAMES = Object.keys(EMOJI_FALLBACK);

/** `:tether_finance:` for a known agent, a neutral dot otherwise. */
export function agentEmoji(agent: string) {
  return EMOJI_FALLBACK[`tether_${agent}`] ? `:tether_${agent}:` : "•";
}

export function statusEmoji(status: string) {
  switch (status) {
    case "running": case "awaiting_approval": return ":tether_running:";
    case "done": case "executed": return ":tether_done:";
    case "failed": case "rejected": case "denied": return ":tether_failed:";
    case "skipped": case "cancelled": case "expired": return "➖";
    default: return ":tether_pending:";
  }
}
