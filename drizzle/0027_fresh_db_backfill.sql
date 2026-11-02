-- Backfill for columns that exist in the schema and in production but were
-- never created by a journaled migration, so a fresh database built from
-- ./drizzle was missing them:
--   * agent_configs.business: its SQL lived in 0018_add_business_config.sql,
--     which was never added to meta/_journal.json (drizzle ignores it).
--   * calls.duration_seconds: added to the schema without a migration.
-- IF NOT EXISTS keeps this a no-op on production, where both already exist.
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "business" jsonb DEFAULT '{"identity":{"name":"","tagline":"","email":""},"centres":[],"services":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "duration_seconds" integer DEFAULT 0 NOT NULL;
