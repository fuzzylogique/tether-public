/**
 * Creates or upgrades the org Google Sheet from the mirror and binds it (plus the primary calendar) to the org.
 * Tabs: Budget, Expenses, Income, Sponsors, Tasks, Summary. Safe to re-run against an existing sheet: missing
 * tabs are added, headers and the Summary formulas are rewritten, and the data tabs are refilled from the mirror.
 * `pnpm sheet:create`
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { eq } from "drizzle-orm";
import type { sheets_v4 } from "googleapis";
import { db } from "../db/client.js";
import { orgs, budgetLines, expenses, income, sponsors, tasks } from "../db/schema.js";
import { sheetsApi, calendarApi } from "../google/client.js";
import { EXPENSE_COLUMNS, INCOME_COLUMNS } from "../tools/finance.js";

const TABS = ["Budget", "Expenses", "Income", "Sponsors", "Tasks", "Summary"] as const;
const CURRENCY: sheets_v4.Schema$NumberFormat = { type: "CURRENCY", pattern: '"$"#,##0.00' };
const PERCENT: sheets_v4.Schema$NumberFormat = { type: "PERCENT", pattern: "0%" };

const guildId = process.env.DISCORD_DEV_GUILD_ID!;
const d = db();
const [org] = await d.select().from(orgs).where(eq(orgs.guildId, guildId));
if (!org) throw new Error("org not seeded");

const sheets = sheetsApi();
let sheetId = org.sheetId;
if (!sheetId) {
  const created = await sheets.spreadsheets.create({
    requestBody: { properties: { title: `${org.name} · Tether` }, sheets: TABS.map((title) => ({ properties: { title } })) },
  });
  sheetId = created.data.spreadsheetId!;
  console.log("created sheet", created.data.spreadsheetUrl);
}

// Older sheets predate Income and Summary: add whatever is missing.
let meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
const have = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));
const missing = TABS.filter((t) => !have.has(t));
if (missing.length) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) } });
  console.log("added tabs", missing.join(", "));
  meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
}
const tabId = (title: string) => meta.data.sheets!.find((s) => s.properties?.title === title)!.properties!.sheetId!;

const b = await d.select().from(budgetLines).where(eq(budgetLines.orgId, org.id));
const e = await d.select().from(expenses).where(eq(expenses.orgId, org.id));
const inc = await d.select().from(income).where(eq(income.orgId, org.id));
const s = await d.select().from(sponsors).where(eq(sponsors.orgId, org.id));
const t = await d.select().from(tasks).where(eq(tasks.orgId, org.id));
const num = (v: string | null | undefined) => (v == null || v === "" ? "" : Number(v));

// Summary is formulas only, so it stays live as organizers edit the other tabs by hand.
// Left block: one row per budget category (ARRAYFORMULA grows with the Budget tab). Right block: totals.
const summary: (string | number)[][] = [
  ["Category", "Allocated", "Spent", "Remaining", "% used", "", "Totals", ""],
  [
    '=ARRAYFORMULA(IF(Budget!A2:A="","",Budget!A2:A))',
    '=ARRAYFORMULA(IF(Budget!A2:A="","",Budget!B2:B))',
    '=ARRAYFORMULA(IF(Budget!A2:A="","",SUMIF(Expenses!B:B,Budget!A2:A,Expenses!C:C)))',
    '=ARRAYFORMULA(IF(Budget!A2:A="","",B2:B-C2:C))',
    '=ARRAYFORMULA(IF(Budget!A2:A="","",IF(B2:B=0,0,C2:C/B2:B)))',
    "", "Allocated", "=SUM(Budget!B:B)",
  ],
  ["", "", "", "", "", "", "Spent", "=SUM(Expenses!C:C)"],
  ["", "", "", "", "", "", "Remaining", "=H2-H3"],
  ["", "", "", "", "", "", "HST paid", "=SUM(Expenses!H:H)"],
  ["", "", "", "", "", "", "Income received", '=SUMIF(Income!D:D,"received",Income!C:C)'],
  ["", "", "", "", "", "", "Income pledged / invoiced", "=SUM(Income!C:C)-H6"],
  ["", "", "", "", "", "", "Net position (received − spent)", "=H6-H3"],
  ["", "", "", "", "", "", "Reimbursements owed", '=SUMIF(Expenses!J:J,"pending",Expenses!C:C)'],
  ["", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", '=IFERROR(QUERY(Expenses!A:J,"select I, sum(C) where J=\'pending\' and I<>\'\' group by I label sum(C) \'Owed\'",1),"No reimbursements pending")', ""],
];

await sheets.spreadsheets.values.batchClear({ spreadsheetId: sheetId, requestBody: { ranges: TABS.map((tab) => `${tab}!A:Z`) } });
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: sheetId,
  requestBody: {
    valueInputOption: "USER_ENTERED",
    data: [
      { range: "Budget!A1", values: [["Category", "Allocated"], ...b.map((x) => [x.category, Number(x.allocated)])] },
      { range: "Expenses!A1", values: [[...EXPENSE_COLUMNS], ...e.map((x) => [
        x.date ?? "", x.category, Number(x.amount), x.vendor ?? "", x.description ?? "", x.receiptUrl ?? "", "",
        num(x.tax), x.paidBy ?? "", x.reimbursement === "none" ? "" : x.reimbursement,
      ])] },
      { range: "Income!A1", values: [[...INCOME_COLUMNS], ...inc.map((x) => [x.date ?? "", x.source, Number(x.amount), x.status, x.notes ?? ""])] },
      { range: "Sponsors!A1", values: [["Name", "Contact", "Email", "Stage", "Amount", "Tier", "Last contact", "Notes"], ...s.map((x) => [x.name, x.contactName ?? "", x.contactEmail ?? "", x.stage, num(x.amount), x.tier ?? "", x.lastContactAt?.toISOString().slice(0, 10) ?? "", x.notes ?? ""])] },
      { range: "Tasks!A1", values: [["Title", "Owner", "Due", "Status"], ...t.map((x) => [x.title, x.ownerName ?? "", x.dueAt?.toISOString() ?? "", x.status])] },
      { range: "Summary!A1", values: summary },
    ],
  },
});

// Formatting: bold header rows everywhere, currency on money columns, percent on % used, wide label column on Summary.
const fmt = (title: string, startCol: number, endCol: number, numberFormat: sheets_v4.Schema$NumberFormat): sheets_v4.Schema$Request => ({
  repeatCell: {
    range: { sheetId: tabId(title), startRowIndex: 1, startColumnIndex: startCol, endColumnIndex: endCol },
    cell: { userEnteredFormat: { numberFormat } }, fields: "userEnteredFormat.numberFormat",
  },
});
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: sheetId,
  requestBody: {
    requests: [
      ...TABS.map((title): sheets_v4.Schema$Request => ({
        repeatCell: {
          range: { sheetId: tabId(title), startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.92, blue: 1 } } },
          fields: "userEnteredFormat(textFormat,backgroundColor)",
        },
      })),
      fmt("Budget", 1, 2, CURRENCY),
      fmt("Expenses", 2, 3, CURRENCY), fmt("Expenses", 7, 8, CURRENCY),
      fmt("Income", 2, 3, CURRENCY),
      fmt("Sponsors", 4, 5, CURRENCY),
      fmt("Summary", 1, 4, CURRENCY), fmt("Summary", 4, 5, PERCENT), fmt("Summary", 7, 8, CURRENCY),
      { updateDimensionProperties: { range: { sheetId: tabId("Summary"), dimension: "COLUMNS", startIndex: 6, endIndex: 7 }, properties: { pixelSize: 240 }, fields: "pixelSize" } },
    ],
  },
});

// sheet rows back-reference (row i+2)
for (const [i, x] of b.entries()) await d.update(budgetLines).set({ sheetRow: i + 2 }).where(eq(budgetLines.id, x.id));
for (const [i, x] of e.entries()) await d.update(expenses).set({ sheetRow: i + 2 }).where(eq(expenses.id, x.id));
for (const [i, x] of inc.entries()) await d.update(income).set({ sheetRow: i + 2 }).where(eq(income.id, x.id));
for (const [i, x] of s.entries()) await d.update(sponsors).set({ sheetRow: i + 2 }).where(eq(sponsors.id, x.id));

let calendarId = org.calendarId;
if (!calendarId) {
  const cal = await calendarApi().calendarList.list();
  calendarId = (cal.data.items ?? []).find((c) => c.primary)?.id ?? "primary";
}
await d.update(orgs).set({ sheetId, calendarId }).where(eq(orgs.id, org.id));
console.log(`org bound: sheet ${sheetId} · calendar ${calendarId} · https://docs.google.com/spreadsheets/d/${sheetId}`);
process.exit(0);
