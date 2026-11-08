import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { defineTool } from "./types.js";
import { db } from "../db/client.js";
import { events, orgs, users } from "../db/schema.js";
import { shareCalendar, shareDriveFile, type DriveAccess } from "../google/drive.js";
import { driveFolderUrl, TEAM_ROLES } from "../runtime/feed.js";

/**
 * Team access to the org's Google Drive folder (and the sheet inside it).
 * A lead approves one `request_drive_access` invite; it posts a button in #ops pinging the chosen roles or people.
 * Whoever is eligible presses it and types their email, and the share happens then with no second approval:
 * the approval covered "these people, this access". Invites live in the `events` log (kind `drive_invite`).
 */

const TEAM_KEYS = TEAM_ROLES.map((r) => r.key) as [string, ...string[]];
const INVITE_TTL_MS = 7 * 24 * 3600_000;
export const ACCESS_BUTTON_PREFIX = "access:share:";

type Invite = { inviteId: string; roleIds: string[]; discordIds: string[]; access: DriveAccess; folderId: string };

const access = z.enum(["writer", "reader"]).default("writer").describe("writer = can edit, reader = view only");

export const requestDriveAccess = defineTool({
  name: "request_drive_access",
  description: "Ask team members for their Google email and share the team Drive folder (budget sheet included) with each one as they answer. Posts a button in #ops pinging the chosen team roles and/or people. Use when someone asks to give a team access to the Drive, the sheet, or 'our files'.",
  input: z.object({
    teams: z.array(z.enum(TEAM_KEYS)).default([]).describe("Team roles to ask, e.g. ['lead', 'finance']"),
    discordIds: z.array(z.string()).default([]).describe("Specific people to ask, by Discord user id"),
    access,
    message: z.string().max(300).optional().describe("One friendly line on why, shown above the button"),
  }),
  effect: "external", risk: "high",
  summarize: (a) => `Ask ${[...a.teams.map((t) => `@${t}`), ...a.discordIds.map((id) => `<@${id}>`)].join(" ") || "nobody"} for emails and share the Drive folder (${a.access === "reader" ? "view" : "edit"})`,
  async execute(args, ctx) {
    const folderId = ctx.org.driveFolderId;
    if (!folderId) return { error: "No team Drive folder yet. Run `pnpm google:share` once to create it." };
    const channelId = ctx.org.channels["ops"];
    if (!channelId) return { error: "No ops channel configured. Run `/tether channels`." };
    const roleIds = args.teams.map((t) => ctx.org.roles[t]).filter((id): id is string => Boolean(id));
    const missing = args.teams.filter((t) => !ctx.org.roles[t]);
    if (!roleIds.length && !args.discordIds.length) return { error: `None of these teams has a Discord role yet (${missing.join(", ")}). Run \`/tether channels\` to create team roles, or name people instead.` };

    // Already have an email on file: share now, no need to ask.
    const known = args.discordIds.length
      ? await ctx.db.select().from(users).where(and(eq(users.orgId, ctx.org.id), inArray(users.discordId, args.discordIds), isNotNull(users.email)))
      : [];
    const sharedNow: string[] = [];
    for (const u of known) {
      await shareDriveFile(folderId, u.email!, args.access, `${ctx.org.name} team files, shared by Tether.`);
      if (args.access === "writer" && ctx.org.calendarId) await shareCalendar(ctx.org.calendarId, u.email!).catch(() => undefined);
      sharedNow.push(u.discordId!);
    }
    const toAsk = args.discordIds.filter((id) => !sharedNow.includes(id));
    if (!roleIds.length && !toAsk.length) return { sharedNow: sharedNow.length, asked: 0 };

    const invite: Invite = { inviteId: randomUUID(), roleIds, discordIds: toAsk, access: args.access, folderId };
    await ctx.db.insert(events).values({ orgId: ctx.org.id, runId: ctx.runId, kind: "drive_invite", agent: ctx.agent, data: { ...invite, teams: args.teams } });
    const mentions = [...roleIds.map((id) => `<@&${id}>`), ...toAsk.map((id) => `<@${id}>`)].join(" ");
    await ctx.notify.postToChannel({
      channelId,
      card: {
        accent: "#378ADD",
        title: "📁 Team Drive access",
        blocks: [{ kind: "text", md: `${mentions} ${args.message ?? `Tether can add you to the **${ctx.org.name}** Drive folder (budget sheet included).`}\nPress the button and enter the Google email you use. You get ${args.access === "reader" ? "view" : "edit"} access right away.` }],
        actions: [[{ kind: "button", id: `${ACCESS_BUTTON_PREFIX}${invite.inviteId}`, label: "Share my email", style: "primary", emoji: "📁" }]],
        footer: "Your email is only used to share Tether's team files.",
        ping: { roles: roleIds, users: toAsk },
      },
    });
    return { asked: roleIds.length + toAsk.length, sharedNow: sharedNow.length, ...(missing.length ? { teamsWithoutRole: missing } : {}) };
  },
});

