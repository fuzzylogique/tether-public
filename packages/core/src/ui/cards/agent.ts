import { agents } from "../../agents/registry.js";
import { AGENT_COLORS, TETHER, agentEmoji } from "../tokens.js";

/** Emoji for a tool on the status card's tool log; the agent's emoji otherwise. */
const TOOL_EMOJI: Record<string, string> = {
  list_sponsors: "🔎", search_sponsor_replies: "🔎", search_docs: "🔎", list_tasks: "🔎", list_events: "🔎", find_conflicts: "🔎", budget_summary: "🔎", list_event_photos: "🖼️", select_recap_photos: "🖼️",
  create_email_draft: "✉️", send_email: "✉️", inbox_digest: "📥",
  log_expense: "💸", log_income: "💸", mark_reimbursed: "💸", parse_receipt: "🧾", sync_budget_from_sheet: "🔄",
  create_task: "📝", update_task: "📝", nudge_owner: "👋", escalate: "🚨", escalate_to_organizer: "🚨",
  create_event: "📅", update_sponsor: "🤝",
  generate_post_copy: "✍️", generate_hero_image: "🎨", post_announcement: "📣", post_instagram: "📸",
  request_drive_access: "📁", share_drive_folder: "📁",
};

export function toolEmoji(tool: string, agent: string) {
  return TOOL_EMOJI[tool] ?? agentEmoji(agent);
}

/** Label, accent and emoji shortcode for an agent; tolerant of unknown names ("direct", "cron"). */
export function agentMeta(name: string) {
  const def = agents()[name];
  return {
    label: def?.label ?? name.charAt(0).toUpperCase() + name.slice(1),
    color: def?.color ?? AGENT_COLORS[name] ?? TETHER,
    emoji: agentEmoji(name),
  };
}
