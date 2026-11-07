/**
 * `pnpm db:push` — additive, fail-loud schema push for the shared Tiger Cloud database.
 *
 * Why not `drizzle-kit push` directly: it exits 0 when a statement fails, so the pnpm script kept going
 * (and reported success) after `DROP VIEW agent_activity_hourly` errored on the continuous aggregate. On a
 * database shared between branches it also happily drops the other branch's columns and tables.
 *
 * This wrapper computes the same plan through drizzle-kit's API and then:
 *   - refuses outright (exit 1, nothing executed) if any statement touches a PROTECTED object from
 *     sql/tiger.sql — the Drizzle schema is wrong, fix that instead;
 *   - skips destructive statements (DROP, DROP COLUMN/CONSTRAINT, column type changes, TRUNCATE) unless
 *     `--allow-destructive` is passed, printing each one so drift stays visible;
 *   - runs the rest in order; statements are independent DDL, so a failure is reported and the run
 *     continues, then the process exits 1 listing everything that did not apply.
 *
 * Flags: `--plan` prints the plan and exits without executing. `--allow-destructive` runs the whole plan.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { pushSchema } from "drizzle-kit/api";
import * as schemaModule from "./schema.js";
import { PROTECTED_OBJECTS, TABLES_FILTER } from "./drizzleFilters.js";

const args = new Set(process.argv.slice(2));
const planOnly = args.has("--plan");
const allowDestructive = args.has("--allow-destructive");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const DESTRUCTIVE =
  /^\s*(DROP\s|TRUNCATE\s|ALTER\s+(MATERIALIZED\s+)?(TABLE|VIEW)\s+.*\s(DROP\s+(COLUMN|CONSTRAINT)|ALTER\s+COLUMN\s+.*\s(SET\s+DATA\s+TYPE|TYPE)\s))/is;

// Tables the plan drops: drizzle emits companion statements for them (e.g. `DISABLE ROW LEVEL SECURITY`)
// that are pointless without the drop, so they are held back with it.
const droppedTables = (plan: string[]) =>
  plan.flatMap((s) => [...s.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?/gi)].map((m) => m[1]!));
const isDestructive = (stmt: string, dropped: string[] = []) =>
  DESTRUCTIVE.test(stmt) || dropped.some((t) => new RegExp(`\\b(TABLE|ON)\\s+"?${t}"?([^a-z0-9_]|$)`, "i").test(stmt));
const touchesProtected = (stmt: string) =>
  PROTECTED_OBJECTS.filter((name) => new RegExp(`(^|[^a-z0-9_])"?${name}"?([^a-z0-9_]|$)`, "i").test(stmt));

const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);
// drizzle-kit's API reads `.rows` off `execute()`, but the postgres-js driver returns the row array itself.
// Adapt so introspection works (otherwise drizzle-kit dies inside `renderWithTask` with no message).
const kitDb = {
  execute: async (query: Parameters<typeof db.execute>[0]) => {
    const res: unknown = await db.execute(query);
    return Array.isArray(res) ? { rows: res } : res;
  },
} as unknown as Parameters<typeof pushSchema>[1];

let exitCode = 0;
try {
  const { statementsToExecute, warnings, hasDataLoss } = await pushSchema(
    schemaModule as unknown as Record<string, unknown>,
    kitDb,
    ["public"],
    [...TABLES_FILTER],
  );

  const dropped = droppedTables(statementsToExecute);
  if (statementsToExecute.length === 0) {
    console.log("db:push — schema is in sync, nothing to do");
  } else {
    console.log(`db:push — ${statementsToExecute.length} statement(s) planned:`);
    for (const s of statementsToExecute) console.log(`  ${isDestructive(s, dropped) ? "✗" : "•"} ${s.trim()}`);
  }
  for (const w of warnings) console.warn(`warning: ${w}`);

  const protectedHits = statementsToExecute.flatMap((s) => touchesProtected(s).map((n) => `${n}: ${s.trim()}`));
  if (protectedHits.length > 0) {
    console.error("\ndb:push REFUSED — plan touches objects owned by Timescale / sql/tiger.sql:");
    for (const h of protectedHits) console.error(`  ${h}`);
    console.error("Fix src/db/schema.ts so drizzle sees these as existing (see docs/ARCHITECTURE.md, Data). Nothing was executed.");
    exitCode = 1;
  } else if (planOnly) {
    console.log("\n--plan: nothing executed");
  } else {
    const destructive = statementsToExecute.filter((s) => isDestructive(s, dropped));
    const toRun = allowDestructive ? statementsToExecute : statementsToExecute.filter((s) => !isDestructive(s, dropped));
    if (destructive.length > 0 && !allowDestructive) {
      console.warn(`\nSkipping ${destructive.length} destructive statement(s) on the shared DB (re-run with --allow-destructive to apply them):`);
      for (const s of destructive) console.warn(`  ✗ ${s.trim()}`);
      console.warn("");
    }
    if (hasDataLoss && allowDestructive) console.warn("warning: drizzle flagged possible data loss; running anyway (--allow-destructive)");

    const failed: string[] = [];
    for (const stmt of toRun) {
      try {
        await client.unsafe(stmt);
        console.log(`  ok    ${stmt.trim()}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  FAIL  ${stmt.trim()}\n        ${msg}`);
        failed.push(`${stmt.trim()}\n    ${msg}`);
      }
    }
    if (failed.length > 0) {
      console.error(`\ndb:push FAILED — ${failed.length} of ${toRun.length} statement(s) did not apply:`);
      for (const f of failed) console.error(`  ${f}`);
      exitCode = 1;
    } else {
      console.log(`db:push — applied ${toRun.length} statement(s)`);
    }
  }
} catch (err) {
  console.error("db:push FAILED while planning:", err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  await client.end();
}
process.exit(exitCode);
