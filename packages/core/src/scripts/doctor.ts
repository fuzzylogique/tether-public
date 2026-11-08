/** Validates every credential in .env with a real call. `pnpm env:check` */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import postgres from "postgres";

type Check = { name: string; run: () => Promise<string> };
const e = process.env;
const ok = (s: string) => `\x1b[32m✔\x1b[0m ${s}`;
const bad = (s: string) => `\x1b[31m✘\x1b[0m ${s}`;
const skip = (s: string) => `\x1b[33m–\x1b[0m ${s}`;

const checks: Check[] = [
  {
    name: "Postgres (TigerData)",
    async run() {
      if (!e.DATABASE_URL) throw new Error("DATABASE_URL empty");
      const sql = postgres(e.DATABASE_URL, { max: 1, connect_timeout: 10 });
      try {
        const [v] = await sql`select version()`;
        const ext = await sql`select extname from pg_extension`;
        const names = ext.map((r) => r.extname);
        const tables = await sql`select count(*)::int as n from information_schema.tables where table_schema='public'`;
        return `${String(v!.version).split(" on ")[0]} · extensions: ${["timescaledb", "vector", "vectorscale", "pg_textsearch"].map((x) => `${x}${names.includes(x) ? "✔" : "✘"}`).join(" ")} · ${tables[0]!.n} tables${tables[0]!.n === 0 ? " (run pnpm db:push)" : ""}`;
      } finally { await sql.end(); }
    },
  },
  {
    name: "Gemini",
    async run() {
      if (!e.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY empty");
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: e.GEMINI_API_KEY });
      const r = await ai.models.generateContent({ model: e.GEMINI_MODEL_AGENT ?? "gemini-3.6-flash", contents: "Reply with the single word: ready" });
      return `${e.GEMINI_MODEL_AGENT} says "${(r.text ?? "").trim().slice(0, 30)}"`;
    },
  },
  {
    name: "Discord bot",
    async run() {
      if (!e.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN empty");
      const r = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bot ${e.DISCORD_TOKEN}` } });
      if (!r.ok) throw new Error(`token rejected (${r.status})`);
      const me = (await r.json()) as { username: string; id: string };
      const app = await fetch("https://discord.com/api/v10/applications/@me", { headers: { Authorization: `Bot ${e.DISCORD_TOKEN}` } }).then((x) => x.json()) as { flags?: number; id: string };
      const msgIntent = ((app.flags ?? 0) & (1 << 18)) !== 0 || ((app.flags ?? 0) & (1 << 19)) !== 0;
      // The bot creates team channels and roles, edits channel permissions and moderates messages, so it is
      // invited as Administrator. Re-opening the invite URL on a server it is already in upgrades its role.
      const ADMINISTRATOR = 8n;
      const guild = e.DISCORD_DEV_GUILD_ID ? await (async () => {
        const H = { headers: { Authorization: `Bot ${e.DISCORD_TOKEN}` } };
        const m = await fetch(`https://discord.com/api/v10/guilds/${e.DISCORD_DEV_GUILD_ID}/members/${me.id}`, H);
        if (!m.ok) return "NOT in dev guild ✘ (use the invite URL below)";
        const { roles: mine } = (await m.json()) as { roles: string[] };
        const roles = (await fetch(`https://discord.com/api/v10/guilds/${e.DISCORD_DEV_GUILD_ID}/roles`, H).then((x) => x.json())) as { id: string; permissions: string }[];
        const perms = roles.filter((r) => r.id === e.DISCORD_DEV_GUILD_ID || mine.includes(r.id)).reduce((a, r) => a | BigInt(r.permissions), 0n);
        return perms & ADMINISTRATOR ? "in dev guild ✔ (Administrator)" : "in dev guild, but not Administrator ✘ (open the invite URL below to upgrade)";
      })() : "DISCORD_DEV_GUILD_ID empty";
      const perms = String(ADMINISTRATOR);
      return `@${me.username} · message content intent ${msgIntent ? "✔" : "✘ (enable in Bot settings)"} · ${guild}\n   invite: https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot%20applications.commands&permissions=${perms}`;
    },
  },
  {
    name: "Google (organizer account)",
    async run() {
      if (!e.GOOGLE_REFRESH_TOKEN) return "no refresh token yet → run pnpm google:auth";
      const { google } = await import("googleapis");
      const auth = new google.auth.OAuth2(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET);
      auth.setCredentials({ refresh_token: e.GOOGLE_REFRESH_TOKEN });
      const gmail = google.gmail({ version: "v1", auth });
      const profile = await gmail.users.getProfile({ userId: "me" });
      const cal = await google.calendar({ version: "v3", auth }).calendarList.list({ maxResults: 5 });
      return `${profile.data.emailAddress} · calendars: ${(cal.data.items ?? []).map((c) => `${c.summary}${c.primary ? " (primary)" : ""} [${c.id}]`).join(", ")}`;
    },
  },
  {
    name: "Inngest dev server",
    async run() {
      const r = await fetch("http://localhost:8288/health").catch(() => undefined);
      if (!r?.ok) return "not running → pnpm dev:inngest (only needed while developing)";
      return "running on :8288";
    },
  },
  {
    name: "Auth0",
    async run() {
      if (!e.AUTH0_DOMAIN) return "not configured → dashboard runs in dev mode without login";
      const r = await fetch(`https://${e.AUTH0_DOMAIN}/.well-known/openid-configuration`);
      if (!r.ok) throw new Error(`tenant not reachable (${r.status})`);
      return `tenant ${e.AUTH0_DOMAIN} reachable${e.AUTH0_SECRET ? "" : " · AUTH0_SECRET empty (openssl rand -hex 32)"}`;
    },
  },
  {
    name: "Vultr Object Storage",
    async run() {
      if (!e.S3_ACCESS_KEY) return "not configured → receipts keep expiring Discord URLs, images fall back to data URLs";
      const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({ endpoint: e.S3_ENDPOINT, region: "us-east-1", credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY! } });
      await s3.send(new HeadBucketCommand({ Bucket: e.S3_BUCKET }));
      return `bucket ${e.S3_BUCKET} reachable`;
    },
  },
];

let failures = 0;
for (const c of checks) {
  try {
    const msg = await c.run();
    console.log((msg.startsWith("no ") || msg.startsWith("not ")) ? skip(`${c.name}: ${msg}`) : ok(`${c.name}: ${msg}`));
  } catch (err) {
    failures++;
    console.log(bad(`${c.name}: ${err instanceof Error ? err.message : String(err)}`));
  }
}
process.exit(failures ? 1 : 0);
