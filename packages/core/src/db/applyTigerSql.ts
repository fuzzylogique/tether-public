import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const sqlText = readFileSync(new URL("../../sql/tiger.sql", import.meta.url), "utf8");
const client = postgres(url, { max: 1 });
try {
  await client.unsafe(sqlText);
  console.log("tiger.sql applied");
} finally {
  await client.end();
}
