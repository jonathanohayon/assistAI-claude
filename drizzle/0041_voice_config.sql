ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "voice_config" jsonb;--> statement-breakpoint
ALTER TABLE "outbound_agents" ADD COLUMN IF NOT EXISTS "voice_config" jsonb;