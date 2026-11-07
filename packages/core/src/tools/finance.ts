import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { defineTool } from "./types.js";
import { budgetLines, expenses } from "../db/schema.js";
import { appendRow, clearRow, readRange } from "../google/sheets.js";
import { fetchAsInlineData, generateStructuredMultimodal } from "../runtime/gemini.js";

export const budgetSummary = defineTool({
  name: "budget_summary",
  description: "Return allocated vs spent per budget category and overall totals, from the mirror.",
  input: z.object({ category: z.string().optional().describe("Limit to one category") }),
  effect: "read", risk: "low",
  summarize: (a) => `Budget summary${a.category ? ` for ${a.category}` : ""}`,
  async execute(args, ctx) {
    const lines = await ctx.db.select().from(budgetLines).where(eq(budgetLines.orgId, ctx.org.id));
    const spent = await ctx.db
      .select({ category: expenses.category, total: sql<string>`coalesce(sum(${expenses.amount}),0)` })
      .from(expenses).where(eq(expenses.orgId, ctx.org.id)).groupBy(expenses.category);
    const spentBy = Object.fromEntries(spent.map((s) => [s.category, Number(s.total)]));
    const rows = lines
      .filter((l) => !args.category || l.category.toLowerCase() === args.category.toLowerCase())
      .map((l) => {
        const allocated = Number(l.allocated);
        const used = spentBy[l.category] ?? 0;
        return { category: l.category, allocated, spent: used, remaining: allocated - used, pctUsed: allocated ? Math.round((used / allocated) * 100) : 0 };
      });
    const totals = rows.reduce((t, r) => ({ allocated: t.allocated + r.allocated, spent: t.spent + r.spent }), { allocated: 0, spent: 0 });
    return { rows, totals: { ...totals, remaining: totals.allocated - totals.spent } };
  },
});

export const logExpense = defineTool({
  name: "log_expense",
  description: "Append an expense to the Expenses sheet tab and the mirror. Use after confirming category and amount.",
  input: z.object({
    category: z.string(),
    amount: z.number().positive(),
    vendor: z.string().optional(),
    description: z.string().optional(),
    date: z.string().describe("ISO date YYYY-MM-DD").optional(),
    receiptUrl: z.string().url().optional(),
  }),
  effect: "write", risk: "medium",
  summarize: (a) => `Log $${a.amount.toFixed(2)} to ${a.category}${a.vendor ? ` (${a.vendor})` : ""}`,
  async execute(args, ctx) {
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    let sheetRow: number | undefined;
    if (ctx.org.sheetId) {
      const r = await appendRow(ctx.org.sheetId, "Expenses", [date, args.category, args.amount, args.vendor ?? "", args.description ?? "", args.receiptUrl ?? "", ctx.actor.name ?? ""]);
      sheetRow = r.row;
    }
    const [row] = await ctx.db.insert(expenses).values({
      orgId: ctx.org.id, category: args.category, amount: args.amount.toFixed(2), vendor: args.vendor,
      description: args.description, date, receiptUrl: args.receiptUrl, sheetRow, loggedByDiscordId: ctx.actor.discordId,
    }).returning();
    return { expenseId: row!.id, sheetRow };
  },
  async undo(_args, result, ctx) {
    await ctx.db.delete(expenses).where(eq(expenses.id, result.expenseId));
    if (ctx.org.sheetId && result.sheetRow) await clearRow(ctx.org.sheetId, "Expenses", result.sheetRow);
  },
});

const receiptSchema = z.object({
  vendor: z.string(),
  total: z.number(),
  date: z.string().describe("ISO date if visible, else empty"),
  currency: z.string().default("CAD"),
  items: z.array(z.object({ name: z.string(), amount: z.number() })).default([]),
  suggestedCategory: z.string().describe("One of the org budget categories if obvious, else best guess"),
});

export const parseReceipt = defineTool({
  name: "parse_receipt",
  description: "Read a receipt image attached to the message (or at a URL) and extract vendor, total, date, and line items.",
  input: z.object({ imageUrl: z.string().url().optional().describe("Defaults to the first image attachment") }),
  effect: "read", risk: "low",
  summarize: () => "Parse receipt image",
  async execute(args, ctx) {
    const url = args.imageUrl ?? ctx.attachments?.find((a) => a.contentType?.startsWith("image/"))?.url;
    if (!url) return { error: "No receipt image attached" };
    const part = await fetchAsInlineData(url);
    const categories = (await ctx.db.select({ c: budgetLines.category }).from(budgetLines).where(eq(budgetLines.orgId, ctx.org.id))).map((r) => r.c);
    const parsed = await generateStructuredMultimodal({
      system: "You extract structured data from receipts. Be exact with the total.",
      parts: [part, { text: `Budget categories: ${categories.join(", ")}. Extract the receipt.` }],
      schema: receiptSchema,
    });
    return { ...parsed, receiptUrl: url };
  },
});

export const syncBudgetFromSheet = defineTool({
  name: "sync_budget_from_sheet",
  description: "Refresh the budget mirror from the Budget and Expenses tabs of the org sheet.",
  input: z.object({}),
  effect: "write", risk: "low",
  summarize: () => "Sync budget from sheet",
  async execute(_args, ctx) {
    if (!ctx.org.sheetId) return { synced: false, reason: "no sheet configured" };
    const budget = await readRange(ctx.org.sheetId, "Budget!A2:B");
    await ctx.db.delete(budgetLines).where(eq(budgetLines.orgId, ctx.org.id));
    for (const [i, r] of budget.entries()) {
      if (!r[0]) continue;
      await ctx.db.insert(budgetLines).values({ orgId: ctx.org.id, category: r[0], allocated: String(Number(r[1] ?? 0)), sheetRow: i + 2 });
    }
    const ex = await readRange(ctx.org.sheetId, "Expenses!A2:G");
    await ctx.db.delete(expenses).where(and(eq(expenses.orgId, ctx.org.id), sql`${expenses.sheetRow} is not null`));
    for (const [i, r] of ex.entries()) {
      if (!r[1]) continue;
      await ctx.db.insert(expenses).values({
        orgId: ctx.org.id, date: r[0], category: r[1]!, amount: String(Number(r[2] ?? 0)), vendor: r[3], description: r[4], receiptUrl: r[5] || undefined, sheetRow: i + 2,
      });
    }
    return { synced: true, budgetLines: budget.length, expenses: ex.length };
  },
});

export const financeTools = [budgetSummary, logExpense, parseReceipt, syncBudgetFromSheet];
