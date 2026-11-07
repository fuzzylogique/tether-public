import { sheetsApi } from "./client.js";

export async function readRange(sheetId: string, range: string): Promise<string[][]> {
  const res = await sheetsApi().spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return (res.data.values ?? []) as string[][];
}

export async function appendRow(sheetId: string, tab: string, row: (string | number)[]) {
  const res = await sheetsApi().spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  const updated = res.data.updates?.updatedRange ?? "";
  const m = updated.match(/!A(\d+)/);
  return { range: updated, row: m?.[1] ? Number(m[1]) : undefined };
}

export async function updateRow(sheetId: string, tab: string, rowNumber: number, row: (string | number)[]) {
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tab}!A${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

export async function clearRow(sheetId: string, tab: string, rowNumber: number) {
  await sheetsApi().spreadsheets.values.clear({ spreadsheetId: sheetId, range: `${tab}!A${rowNumber}:Z${rowNumber}` });
}