export const shareDriveFolder = defineTool({
  name: "share_drive_folder",
  description: "Share the team Drive folder (budget sheet included) with specific email addresses, or with people whose email Tether already has. Prefer request_drive_access when you only know their Discord names.",
  input: z.object({
    emails: z.array(z.string().email()).default([]),
    discordIds: z.array(z.string()).default([]).describe("People whose email is already on file"),
    access,
  }),
  effect: "external", risk: "high",
  summarize: (a) => `Share the Drive folder (${a.access === "reader" ? "view" : "edit"}) with ${[...a.emails, ...a.discordIds.map((id) => `<@${id}>`)].join(", ")}`,
  async execute(args, ctx) {
    const folderId = ctx.org.driveFolderId;
    if (!folderId) return { error: "No team Drive folder yet. Run `pnpm google:share` once to create it." };
    const onFile = args.discordIds.length
      ? await ctx.db.select().from(users).where(and(eq(users.orgId, ctx.org.id), inArray(users.discordId, args.discordIds), isNotNull(users.email)))
      : [];
    const noEmail = args.discordIds.filter((id) => !onFile.some((u) => u.discordId === id));
    const emails = [...new Set([...args.emails, ...onFile.map((u) => u.email!)].map((e) => e.toLowerCase()))];
    const shared: string[] = [];
    const failed: string[] = [];
    for (const email of emails) {
      try {
        await shareDriveFile(folderId, email, args.access, `${ctx.org.name} team files, shared by Tether.`);
        if (args.access === "writer" && ctx.org.calendarId) await shareCalendar(ctx.org.calendarId, email).catch(() => undefined);
        shared.push(email);
      } catch (e) { failed.push(`${email}: ${e instanceof Error ? e.message : e}`); }
    }
    await ctx.db.insert(events).values({ orgId: ctx.org.id, runId: ctx.runId, kind: "drive_shared", agent: ctx.agent, data: { shared, access: args.access } });
    return { shared, folder: driveFolderUrl(folderId), ...(failed.length ? { failed } : {}), ...(noEmail.length ? { noEmailOnFile: noEmail, hint: "use request_drive_access for these" } : {}) };
  },
});

export const accessTools = [requestDriveAccess, shareDriveFolder];

// ---------- adapter entry point (button + modal) ----------

async function loadInvite(inviteId: string) {
  const [row] = await db().select().from(events)
    .where(and(eq(events.kind, "drive_invite"), sql`${events.data}->>'inviteId' = ${inviteId}`, gt(events.time, new Date(Date.now() - INVITE_TTL_MS))))
    .orderBy(desc(events.time)).limit(1);
  return row ? { orgId: row.orgId, invite: row.data as unknown as Invite } : undefined;
}

async function eligibleInvite(input: { inviteId: string; discordId: string; memberRoleIds: string[] }) {
  const found = await loadInvite(input.inviteId);
  if (!found) return { error: "This invite has expired. Ask a lead to send a new one." } as const;
  const { invite } = found;
  const eligible = invite.discordIds.includes(input.discordId) || invite.roleIds.some((id) => input.memberRoleIds.includes(id));
  if (!eligible) return { error: "This invite is for the people it mentions. Ask a lead if you need access." } as const;
  return found;
}

/** Whether this member may answer the invite, and the email Tether already has for them (to prefill the form). */
export async function driveInviteFor(input: { inviteId: string; discordId: string; memberRoleIds: string[] }) {
  const found = await eligibleInvite(input);
  if ("error" in found) return found;
  const [u] = await db().select().from(users).where(and(eq(users.orgId, found.orgId), eq(users.discordId, input.discordId)));
  return { ok: true, email: u?.email ?? undefined, access: found.invite.access } as const;
}

/** Save the member's email and share the folder with it. Eligibility is re-checked here; the button alone proves nothing. */
export async function acceptDriveInvite(input: { inviteId: string; discordId: string; name: string; memberRoleIds: string[]; email: string }) {
  const email = z.string().trim().toLowerCase().email().safeParse(input.email);
  if (!email.success) return { error: "That doesn't look like an email address." } as const;
  const found = await eligibleInvite(input);
  if ("error" in found) return found;
  const { invite, orgId } = found;
  const d = db();
  const [org] = await d.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) return { error: "Org not found." } as const;

  const [u] = await d.select().from(users).where(and(eq(users.orgId, orgId), eq(users.discordId, input.discordId)));
  if (u) await d.update(users).set({ email: email.data, name: u.name ?? input.name }).where(eq(users.id, u.id));
  // A new person's role follows the access the lead approved: edit access is organizer-level trust, view access is not.
  // The column default ("organizer") would otherwise give a view-only guest web settings and approval rights.
  else await d.insert(users).values({ orgId, discordId: input.discordId, name: input.name, email: email.data, roles: [invite.access === "writer" ? "organizer" : "volunteer"] });

  try {
    await shareDriveFile(invite.folderId, email.data, invite.access, `${org.name} team files, shared by Tether.`);
  } catch (e) {
    console.warn("[drive access] share failed", e instanceof Error ? e.message : e);
    return { error: "Google would not share with that address. Check it is the email of a Google account." } as const;
  }
  const calendar = invite.access === "writer" && org.calendarId
    ? await shareCalendar(org.calendarId, email.data).then(() => true, () => false)
    : false;
  await d.insert(events).values({ orgId, kind: "drive_shared", agent: "coordination", data: { inviteId: invite.inviteId, discordId: input.discordId, access: invite.access, calendar } });
  return { ok: true, folderUrl: driveFolderUrl(invite.folderId), access: invite.access, calendar } as const;
}
