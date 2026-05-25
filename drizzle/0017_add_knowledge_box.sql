-- knowledge column added manually 2026-05-19 via direct psql before this
-- migration file existed in tracking. Wrapped in IF NOT EXISTS to be
-- idempotent en cas de DB rollback / fresh deploy.
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL;
