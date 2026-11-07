-- Tiger Cloud (TimescaleDB) specific setup. Applied by `pnpm db:push` after src/db/push.ts (the extension
-- block first, the rest after). Everything here is idempotent. Objects created here are also declared in
-- src/db/schema.ts (`.existing()` view / indexes) so drizzle-kit never tries to drop them; see docs/ARCHITECTURE.md.
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS vectorscale CASCADE;
-- pg_textsearch (BM25) is available on Tiger Cloud; ignore if missing.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_textsearch;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_textsearch not available: %', SQLERRM;
END $$;

-- Activity stream as a hypertable
SELECT create_hypertable('events', 'time', if_not_exists => TRUE);

-- Continuous aggregate: agent activity per hour (dashboard chart)
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_activity_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS bucket,
       org_id,
       agent,
       kind,
       count(*) AS n
FROM events
GROUP BY bucket, org_id, agent, kind
WITH NO DATA;

SELECT add_continuous_aggregate_policy('agent_activity_hourly',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);

-- Vector index (idempotent; drizzle may skip it on first push)
CREATE INDEX IF NOT EXISTS documents_embedding_idx ON documents USING hnsw (embedding vector_cosine_ops);

-- Inbound-mail dedup lookup index (idempotent; drizzle-kit push skipped it on the shared DB)
CREATE INDEX IF NOT EXISTS processed_mail_org_thread_idx ON processed_mail (org_id, thread_id);

-- BM25 index for hybrid search (no-op if pg_textsearch missing)
DO $$ BEGIN
  EXECUTE 'CREATE INDEX IF NOT EXISTS documents_bm25_idx ON documents USING bm25 (content) WITH (text_config = ''english'')';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'bm25 index skipped: %', SQLERRM;
END $$;
