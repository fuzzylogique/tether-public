import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL_PLANNER: z.string().default("gemini-2.5-pro"),
  GEMINI_MODEL_AGENT: z.string().default("gemini-2.5-flash"),
  GEMINI_MODEL_IMAGE: z.string().default("gemini-2.5-flash-image"),
  GEMINI_MODEL_EMBED: z.string().default("gemini-embedding-001"),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  DISCORD_TOKEN: z.string().default(""),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_DEV_GUILD_ID: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REFRESH_TOKEN: z.string().default(""),
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
