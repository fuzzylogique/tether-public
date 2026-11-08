import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { defineTool } from "./types.js";
import { budgetLines, expenses, income, sponsors, type IncomeStatus, type ReimbursementStatus } from "../db/schema.js";
import { appendRow, clearRow, readRange, updateRange } from "../google/sheets.js";
import { generateStructuredMultimodal } from "../runtime/gemini.js";
import { uploadObject } from "../storage.js";
import { extensionFor, fetchTrustedMedia } from "../media.js";

// Sheet layout (columns are appended, never reordered, so older sheets keep working):
//   Budget   A Category | B Allocated
//   Expenses A Date | B Category | C Amount | D Vendor | E Description | F Receipt | G Logged by | H Tax | I Paid by | J Reimbursement
//   Income   A Date | B Source | C Amount | D Status | E Notes
//   Summary  formulas only; written by `pnpm sheet:create`
export const EXPENSE_COLUMNS = ["Date", "Category", "Amount", "Vendor", "Description", "Receipt", "Logged by", "Tax", "Paid by", "Reimbursement"] as const;
export const INCOME_COLUMNS = ["Date", "Source", "Amount", "Status", "Notes"] as const;
const REIMBURSEMENT_COL = "J";

const reimbursementStatus = z.enum(["none", "pending", "paid"]);
const incomeStatus = z.enum(["pledged", "invoiced", "received"]);
const today = () => new Date().toISOString().slice(0, 10);

/** "$1,234.50" → 1234.5; blank → 0; garbage → NaN (callers validate before writing the mirror). */
function money(raw: string | undefined): number {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  return Number(s.replace(/[^0-9.-]/g, ""));
}

export const budgetSummary = defineTool({
  name: "budget_summary",
  description: "Allocated vs spent per budget category, plus income received and pledged, net position, HST paid, and reimbursements still owed to people who paid out of pocket. Reads the mirror.",
  input: z.object({ category: z.string().optional().describe("Limit the category rows to one category") }),
  effect: "read", risk: "low",
  summarize: (a) => `Budget summary${a.category ? ` for ${a.category}` : ""}`,
  async execute(args, ctx) {
    const orgId = ctx.org.id;
    const lines = await ctx.db.select().from(budgetLines).where(eq(budgetLines.orgId, orgId));
    const spent = await ctx.db
      .select({ category: expenses.category, total: sql<string>`coalesce(sum(${expenses.amount}),0)`, tax: sql<string>`coalesce(sum(${expenses.tax}),0)` })
      .from(expenses).where(eq(expenses.orgId, orgId)).groupBy(expenses.category);
    const spentBy = Object.fromEntries(spent.map((s) => [s.category, Number(s.total)]));
    const rows = lines
      .filter((l) => !args.category || l.category.toLowerCase() === args.category.toLowerCase())
      .map((l) => {
        const allocated = Number(l.allocated);
        const used = spentBy[l.category] ?? 0;
        return { category: l.category, allocated, spent: used, remaining: allocated - used, pctUsed: allocated ? Math.round((used / allocated) * 100) : 0 };
      });
    const totals = rows.reduce((t, r) => ({ allocated: t.allocated + r.allocated, spent: t.spent + r.spent }), { allocated: 0, spent: 0 });

    const [inc] = await ctx.db
      .select({
        received: sql<string>`coalesce(sum(case when ${income.status} = 'received' then ${income.amount} end),0)`,
        pledged: sql<string>`coalesce(sum(case when ${income.status} <> 'received' then ${income.amount} end),0)`,
      })
      .from(income).where(eq(income.orgId, orgId));
    const owed = await ctx.db
      .select({ paidBy: expenses.paidBy, total: sql<string>`sum(${expenses.amount})`, count: sql<string>`count(*)` })
      .from(expenses).where(and(eq(expenses.orgId, orgId), eq(expenses.reimbursement, "pending"))).groupBy(expenses.paidBy);
    const allSpent = spent.reduce((t, s) => t + Number(s.total), 0);
    const received = Number(inc?.received ?? 0);
    const pledged = Number(inc?.pledged ?? 0);

    return {
      rows,
      totals: { ...totals, remaining: totals.allocated - totals.spent },
      income: { received, pledged, total: received + pledged },
      // Cash actually in hand minus everything spent so far (all categories, not just the filtered rows).
      net: received - allSpent,
      taxPaid: spent.reduce((t, s) => t + Number(s.tax), 0),
      reimbursementsOwed: {
        total: owed.reduce((t, o) => t + Number(o.total), 0),
        byPerson: owed.map((o) => ({ paidBy: o.paidBy ?? "unknown", amount: Number(o.total), count: Number(o.count) })),
      },
    };
  },
});

