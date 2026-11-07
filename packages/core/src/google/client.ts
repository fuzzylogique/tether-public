import { google } from "googleapis";
import { env } from "../env.js";

type OAuth2 = InstanceType<typeof google.auth.OAuth2>;
let _auth: OAuth2 | undefined;

/** Single organizer Google account, authorized once via OAuth consent. Token Vault (Auth0) is the per-user stretch. */
export function googleAuth(): OAuth2 {
  if (!_auth) {
    const e = env();
    const auth: OAuth2 = new google.auth.OAuth2(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: e.GOOGLE_REFRESH_TOKEN });
    _auth = auth;
  }
  return _auth;
}

export const sheetsApi = () => google.sheets({ version: "v4", auth: googleAuth() });
export const gmailApi = () => google.gmail({ version: "v1", auth: googleAuth() });
export const calendarApi = () => google.calendar({ version: "v3", auth: googleAuth() });
export const driveApi = () => google.drive({ version: "v3", auth: googleAuth() });
