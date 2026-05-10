ALTER TABLE "phone_numbers" ADD COLUMN "twilio_sid" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "country_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "subscription_status" text DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_ends_at" timestamp with time zone;