export const logExpense = defineTool({
  name: "log_expense",
  description: "Append an expense to the Expenses sheet tab and the mirror. amount is the total paid including tax. Set paidBy when a person paid out of pocket so the reimbursement is tracked.",
  input: z.object({
    category: z.string(),
    amount: z.number().positive().describe("Total paid, tax included"),
    tax: z.number().min(0).optional().describe("Tax portion of the total (HST), if known"),
    vendor: z.string().optional(),
    description: z.string().optional(),
    date: z.string().describe("ISO date YYYY-MM-DD").optional(),
    receiptUrl: z.string().url().optional(),
    paidBy: z.string().optional().describe("Person who paid out of pocket and needs to be reimbursed; omit when paid from the org account"),
  }),
  effect: "write", risk: "medium",
  editFields: [
    { key: "amount", label: "Amount (total, tax included)", style: "short", required: true }, { key: "category", label: "Category", style: "short", required: true },
    { key: "vendor", label: "Vendor", style: "short" }, { key: "description", label: "Note", style: "paragraph" }, { key: "paidBy", label: "Paid by (reimbursement)", style: "short" },
  ],
  summarize: (a) => `Log $${a.amount.toFixed(2)} to ${a.category}${a.vendor ? ` (${a.vendor})` : ""}${a.paidBy ? `, paid by ${a.paidBy}` : ""}`,
  async execute(args, ctx) {
    const date = args.date ?? today();
    const reimbursement: ReimbursementStatus = args.paidBy ? "pending" : "none";
    let sheetRow: number | undefined;
    if (ctx.org.sheetId) {
      const r = await appendRow(ctx.org.sheetId, "Expenses", [
        date, args.category, args.amount, args.vendor ?? "", args.description ?? "", args.receiptUrl ?? "", ctx.actor.name ?? "",
        args.tax ?? "", args.paidBy ?? "", reimbursement === "none" ? "" : reimbursement,
      ]);
      sheetRow = r.row;
    }
    const [row] = await ctx.db.insert(expenses).values({
      orgId: ctx.org.id, category: args.category, amount: args.amount.toFixed(2), tax: args.tax != null ? args.tax.toFixed(2) : undefined,
      vendor: args.vendor, description: args.description, date, receiptUrl: args.receiptUrl, paidBy: args.paidBy, reimbursement,
      sheetRow, loggedByDiscordId: ctx.actor.discordId,
    }).returning();
    return { expenseId: row!.id, sheetRow, reimbursement };
  },
  async undo(_args, result, ctx) {
    await ctx.db.delete(expenses).where(eq(expenses.id, result.expenseId));
    if (ctx.org.sheetId && result.sheetRow) await clearRow(ctx.org.sheetId, "Expenses", result.sheetRow);
  },
});

export const logIncome = defineTool({
  name: "log_income",
  description: "Record money coming in (a sponsorship payment, club funding, ticket sales) on the Income sheet tab and the mirror. Use this, not log_expense, when a sponsor pays or commits an amount.",
  input: z.object({
    source: z.string().describe("Where the money is from, e.g. 'Shopify sponsorship' or 'Student union grant'"),
    amount: z.number().positive(),
    status: incomeStatus.default("pledged").describe("pledged = promised, invoiced = invoice sent, received = money in the account"),
    date: z.string().describe("ISO date YYYY-MM-DD").optional(),
    notes: z.string().optional(),
    sponsorName: z.string().optional().describe("Sponsor name from the pipeline, to link the payment to that sponsor"),
  }),
  effect: "write", risk: "medium",
  summarize: (a) => `Record ${a.status} income $${a.amount.toFixed(2)} from ${a.source}`,
  async execute(args, ctx) {
    const date = args.date ?? today();
    let sponsorId: string | undefined;
    if (args.sponsorName) {
      const [s] = await ctx.db.select({ id: sponsors.id }).from(sponsors)
        .where(and(eq(sponsors.orgId, ctx.org.id), sql`lower(${sponsors.name}) = lower(${args.sponsorName})`));
      sponsorId = s?.id;
    }
    let sheetRow: number | undefined;
    if (ctx.org.sheetId) {
      const r = await appendRow(ctx.org.sheetId, "Income", [date, args.source, args.amount, args.status, args.notes ?? ""]);
      sheetRow = r.row;
    }
    const [row] = await ctx.db.insert(income).values({
      orgId: ctx.org.id, source: args.source, sponsorId, amount: args.amount.toFixed(2), status: args.status, date, notes: args.notes,
      sheetRow, loggedByDiscordId: ctx.actor.discordId,
    }).returning();
    return { incomeId: row!.id, sheetRow, linkedSponsor: Boolean(sponsorId) };
  },
  async undo(_args, result, ctx) {
    await ctx.db.delete(income).where(eq(income.id, result.incomeId));
    if (ctx.org.sheetId && result.sheetRow) await clearRow(ctx.org.sheetId, "Income", result.sheetRow);
  },
});

