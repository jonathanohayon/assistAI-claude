ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "product" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "calls" ADD CONSTRAINT "calls_product_check" CHECK ("calls"."product" IN ('reception', 'sales', 'connect'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_warnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entry" text NOT NULL,
	"threshold" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_warnings_claim" UNIQUE("user_id","entry","threshold","period_start"),
	CONSTRAINT "usage_warnings_entry_check" CHECK ("usage_warnings"."entry" IN ('reception', 'sales', 'connect')),
	CONSTRAINT "usage_warnings_threshold_check" CHECK ("usage_warnings"."threshold" IN (80, 100))
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "usage_warnings" ADD CONSTRAINT "usage_warnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
