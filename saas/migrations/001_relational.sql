-- BD Engine — relational migration, step 1: normalized tables.
--
-- Design: "indexed columns + JSONB payload". Each entity gets typed, indexed
-- columns for the fields we actually filter/sort/search on, plus a `data` JSONB
-- column holding the full object (so the many evolving scoring/enrichment fields
-- don't need brittle column mapping). This fixes the three ceilings of the
-- tenant_data blob model:
--   * per-row writes instead of rewriting the whole ~30MB tenant blob,
--   * real indexes instead of in-memory linear scans,
--   * query-without-loading-the-whole-tenant-into-process-memory.
--
-- Primary key is COMPOSITE (tenant_id, id): the legacy 4-char id factory
-- produced ids that collide both within and across tenants, so a global id PK
-- would silently drop rows. Composite keys keep tenants isolated (and fix the
-- old cross-tenant accountById bug); the backfill de-dupes within-tenant id
-- collisions by suffixing.
--
-- These tables live ALONGSIDE tenant_data. Nothing reads from them until the
-- app is switched over behind a flag in a later step, so applying this is safe.

CREATE TABLE IF NOT EXISTS rel_accounts (
  tenant_id        TEXT NOT NULL,
  id               TEXT NOT NULL,
  normalized_name  TEXT,
  display_name     TEXT,
  domain           TEXT,
  status           TEXT,
  priority_tier    TEXT,
  target_score     INTEGER NOT NULL DEFAULT 0,
  job_count        INTEGER NOT NULL DEFAULT 0,
  connection_count INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT,
  data             JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS rel_accounts_tenant_score_idx  ON rel_accounts (tenant_id, target_score DESC);
CREATE INDEX IF NOT EXISTS rel_accounts_tenant_name_idx   ON rel_accounts (tenant_id, normalized_name);
CREATE INDEX IF NOT EXISTS rel_accounts_tenant_status_idx ON rel_accounts (tenant_id, status);

CREATE TABLE IF NOT EXISTS rel_contacts (
  tenant_id      TEXT NOT NULL,
  id             TEXT NOT NULL,
  account_id     TEXT,
  full_name      TEXT,
  company_name   TEXT,
  title          TEXT,
  email          TEXT,
  priority_score INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT,
  data           JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS rel_contacts_tenant_score_idx   ON rel_contacts (tenant_id, priority_score DESC);
CREATE INDEX IF NOT EXISTS rel_contacts_tenant_account_idx ON rel_contacts (tenant_id, account_id);

CREATE TABLE IF NOT EXISTS rel_jobs (
  tenant_id    TEXT NOT NULL,
  id           TEXT NOT NULL,
  account_id   TEXT,
  title        TEXT,
  company_name TEXT,
  location     TEXT,
  ats_type     TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  posted_at    TEXT,
  updated_at   TEXT,
  data         JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS rel_jobs_tenant_posted_idx  ON rel_jobs (tenant_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS rel_jobs_tenant_account_idx ON rel_jobs (tenant_id, account_id);

CREATE TABLE IF NOT EXISTS rel_board_configs (
  tenant_id               TEXT NOT NULL,
  id                      TEXT NOT NULL,
  account_id              TEXT,
  normalized_company_name TEXT,
  ats_type                TEXT,
  board_id                TEXT,
  discovery_status        TEXT,
  review_status           TEXT,
  active                  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at              TEXT,
  data                    JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS rel_configs_tenant_name_idx   ON rel_board_configs (tenant_id, normalized_company_name);
CREATE INDEX IF NOT EXISTS rel_configs_tenant_status_idx ON rel_board_configs (tenant_id, discovery_status);

CREATE TABLE IF NOT EXISTS rel_activities (
  tenant_id   TEXT NOT NULL,
  id          TEXT NOT NULL,
  account_id  TEXT,
  contact_id  TEXT,
  type        TEXT,
  occurred_at TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS rel_activities_tenant_time_idx    ON rel_activities (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS rel_activities_tenant_account_idx ON rel_activities (tenant_id, account_id);

CREATE TABLE IF NOT EXISTS rel_tasks (
  tenant_id  TEXT NOT NULL,
  id         TEXT NOT NULL,
  account_id TEXT,
  status     TEXT,
  due_date   TEXT,
  data       JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS rel_tasks_tenant_status_idx ON rel_tasks (tenant_id, status, due_date);

-- Tracks which tenants have been backfilled + when.
CREATE TABLE IF NOT EXISTS rel_migration_state (
  tenant_id    TEXT PRIMARY KEY,
  migrated_at  TEXT NOT NULL,
  counts       JSONB NOT NULL DEFAULT '{}'
);
