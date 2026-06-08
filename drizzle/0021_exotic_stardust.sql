ALTER TABLE "calls" ADD COLUMN "duration_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD COLUMN "kind" text DEFAULT 'subscription' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_period" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auto_renew" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "scheduled_plan" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "scheduled_plan_period" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "scheduled_plan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hyp_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hyp_token_exp" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "card_last4" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "card_brand" text;