ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "forwarding_test_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "forwarding_business_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "forwarding_detected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "forwarding_verified_method" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "forwarding_verified_at" timestamp with time zone;