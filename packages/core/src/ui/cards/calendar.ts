import { AGENT_COLORS, TETHER } from "../tokens.js";
import { capList, text, ts, type Block, type Card } from "../card.js";

export type EventRow = { title: string; start: string; end: string; location?: string; htmlLink?: string };

const HOUR = 3600_000;

/** `/cal today` (§8.6): timeline strip with a "now" marker, then one entry per event. */
export function calendarCard(input: { events: EventRow[]; dayStart: number; now?: number; timeZone?: string; calendarUrl?: string; title?: string }): Card {
  const now = input.now ?? Date.now();
  const evs = input.events.filter((e) => e.start && e.end).map((e) => ({ ...e, s: new Date(e.start).getTime(), t: new Date(e.end).getTime() }));
  // Window: 8am–8pm by default, stretched to cover every event, whole hours.
  let from = input.dayStart + 8 * HOUR, to = input.dayStart + 20 * HOUR;
  for (const e of evs) { from = Math.min(from, e.s); to = Math.max(to, e.t); }
  from = Math.floor(from / HOUR) * HOUR; to = Math.ceil(to / HOUR) * HOUR;

  const blocks: Block[] = [{
    kind: "chart", name: "calendar-today", alt: evs.length ? evs.map((e) => e.title).join(", ") : "Nothing scheduled",
    spec: { type: "timeline", from, to, now, timeZone: input.timeZone, events: evs.map((e) => ({ label: e.title, start: e.s, end: e.t, color: e.t < now ? AGENT_COLORS.calendar : TETHER })) },
  }];
  const { shown, more } = capList(evs, 6);
  for (const e of shown) {
    const live = e.s <= now && now < e.t ? " · 🔴 now" : "";
    blocks.push({
      kind: "section",
      md: [`**${e.title}**${live}`, `-# ${ts(e.s, "t")}–${ts(e.t, "t")}${e.location ? ` · ${e.location}` : ""}`],
      button: e.htmlLink ? { kind: "link", url: e.htmlLink, label: "Open" } : undefined,
    });
  }
  if (more) blocks.push(text(`-# +${more} more`));
  if (!evs.length) blocks.push(text("Nothing scheduled today."));
  return {
    accent: AGENT_COLORS.calendar,
    title: input.title ?? "Today",
    subtitle: `${evs.length} event${evs.length === 1 ? "" : "s"} · ${ts(input.dayStart, "D")}`,
    blocks,
    actions: input.calendarUrl ? [[{ kind: "link", url: input.calendarUrl, label: "Open calendar" }]] : undefined,
  };
}
