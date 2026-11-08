/**
 * Verifies INSTAGRAM_ACCESS_TOKEN: which account it posts as, that it is a professional account,
 * and that Object Storage is configured (Instagram fetches images from a public URL). `pnpm instagram:check`
 * Pass `--refresh` to swap the long-lived token for a fresh 60-day one and write it into .env.
 */
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
const envPath = new URL("../../../../.env", import.meta.url).pathname;
config({ path: envPath });
import { env } from "../env.js";
import { instagramAccount, instagramConfigured } from "../instagram.js";
import { storageConfigured } from "../storage.js";

if (!instagramConfigured()) { console.error("Set INSTAGRAM_ACCESS_TOKEN in .env first."); process.exit(1); }

if (process.argv.includes("--refresh") && env().INSTAGRAM_ACCESS_TOKEN.startsWith("EAA")) {
  console.log("system-user token: it does not expire, nothing to refresh");
} else if (process.argv.includes("--refresh")) {
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${env().INSTAGRAM_ACCESS_TOKEN}`);
  const body = await res.json() as { access_token?: string; expires_in?: number; error?: { message: string } };
  if (!body.access_token) { console.error("refresh failed:", body.error?.message ?? res.status); process.exit(1); }
  writeFileSync(envPath, readFileSync(envPath, "utf8").replace(/^INSTAGRAM_ACCESS_TOKEN=.*$/m, `INSTAGRAM_ACCESS_TOKEN=${body.access_token}`));
  process.env.INSTAGRAM_ACCESS_TOKEN = body.access_token;
  console.log(`token refreshed, valid for ${Math.round((body.expires_in ?? 0) / 86400)} days`);
}

const account = await instagramAccount();
console.log(`posting as @${account.username} (id ${account.userId}, ${account.accountType ?? "unknown type"})`);
if (account.accountType && !["BUSINESS", "MEDIA_CREATOR"].includes(account.accountType)) console.warn("⚠ not a professional account: switch it to Creator or Business in the Instagram app");
console.log(storageConfigured() ? "object storage: ok" : "⚠ object storage not configured: post_instagram needs S3_* set");
process.exit(0);
