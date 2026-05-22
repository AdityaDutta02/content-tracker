-- content-tracker schema
-- per-app Postgres; viewer_id col enforces per-user isolation in app code

CREATE TABLE IF NOT EXISTS channels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id           TEXT NOT NULL,
  name                TEXT NOT NULL,
  niche               TEXT NOT NULL,
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  general_web_search  BOOLEAN NOT NULL DEFAULT false,
  smart_mode          BOOLEAN NOT NULL DEFAULT false,
  niche_embedding     JSONB,
  scraper_byok_key    TEXT,
  last_run_date       DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_channels_viewer ON channels(viewer_id);

CREATE TABLE IF NOT EXISTS sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,             -- rss|hn|reddit|arxiv|yt|x|ig|fb|web
  url             TEXT,
  handle          TEXT,
  label           TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  scrape_config   JSONB NOT NULL DEFAULT '{}',
  added_by        TEXT NOT NULL DEFAULT 'user_custom',  -- ai_discovery|user_custom
  last_fetch_at   TIMESTAMPTZ,
  last_fetch_error TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sources_channel ON sources(channel_id);

CREATE TABLE IF NOT EXISTS items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  source_id         UUID REFERENCES sources(id) ON DELETE SET NULL,
  external_id       TEXT NOT NULL,
  canonical_url     TEXT NOT NULL,
  cluster_id        TEXT,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  summary           TEXT,
  published_at      TIMESTAMPTZ,
  engagement        JSONB DEFAULT '{}',
  ai_relevance      REAL,
  final_score       REAL,
  rank              INT,
  run_date          DATE NOT NULL,
  raw_json          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_dedupe ON items(channel_id, canonical_url, run_date);
CREATE INDEX IF NOT EXISTS idx_items_feed ON items(channel_id, run_date DESC, rank);
CREATE INDEX IF NOT EXISTS idx_items_purge ON items(created_at);

CREATE TABLE IF NOT EXISTS runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger       TEXT NOT NULL DEFAULT 'cron',   -- cron|manual
  status        TEXT NOT NULL,                  -- ok|partial|failed
  item_count    INT NOT NULL DEFAULT 0,
  credits_used  INT NOT NULL DEFAULT 0,
  errors        JSONB
);
CREATE INDEX IF NOT EXISTS idx_runs_channel ON runs(channel_id, run_at DESC);