export const markReimbursed = defineTool({
  name: "mark_reimbursed",
  description: "Mark pending out-of-pocket expenses as reimbursed (e-transfer sent). Matches by the person's name; narrow with vendor or amount when they have several pending.",
  input: z.object({
    paidBy: z.string().describe("Person who was reimbursed, as recorded on the expense"),
    vendor: z.string().optional(),
    amount: z.number().positive().optional().describe("Only the expense with this exact total"),
  }),
  effect: "write", risk: "medium",
  summarize: (a) => `Mark ${a.paidBy}'s ${a.vendor ?? a.amount != null ? `${a.vendor ?? ""}${a.amount != null ? ` $${a.amount.toFixed(2)}` : ""}`.trim() : "pending"} expenses reimbursed`,
  async execute(args, ctx) {
    const pending = (await ctx.db.select().from(expenses)
      .where(and(eq(expenses.orgId, ctx.org.id), eq(expenses.reimbursement, "pending"), sql`lower(${expenses.paidBy}) = lower(${args.paidBy})`)))
      .filter((e) => !args.vendor || (e.vendor ?? "").toLowerCase() === args.vendor.toLowerCase())
      .filter((e) => args.amount == null || Number(e.amount) === args.amount);
    if (!pending.length) return { updated: 0, note: `No pending reimbursements for ${args.paidBy}` };
    for (const e of pending) {
      await ctx.db.update(expenses).set({ reimbursement: "paid" }).where(eq(expenses.id, e.id));
      if (ctx.org.sheetId && e.sheetRow) await updateRange(ctx.org.sheetId, `Expenses!${REIMBURSEMENT_COL}${e.sheetRow}`, [["paid"]]);
    }
    return { updated: pending.length, total: pending.reduce((t, e) => t + Number(e.amount), 0), expenseIds: pending.map((e) => e.id) };
  },
  async undo(_args, result, ctx) {
    for (const id of result.expenseIds ?? []) {
      const [e] = await ctx.db.update(expenses).set({ reimbursement: "pending" }).where(eq(expenses.id, id)).returning();
      if (ctx.org.sheetId && e?.sheetRow) await updateRange(ctx.org.sheetId, `Expenses!${REIMBURSEMENT_COL}${e.sheetRow}`, [["pending"]]);
    }
  },
});

const receiptSchema = z.object({
  vendor: z.string(),
  total: z.number().describe("Grand total paid, tax included"),
  tax: z.number().default(0).describe("Tax line (HST/GST/PST) if printed, else 0"),
  date: z.string().describe("ISO date if visible, else empty"),
  currency: z.string().default("CAD"),
  paymentMethod: z.string().default("").describe("Card / cash / e-transfer and last 4 digits if printed, else empty"),
  items: z.array(z.object({ name: z.string(), amount: z.number() })).default([]),
  suggestedCategory: z.string().describe("One of the org budget categories if obvious, else best guess"),
});

export const parseReceipt = defineTool({
  name: "parse_receipt",
  description: "Read the receipt image attached to the message, extract vendor, total, tax, date and line items, and keep a durable copy of the image. Pass the returned receiptUrl (and tax) to log_expense.",
  input: z.object({ imageUrl: z.string().url().optional().describe("Defaults to the first image attachment; must be a Discord attachment URL") }),
  effect: "read", risk: "low",
  summarize: () => "Parse receipt image",
  async execute(args, ctx) {
    const att = ctx.attachments?.find((a) => a.contentType?.startsWith("image/"));
    const url = args.imageUrl ?? att?.url;
    if (!url) return { error: "No receipt image attached" };
    // Receipt bytes come from the Discord CDN (or our own bucket), never from an arbitrary URL the model chose.
    const fetched = await fetchTrustedMedia(url, { mimeHint: att?.contentType });
    if ("error" in fetched) return fetched;
    const { buf, mimeType } = fetched;

    // Discord CDN links are signed and expire within hours, so the sheet would end up with dead links.
    // Store a copy in Vultr Object Storage when it is configured; otherwise keep the original URL.
    let stored: string | undefined;
    try {
      stored = await uploadObject(`receipts/${ctx.org.id}/${Date.now()}.${extensionFor(mimeType)}`, buf, mimeType);
    } catch (e) {
      console.warn("[parse_receipt] object storage upload failed, keeping Discord URL:", e instanceof Error ? e.message : e);
    }

    const categories = (await ctx.db.select({ c: budgetLines.category }).from(budgetLines).where(eq(budgetLines.orgId, ctx.org.id))).map((r) => r.c);
    const parsed = await generateStructuredMultimodal({
      system: "You extract structured data from receipts. Be exact with the total and the tax line.",
      parts: [{ inlineData: { mimeType, data: buf.toString("base64") } }, { text: `Budget categories: ${categories.join(", ")}. Extract the receipt.` }],
      schema: receiptSchema,
    });
    return { ...parsed, receiptUrl: stored ?? url, receiptStorage: stored ? "vultr-object-storage" : "discord-cdn" };
  },
});

