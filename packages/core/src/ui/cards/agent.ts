import { agents } from "../../agents/registry.js";
import { AGENT_COLORS, TETHER, agentEmoji } from "../tokens.js";

/** Label, accent and emoji shortcode for an agent; tolerant of unknown names ("direct", "cron"). */
export function agentMeta(name: string) {
  const def = agents()[name];
  return {
    label: def?.label ?? name.charAt(0).toUpperCase() + name.slice(1),
    color: def?.color ?? AGENT_COLORS[name] ?? TETHER,
    emoji: agentEmoji(name),
  };
}
