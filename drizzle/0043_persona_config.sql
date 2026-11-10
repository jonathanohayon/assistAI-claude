ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "persona_config" jsonb;--> statement-breakpoint
ALTER TABLE "outbound_agents" ADD COLUMN IF NOT EXISTS "persona_config" jsonb;