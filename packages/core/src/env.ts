import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  // Extra keys from other Google accounts/projects, comma-separated. Free-tier daily quotas are per project, so the
  // runtime rotates to the next key when one is exhausted for a model before dropping to GEMINI_MODEL_FALLBACK.
  GEMINI_API_KEYS: z.string().default(""),
  GEMINI_MODEL_PLANNER: z.string().default("gemini-3.6-flash"),
  GEMINI_MODEL_AGENT: z.string().default("gemini-3.6-flash"),
  GEMINI_MODEL_FALLBACK: z.string().default("gemini-3.1-flash-lite"),
  GEMINI_MODEL_IMAGE: z.string().default("gemini-3.1-flash-image"),
  GEMINI_MODEL_EMBED: z.string().default("gemini-embedding-001"),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  INNGEST_DEV: z.string().optional(),
  // Cron monitors (monitor-tasks, poll-sponsor-mail) register only when this is "1".
  // Exactly one process per shared DB/Gmail account may set it.
  TETHER_RUN_CRONS: z.string().optional(),
  MONITOR_TASKS_CRON: z.string().default("*/15 * * * *"),
  MONITOR_MAIL_CRON: z.string().default("*/2 * * * *"),
  // Daily inbox digest; 14:00 UTC is 9am Toronto in November. Blank disables it.
  DIGEST_CRON: z.string().default("0 14 * * *"),
  DIGEST_HOURS: z.coerce.number().int().positive().default(24),
  NUDGE_INTERVAL_MIN: z.coerce.number().int().positive().default(120),
  ESCALATE_AFTER_NUDGES: z.coerce.number().int().min(1).default(2),
  DISCORD_TOKEN: z.string().default(""),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_DEV_GUILD_ID: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REFRESH_TOKEN: z.string().default(""),
  // Instagram API with Instagram Login: a long-lived token for the org's professional account (60 days).
  INSTAGRAM_ACCESS_TOKEN: z.string().default(""),
  INSTAGRAM_USER_ID: z.string().default(""),
  INSTAGRAM_GRAPH_VERSION: z.string().default("v24.0"),
  SERVER_PORT: z.coerce.number().default(3001),
  SERVER_PUBLIC_URL: z.string().default("http://localhost:3001"),
  WEB_PUBLIC_URL: z.string().default("http://localhost:3000"),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
