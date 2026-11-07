import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import postgres from "postgres";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const full = readFileSync(new URL("../../sql/tiger.sql", import.meta.url), "utf8");
// `--extensions` runs only the CREATE EXTENSION block so pgvector exists before drizzle-kit creates the HNSW index.
const extensionsOnly = process.argv.includes("--extensions");
const sqlText = extensionsOnly ? full.split("-- Activity stream")[0]! : full;
// 42710 = "already exists, skipping": expected on every re-run, so only other notices are printed.
const client = postgres(url, { max: 1, onnotice: (n) => { if (n.code !== "42710") console.log(`notice: ${n.message}`); } });
try {
  await client.unsafe(sqlText);
  console.log(extensionsOnly ? "extensions ready" : "tiger.sql applied");
} finally {
  await client.end();
}
