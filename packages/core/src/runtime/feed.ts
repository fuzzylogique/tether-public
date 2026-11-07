import type { Tool, ToolCtx } from "../tools/types.js";

/** Team channels Tether provisions (`/tether channels`). Keys live in `orgs.channels`. */
export const TEAM_CHANNELS = [
  { key: "ops", name: "ops", topic: "Escalations and unanswered participant questions." },
  { key: "tasks", name: "tasks", topic: "Task updates and nudges. Tether @mentions owners here instead of DMing." },
  { key: "calendar", name: "calendar", topic: "Every event Tether creates or changes, with links." },
  { key: "finance", name: "finance", topic: "Expenses logged and budget syncs." },
  { key: "sponsorship", name: "sponsorship", topic: "Sponsor pipeline changes, inbound replies, and sent emails." },
  { key: "socials", name: "socials", topic: "Post drafts and generated images." },
] as const;

/** Which team channel an agent's side effects are reported to. */
const AGENT_CHANNEL: Record<string, string> = {
  calendar: "calendar", coordination: "tasks", finance: "finance", outreach: "sponsorship", socials: "socials", helpdesk: "ops",
};

/** Tools that already post their own message into a team channel. */
const SELF_POSTING = new Set(["nudge_owner", "escalate", "escalate_to_organizer", "post_announcement"]);

const EMOJI: Record<string, string> = { calendar: "📅", tasks: "✅", finance: "💸", sponsorship: "🤝", socials: "📣", ops: "🛠️" };

export function sheetUrl(sheetId: string) { return `https://docs.google.com/spreadsheets/d/${sheetId}`; }
export function calendarUrl(calendarId: string) { return `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}&ctz=America%2FToronto`; }
export function calendarIcsUrl(calendarId: string) { return `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`; }
export function driveFolderUrl(folderId: string) { return `https://drive.google.com/drive/folders/${folderId}`; }

/**
 * Mirror an executed side effect into the owning team's channel so teammates without
 * access to the organizer's Google account can see it. Best effort: never fails the tool.
 */
export async function postActivity(ctx: ToolCtx, tool: Tool, args: Record<string, unknown>, result: unknown) {
  if (tool.effect === "read" || SELF_POSTING.has(tool.name)) return;
  if (result && typeof result === "object" && "error" in result) return;
  const key = AGENT_CHANNEL[ctx.agent];
  const channelId = key ? ctx.org.channels[key] : undefined;
  if (!key || !channelId) return;
  const htmlLink = result && typeof result === "object" && "htmlLink" in result ? String(result.htmlLink) : "";
  const link = htmlLink || (ctx.org.sheetId && key !== "socials" && key !== "calendar" ? sheetUrl(ctx.org.sheetId) : "");
  // A name, not a mention: the feed should not ping whoever triggered the run.
  const who = ctx.actor.name ?? "Tether";
  const text = `${EMOJI[key] ?? "•"} ${tool.summarize(args)} · by ${who}${link ? ` · <${link}>` : ""}`;
  try { await ctx.notify.postToChannel({ channelId, text }); } catch (e) { console.warn("activity feed post failed", e); }
}
