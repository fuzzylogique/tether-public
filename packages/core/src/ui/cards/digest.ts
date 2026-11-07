import type { Digest } from "../../runtime/digest.js";
import { TETHER } from "../tokens.js";
import { capList, text, truncate, type Block, type Card } from "../card.js";

const CATEGORY_EMOJI: Record<string, string> = { sponsor: "🤝", participant: "🎟️", vendor: "📦", venue: "🏛️", internal: "🧑‍🤝‍🧑", newsletter: "📰", other: "✉️" };

function sender(from: string) {
  return from.replace(/<.*>/, "").replace(/"/g, "").trim() || from;
}

/** Inbox digest card: action items first, then everything else in one compact block. */
export function digestCard(d: Digest): Card {
  const blocks: Block[] = [text(d.headline)];
  const byIndex = (i: number) => d.mails[i - 1];
  const actions = d.items.filter((it) => it.needsAction).sort((a, b) => (a.urgency === "high" ? -1 : 1) - (b.urgency === "high" ? -1 : 1));
  const rest = d.items.filter((it) => !it.needsAction);

  if (actions.length) {
    blocks.push(text(`**Needs a reply or a decision** · ${actions.length}`));
    const { shown, more } = capList(actions, 6);
    for (const it of shown) {
      const m = byIndex(it.index);
      const link = m ? `https://mail.google.com/mail/u/0/#inbox/${m.threadId}` : undefined;
      const head = `${it.urgency === "high" ? "🔴" : "🟠"} ${CATEGORY_EMOJI[it.category] ?? "✉️"} **${truncate(m ? sender(m.from) : "unknown", 40)}** · ${truncate(m?.subject ?? "", 70)}`;
      blocks.push({ kind: "section", md: [head, `${it.summary}${it.action ? `\n-# → ${it.action}` : ""}`], button: link ? { kind: "link", url: link, label: "Open" } : undefined });
    }
    if (more) blocks.push(text(`-# +${more} more that need action`));
  }
  if (rest.length) {
    const { shown, more } = capList(rest, 10);
    blocks.push({ kind: "separator", divider: true });
    blocks.push(text([`**FYI** · ${rest.length}`, ...shown.map((it) => { const m = byIndex(it.index); return `${CATEGORY_EMOJI[it.category] ?? "✉️"} ${truncate(m ? sender(m.from) : "unknown", 28)} · ${truncate(it.summary, 110)}`; }), more ? `-# +${more} more` : ""].filter(Boolean).join("\n")));
  }
  return {
    accent: TETHER,
    title: `Inbox digest · last ${d.windowHours}h`,
    subtitle: `${d.scanned} emails scanned · ${actions.length} need action`,
    blocks,
    footer: "sponsor replies are handled separately by the outreach watcher",
  };
}
