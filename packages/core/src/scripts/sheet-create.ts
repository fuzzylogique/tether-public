/** Creates the org Google Sheet (Budget, Expenses, Sponsors, Tasks) from the mirror and binds it + the primary calendar to the org. `pnpm sheet:create` */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { orgs, budgetLines, expenses, sponsors, tasks } from "../db/schema.js";
import { sheetsApi, calendarApi } from "../google/client.js";

const guildId = process.env.DISCORD_DEV_GUILD_ID!;
const d = db();
const [org] = await d.select().from(orgs).where(eq(orgs.guildId, guildId));
if (!org) throw new Error("org not seeded");

const sheets = sheetsApi();
let sheetId = org.sheetId;
if (!sheetId) {
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `${org.name} · Tether` },
      sheets: ["Budget", "Expenses", "Sponsors", "Tasks"].map((title) => ({ properties: { title } })),
    },
  });
  sheetId = created.data.spreadsheetId!;
  console.log("created sheet", created.data.spreadsheetUrl);
}

const b = await d.select().from(budgetLines).where(eq(budgetLines.orgId, org.id));
const e = await d.select().from(expenses).where(eq(expenses.orgId, org.id));
const s = await d.select().from(sponsors).where(eq(sponsors.orgId, org.id));
const t = await d.select().from(tasks).where(eq(tasks.orgId, org.id));

await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: sheetId,
  requestBody: {
    valueInputOption: "USER_ENTERED",
    data: [
      { range: "Budget!A1", values: [["Category", "Allocated"], ...b.map((x) => [x.category, Number(x.allocated)])] },
      { range: "Expenses!A1", values: [["Date", "Category", "Amount", "Vendor", "Description", "Receipt", "Logged by"], ...e.map((x) => [x.date ?? "", x.category, Number(x.amount), x.vendor ?? "", x.description ?? "", x.receiptUrl ?? "", ""])] },
      { range: "Sponsors!A1", values: [["Name", "Contact", "Email", "Stage", "Amount", "Tier", "Last contact", "Notes"], ...s.map((x) => [x.name, x.contactName ?? "", x.contactEmail ?? "", x.stage, x.amount ? Number(x.amount) : "", x.tier ?? "", x.lastContactAt?.toISOString().slice(0, 10) ?? "", x.notes ?? ""])] },
      { range: "Tasks!A1", values: [["Title", "Owner", "Due", "Status"], ...t.map((x) => [x.title, x.ownerName ?? "", x.dueAt?.toISOString() ?? "", x.status])] },
    ],
  },
});

// bold header rows
const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: sheetId,
  requestBody: {
    requests: (meta.data.sheets ?? []).map((sh) => ({
      repeatCell: {
        range: { sheetId: sh.properties!.sheetId!, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.92, blue: 1 } } },
        fields: "userEnteredFormat(textFormat,backgroundColor)",
      },
    })),
  },
});

// sheet rows back-reference (row i+2)
for (const [i, x] of b.entries()) await d.update(budgetLines).set({ sheetRow: i + 2 }).where(eq(budgetLines.id, x.id));
for (const [i, x] of e.entries()) await d.update(expenses).set({ sheetRow: i + 2 }).where(eq(expenses.id, x.id));
for (const [i, x] of s.entries()) await d.update(sponsors).set({ sheetRow: i + 2 }).where(eq(sponsors.id, x.id));

let calendarId = org.calendarId;
if (!calendarId) {
  const cal = await calendarApi().calendarList.list();
  calendarId = (cal.data.items ?? []).find((c) => c.primary)?.id ?? "primary";
}
await d.update(orgs).set({ sheetId, calendarId }).where(eq(orgs.id, org.id));
console.log(`org bound: sheet ${sheetId} · calendar ${calendarId}`);
process.exit(0);
