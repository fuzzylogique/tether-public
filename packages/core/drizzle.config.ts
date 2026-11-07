import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // extension-owned views that drizzle would otherwise try to drop
  tablesFilter: ["!pg_stat_statements*", "!pg_buffercache*"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
