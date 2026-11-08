import { calendarApi, driveApi } from "./client.js";

export type DriveAccess = "writer" | "reader";

/**
 * Give one person access to a Drive file or folder Tether created (drive.file scope covers its own files).
 * Google emails them the invite; re-sharing with the same address just updates the role.
 */
export async function shareDriveFile(fileId: string, email: string, access: DriveAccess, note?: string) {
  const res = await driveApi().permissions.create({
    fileId,
    sendNotificationEmail: true,
    emailMessage: note,
    requestBody: { type: "user", role: access, emailAddress: email },
    fields: "id,role",
  });
  return { permissionId: res.data.id!, role: res.data.role! };
}

/** Editors of the folder can also edit the team calendar (it is already public read-only). */
export async function shareCalendar(calendarId: string, email: string) {
  await calendarApi().acl.insert({ calendarId, sendNotifications: false, requestBody: { role: "writer", scope: { type: "user", value: email } } });
}
