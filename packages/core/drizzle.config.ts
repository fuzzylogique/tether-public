import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { TABLES_FILTER } from "./src/db/drizzleFilters.js";
config({ path: new URL("../../.env", import.meta.url).pathname });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Used by `drizzle-kit generate`/`studio`. `pnpm db:push` goes through src/db/push.ts, which applies the
  // same filter and refuses destructive statements against the Timescale objects from sql/tiger.sql.
  tablesFilter: [...TABLES_FILTER],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
