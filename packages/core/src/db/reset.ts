/**
 * `pnpm demo:reset` — wipe the activity tables (runs, steps, actions, events, agent_sessions)
 * and reseed the demo org so the dashboard and `/tether status` start clean on stage.
 * Leaves `processed_mail` alone on purpose: old sponsor emails must not be re-dispatched after a reset.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname });
import { sql } from "drizzle-orm";
import { db } from "./client.js";

if (process.env.NODE_ENV === "production" && process.env.DEMO_RESET_CONFIRM !== "yes") {
  throw new Error("refusing to truncate in production without DEMO_RESET_CONFIRM=yes");
}

const d = db();
// One statement so the FK graph (actions -> steps -> runs) is handled in a single truncate.
await d.execute(sql`TRUNCATE TABLE actions, steps, runs, events, agent_sessions`);
console.log("truncated runs, steps, actions, events, agent_sessions");

// seed.ts runs on import and calls process.exit(0) when done.
await import("./seed.js");
