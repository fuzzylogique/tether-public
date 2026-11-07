import { AGENT_COLORS, GREEN, TETHER } from "../tokens.js";
import { capList, fmtMoney, text, ts, type Block, type Card } from "../card.js";

export type SponsorRow = {
  name: string; stage: string; amount: string | number | null; tier: string | null;
  lastContactAt: Date | string | null; deliverables: { title: string; done: boolean }[];
};

const STAGES = ["lead", "contacted", "replied", "negotiating", "confirmed"] as const;
const STAGE_EMOJI: Record<string, string> = { lead: "⚪", contacted: "📨", replied: "💬", negotiating: "🤝", confirmed: "✅", declined: "⛔" };
const STAGE_COLOR: Record<string, string> = { lead: "#5865F2", contacted: "#6D5DF6", replied: "#7F77DD", negotiating: "#9B8AFB", confirmed: GREEN };
const STALE_DAYS = 5;

/** `/sponsor list` (§8.6): funnel by stage, then one entry per sponsor with stale highlighting. */
export function sponsorsCard(input: { sponsors: SponsorRow[]; now?: number; stage?: string }): Card {
  const now = input.now ?? Date.now();
  const amount = (s: SponsorRow) => (s.amount === null || s.amount === "" ? 0 : Number(s.amount));
  const at = (stage: string) => input.sponsors.filter((s) => s.stage === stage);
  const sum = (xs: SponsorRow[]) => xs.reduce((t, s) => t + amount(s), 0);
  const confirmed = sum(at("confirmed"));
  const pipeline = sum(input.sponsors.filter((s) => s.stage !== "confirmed" && s.stage !== "declined"));

  const blocks: Block[] = [];
  if (!input.sponsors.length) blocks.push(text("No sponsors yet."));
  else {
    if (!input.stage) {
      blocks.push({
        kind: "chart", name: "sponsor-funnel",
        alt: STAGES.map((st) => `${st} ${at(st).length}`).join(", "),
        spec: {
          type: "funnel",
          // A funnel counts everyone who reached a stage, so it narrows; "now" is who sits there today.
          stages: STAGES.map((st, i) => ({
            label: st[0]!.toUpperCase() + st.slice(1),
            count: input.sponsors.filter((s) => (STAGES as readonly string[]).indexOf(s.stage) >= i).length,
            detail: [`${at(st).length} now`, sum(at(st)) ? fmtMoney(sum(at(st))) : ""].filter(Boolean).join(" · "),
            color: STAGE_COLOR[st] ?? TETHER,
          })),
          aside: at("declined").length ? { label: "Declined", count: at("declined").length } : undefined,
        },
      });
    }
    const order = (s: SponsorRow) => -(STAGES as readonly string[]).indexOf(s.stage);
    const { shown, more } = capList([...input.sponsors].sort((a, b) => order(a) - order(b) || amount(b) - amount(a)), 8);
    const lines = shown.map((s) => {
      const head = [`${STAGE_EMOJI[s.stage] ?? "•"} **${s.name}**`, s.tier, amount(s) ? fmtMoney(amount(s)) : ""].filter(Boolean).join(" · ");
      const last = s.lastContactAt ? new Date(s.lastContactAt).getTime() : undefined;
      const stale = s.stage !== "confirmed" && s.stage !== "declined" && s.stage !== "lead" && (!last || now - last > STALE_DAYS * 86400_000);
      const contact = last ? `last contact ${ts(last)}` : "never contacted";
      const done = s.deliverables.filter((d) => d.done).length;
      const ring = s.deliverables.length ? ` · deliverables ${"●".repeat(done)}${"○".repeat(s.deliverables.length - done)} ${done}/${s.deliverables.length}` : "";
      return `${head}\n-# ${s.stage} · ${stale ? `🟠 **${contact}**, follow up` : contact}${ring}`;
    });
    blocks.push(text(lines.join("\n") + (more ? `\n-# +${more} more` : "")));
  }
  return {
    accent: AGENT_COLORS.outreach,
    title: input.stage ? `Sponsors · ${input.stage}` : "Sponsor pipeline",
    subtitle: `${fmtMoney(confirmed)} confirmed · ${fmtMoney(pipeline)} in pipeline · ${input.sponsors.length} sponsors`,
    blocks,
    footer: `stale = no contact in ${STALE_DAYS} days`,
  };
}
