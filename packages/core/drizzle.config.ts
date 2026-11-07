import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
