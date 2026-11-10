ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "tools_config" jsonb;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "transfer_number_parked" text;--> statement-breakpoint
ALTER TABLE "outbound_agents" ADD COLUMN IF NOT EXISTS "tools_config" jsonb;