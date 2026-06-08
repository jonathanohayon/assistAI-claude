ALTER TABLE "payment_orders" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_period" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auto_renew" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "scheduled_plan" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "scheduled_plan_period" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "scheduled_plan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hyp_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hyp_token_exp" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "card_last4" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "card_brand" text;