export const syncBudgetFromSheet = defineTool({
  name: "sync_budget_from_sheet",
  description: "Refresh the budget mirror from the Budget, Expenses and Income tabs of the org sheet. Rows are validated before anything is replaced; a bad cell aborts the sync and leaves the mirror untouched.",
  input: z.object({}),
  effect: "write", risk: "medium",
  summarize: () => "Sync budget from sheet",
  async execute(_args, ctx) {
    const sheetId = ctx.org.sheetId;
    if (!sheetId) return { synced: false, reason: "no sheet configured" };
    const orgId = ctx.org.id;
    const [budgetRaw, expenseRaw, incomeRaw] = await Promise.all([
      readRange(sheetId, "Budget!A2:B"),
      readRange(sheetId, `Expenses!A2:${String.fromCharCode(64 + EXPENSE_COLUMNS.length)}`),
      readRange(sheetId, `Income!A2:${String.fromCharCode(64 + INCOME_COLUMNS.length)}`).catch(() => [] as string[][]), // older sheets have no Income tab
    ]);

    const problems: string[] = [];
    const budgetRows = budgetRaw.flatMap((r, i) => {
      if (!r[0]) return [];
      const allocated = money(r[1]);
      if (!Number.isFinite(allocated)) problems.push(`Budget row ${i + 2}: allocated "${r[1]}" is not a number`);
      return [{ orgId, category: r[0], allocated: allocated.toFixed(2), sheetRow: i + 2 }];
    });
    const expenseRows = expenseRaw.flatMap((r, i) => {
      if (!r[1]) return [];
      const amount = money(r[2]);
      const tax = r[7] ? money(r[7]) : undefined;
      if (!Number.isFinite(amount)) problems.push(`Expenses row ${i + 2}: amount "${r[2]}" is not a number`);
      if (tax != null && !Number.isFinite(tax)) problems.push(`Expenses row ${i + 2}: tax "${r[7]}" is not a number`);
      const reimb = (r[9] ?? "").trim().toLowerCase();
      if (reimb && !reimbursementStatus.options.includes(reimb as ReimbursementStatus)) problems.push(`Expenses row ${i + 2}: reimbursement "${r[9]}" must be pending or paid`);
      return [{
        orgId, date: r[0] || undefined, category: r[1]!, amount: amount.toFixed(2), vendor: r[3] || undefined, description: r[4] || undefined,
        receiptUrl: r[5] || undefined, tax: tax != null ? tax.toFixed(2) : undefined, paidBy: r[8] || undefined,
        reimbursement: (reimb || "none") as ReimbursementStatus, sheetRow: i + 2,
      }];
    });
    const incomeRows = incomeRaw.flatMap((r, i) => {
      if (!r[1]) return [];
      const amount = money(r[2]);
      if (!Number.isFinite(amount)) problems.push(`Income row ${i + 2}: amount "${r[2]}" is not a number`);
      const status = (r[3] ?? "").trim().toLowerCase() || "pledged";
      if (!incomeStatus.options.includes(status as IncomeStatus)) problems.push(`Income row ${i + 2}: status "${r[3]}" must be pledged, invoiced or received`);
      return [{ orgId, date: r[0] || undefined, source: r[1]!, amount: amount.toFixed(2), status: status as IncomeStatus, notes: r[4] || undefined, sheetRow: i + 2 }];
    });
    if (problems.length) return { synced: false, reason: "sheet has invalid cells; mirror left unchanged", problems };
    if (!budgetRows.length) return { synced: false, reason: "Budget tab is empty; refusing to wipe the mirror" };

    // One transaction: a failure half-way can never leave the mirror empty.
    await ctx.db.transaction(async (tx) => {
      await tx.delete(budgetLines).where(eq(budgetLines.orgId, orgId));
      await tx.insert(budgetLines).values(budgetRows);
      // Rows the bot logged without a sheet (sheetRow null) are kept; everything mirrored from the sheet is replaced.
      await tx.delete(expenses).where(and(eq(expenses.orgId, orgId), sql`${expenses.sheetRow} is not null`));
      if (expenseRows.length) await tx.insert(expenses).values(expenseRows);
      await tx.delete(income).where(and(eq(income.orgId, orgId), sql`${income.sheetRow} is not null`));
      if (incomeRows.length) await tx.insert(income).values(incomeRows);
    });
    return { synced: true, budgetLines: budgetRows.length, expenses: expenseRows.length, income: incomeRows.length };
  },
});

export const financeTools = [budgetSummary, logExpense, logIncome, markReimbursed, parseReceipt, syncBudgetFromSheet];
