-- Tiger Cloud (TimescaleDB) specific setup. Applied after `drizzle-kit push`.
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

-- Additive finance columns and table. Kept here as well as in the Drizzle schema because `drizzle-kit push`
-- aborts on this database (it tries to DROP the continuous aggregate above) before it reaches ALTER TABLE.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax numeric(12, 2);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_by text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reimbursement text NOT NULL DEFAULT 'none';
CREATE TABLE IF NOT EXISTS income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id),
  source text NOT NULL,
  sponsor_id uuid REFERENCES sponsors(id),
  amount numeric(12, 2) NOT NULL,
  status text NOT NULL DEFAULT 'pledged',
  date text,
  notes text,
  sheet_row integer,
  logged_by_discord_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
