import { AGENT_COLORS, CHART, SERIES, thresholdColor } from "../tokens.js";
import { fmtMoney, kv, text, ts, type Block, type Card } from "../card.js";

export type BudgetRow = { category: string; allocated: number; spent: number; remaining?: number; pctUsed?: number };
export type BudgetExtras = {
  income?: { received: number; pledged: number };
  net?: number;
  reimbursementsOwed?: { total: number; byPerson: { paidBy: string; amount: number }[] };
};

/** `/budget summary` (§8.6): donut of spend vs remaining, threshold bars per category, totals. */
export function budgetCard(input: {
  rows: BudgetRow[]; totals: { allocated: number; spent: number; remaining: number };
  sheetUrl?: string; syncedAt?: Date | string | number; category?: string;
} & BudgetExtras): Card {
  const { rows, totals } = input;
  const pct = (r: BudgetRow) => (r.allocated ? Math.round((r.spent / r.allocated) * 100) : 0);
  const blocks: Block[] = [];
  if (!rows.length) {
    blocks.push(text(input.category ? `No budget line named **${input.category}**.` : "No budget lines yet. Run `/budget` after syncing the sheet."));
  } else {
    const donut = rows.length === 1
      ? [{ label: `${rows[0]!.category} spent`, value: rows[0]!.spent, color: thresholdColor(pct(rows[0]!), AGENT_COLORS.finance) }]
      : rows.map((r, i) => ({ label: r.category, value: r.spent, color: SERIES[i % SERIES.length] }));
    blocks.push({
      kind: "gallery",
      items: [
        {
          name: "budget-donut", alt: `${fmtMoney(totals.spent)} of ${fmtMoney(totals.allocated)} spent`,
          chart: { type: "donut", segments: [...donut, { label: "Remaining", value: Math.max(0, totals.remaining), color: CHART.grid }], center: { value: fmtMoney(totals.spent), label: `of ${fmtMoney(totals.allocated)}` } },
        },
      ],
    });
    blocks.push({
      kind: "chart", name: "budget-bars", alt: rows.map((r) => `${r.category} ${pct(r)}%`).join(", "),
      spec: { type: "bars", rows: rows.map((r) => ({ label: r.category, value: r.spent, max: r.allocated, valueLabel: `${fmtMoney(r.spent)} / ${fmtMoney(r.allocated)}` })) },
    });
    const hot = rows.filter((r) => pct(r) > 80);
    blocks.push(kv([["Allocated", fmtMoney(totals.allocated)], ["Spent", fmtMoney(totals.spent)], ["Remaining", `**${fmtMoney(totals.remaining)}**`]]));
    // Money in and money owed, only on the full overview (the category view stays focused).
    if (!input.category && input.income) {
      blocks.push(kv([
        ["Income received", fmtMoney(input.income.received)],
        ["Pledged / invoiced", fmtMoney(input.income.pledged)],
        ["Net position", `**${fmtMoney(input.net ?? input.income.received - totals.spent)}**`],
      ]));
    }
    if (!input.category && input.reimbursementsOwed?.total) {
      const who = input.reimbursementsOwed.byPerson.map((p) => `${p.paidBy} ${fmtMoney(p.amount)}`).join(" · ");
      blocks.push(text(`💸 **${fmtMoney(input.reimbursementsOwed.total)}** owed to people who paid out of pocket: ${who}`));
    }
    if (hot.length) blocks.push(text(hot.map((r) => `${pct(r) > 95 ? "🔴" : "🟠"} **${r.category}** is at ${pct(r)}% (${fmtMoney(r.allocated - r.spent)} left)`).join("\n")));
  }
  return {
    accent: AGENT_COLORS.finance,
    title: input.category ? `Budget · ${input.category}` : "Budget",
    subtitle: `${fmtMoney(totals.spent)} of ${fmtMoney(totals.allocated)} spent · ${fmtMoney(totals.remaining)} left`,
    blocks,
    actions: input.sheetUrl ? [[{ kind: "link", url: input.sheetUrl, label: "Open sheet" }]] : undefined,
    footer: input.syncedAt ? `mirror of the budget sheet · synced ${ts(input.syncedAt)}` : "mirror of the budget sheet",
  };
}
