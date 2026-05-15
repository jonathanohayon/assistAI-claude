-- agent_name column added in 0015 already (manually applied). This migration
-- now only adds noise_reduction_level. Both wrapped in IF NOT EXISTS to be safe.
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "agent_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "noise_reduction_level" integer DEFAULT 8 NOT NULL;
