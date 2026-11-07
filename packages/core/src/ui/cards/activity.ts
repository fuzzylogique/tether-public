import { truncate, type Card } from "../card.js";
import { agentMeta } from "./agent.js";

/**
 * Activity feed line (§8.5): a compact card in the team channel for one executed side effect.
 * `who` is a name, not a mention, so the feed never pings whoever triggered the run.
 */
export function activityCard(input: { agent: string; title: string; who: string; link?: { url: string; label?: string }; emoji?: string }): Card {
  const a = agentMeta(input.agent);
  const line = `${input.emoji ?? a.emoji} **${truncate(input.title, 180)}** · by ${input.who}`;
  return {
    accent: a.color,
    blocks: [{ kind: "section", md: [line], button: input.link ? { kind: "link", url: input.link.url, label: input.link.label ?? "Open" } : undefined }],
  };
}
