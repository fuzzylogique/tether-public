/**
 * One-time Google OAuth for the organizer account.
 * Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env from a "Desktop app" OAuth client.
 * Opens the consent screen, catches the loopback redirect, and writes GOOGLE_REFRESH_TOKEN into .env.
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";

const envPath = new URL("../../../../.env", import.meta.url).pathname;
config({ path: envPath });

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) { console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first."); process.exit(1); }

const PORT = 53682;
const redirect = `http://localhost:${PORT}/callback`;
const oauth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirect);
const scopes = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.file",
];
const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: scopes });

const server = createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", redirect);
  if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
  const code = u.searchParams.get("code");
  if (!code) { res.writeHead(400).end("missing code"); return; }
  try {
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) throw new Error("No refresh token returned. Remove the app from https://myaccount.google.com/permissions and run again.");
    let env = readFileSync(envPath, "utf8");
    env = env.match(/^GOOGLE_REFRESH_TOKEN=.*$/m)
      ? env.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`)
      : `${env}\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    writeFileSync(envPath, env);
    res.writeHead(200, { "content-type": "text/html" }).end("<h2>Tether: Google connected. You can close this tab.</h2>");
    console.log("GOOGLE_REFRESH_TOKEN written to .env");
  } catch (e) {
    res.writeHead(500).end(String(e));
    console.error(e);
  } finally {
    setTimeout(() => { server.close(); process.exit(0); }, 500);
  }
});
server.listen(PORT, () => {
  console.log(`Open this URL (trying to open it for you):\n\n${url}\n`);
  exec(`open "${url}"`, () => undefined);
});
