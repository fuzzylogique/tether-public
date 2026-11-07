/**
 * Makes the org's Google data visible to teammates who don't have the organizer's login. `pnpm google:share`
 * - Calendar: a dedicated team calendar (never the organizer's primary), readable by anyone with the link.
 *   Events Tether already created on the old calendar are moved over.
 * - Drive: a team folder, viewable by anyone with the link, holding the org sheet.
 * Idempotent: safe to re-run.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { calendarEvents, orgs } from "../db/schema.js";
import { calendarApi, driveApi } from "../google/client.js";
import { calendarIcsUrl, calendarUrl, driveFolderUrl, sheetUrl } from "../runtime/feed.js";

const guildId = process.env.DISCORD_DEV_GUILD_ID!;
const d = db();
const [org] = await d.select().from(orgs).where(eq(orgs.guildId, guildId));
if (!org) throw new Error("org not seeded");

// ---------- Calendar ----------
const cal = calendarApi();
const title = `${org.name} · Tether`;
const list = (await cal.calendarList.list()).data.items ?? [];
const primaryId = list.find((c) => c.primary)?.id;
let calendarId = org.calendarId;
if (!calendarId || calendarId === "primary" || calendarId === primaryId) {
  const existing = list.find((c) => c.summary === title);
  calendarId = existing?.id ?? (await cal.calendars.insert({ requestBody: { summary: title, timeZone: "America/Toronto", description: "Managed by Tether." } })).data.id!;
  console.log(`team calendar ${existing ? "found" : "created"}: ${calendarId}`);
  const from = org.calendarId === "primary" ? primaryId : org.calendarId;
  if (from) {
    const evs = await d.select().from(calendarEvents).where(eq(calendarEvents.orgId, org.id));
    for (const ev of evs) {
      if (!ev.googleEventId) continue;
      try {
        await cal.events.move({ calendarId: from, eventId: ev.googleEventId, destination: calendarId, sendUpdates: "none" });
        console.log(`moved event "${ev.title}"`);
      } catch (e) { console.warn(`could not move "${ev.title}": ${e instanceof Error ? e.message : e}`); }
    }
  }
}
const acl = (await cal.acl.list({ calendarId })).data.items ?? [];
if (!acl.some((r) => r.scope?.type === "default")) {
  await cal.acl.insert({ calendarId, requestBody: { role: "reader", scope: { type: "default" } } });
  console.log("calendar is now public (read-only)");
}

// ---------- Drive ----------
const drive = driveApi();
let driveFolderId = org.driveFolderId;
if (!driveFolderId) {
  driveFolderId = (await drive.files.create({ requestBody: { name: title, mimeType: "application/vnd.google-apps.folder" }, fields: "id" })).data.id!;
  console.log(`created drive folder ${driveFolderId}`);
}
const shareAnyone = async (fileId: string) => {
  const perms = (await drive.permissions.list({ fileId, fields: "permissions(type,role)" })).data.permissions ?? [];
  if (!perms.some((p) => p.type === "anyone")) await drive.permissions.create({ fileId, requestBody: { type: "anyone", role: "reader" } });
};
await shareAnyone(driveFolderId);
if (org.sheetId) {
  const sheet = (await drive.files.get({ fileId: org.sheetId, fields: "parents" })).data;
  if (!sheet.parents?.includes(driveFolderId)) {
    await drive.files.update({ fileId: org.sheetId, addParents: driveFolderId, removeParents: sheet.parents?.join(","), fields: "id" });
    console.log("moved sheet into team folder");
  }
  await shareAnyone(org.sheetId);
}

await d.update(orgs).set({ calendarId, driveFolderId }).where(eq(orgs.id, org.id));
console.log(`\ncalendar   ${calendarUrl(calendarId)}\nsubscribe  ${calendarIcsUrl(calendarId)}\nfolder     ${driveFolderUrl(driveFolderId)}${org.sheetId ? `\nsheet      ${sheetUrl(org.sheetId)}` : ""}`);
process.exit(0);
