// Shared between drizzle.config.ts and src/db/push.ts.
// Extension-owned views in `public` that drizzle-kit would otherwise try to drop.
export const TABLES_FILTER = ["!pg_stat_statements*", "!pg_buffercache*"] as const;

// Objects created by Timescale or sql/tiger.sql. `pnpm db:push` refuses to run any statement that touches
// them, whatever flags are passed: fix the Drizzle schema instead (see docs/ARCHITECTURE.md, Data).
export const PROTECTED_OBJECTS = [
  "agent_activity_hourly", // continuous aggregate (a plain view in pg_class; DROP VIEW on it is an error)
  "events_time_idx", // default hypertable index from create_hypertable
  "documents_bm25_idx", // pg_textsearch BM25 index
  "documents_embedding_idx", // pgvector HNSW index
] as const;
