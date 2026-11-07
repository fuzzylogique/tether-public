import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.js";
import { schema } from "./schema.js";

let _db: ReturnType<typeof make> | undefined;

function make() {
  const client = postgres(env().DATABASE_URL, { max: 10, prepare: false });
  return drizzle(client, { schema });
}

export function db() {
  if (!_db) _db = make();
  return _db;
}
export type Db = ReturnType<typeof db>;
