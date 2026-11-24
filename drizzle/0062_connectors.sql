CREATE TABLE IF NOT EXISTS "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"mode" text NOT NULL,
	"secret" text,
	"voice_config" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"phone_number_id" uuid,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connectors_phone_number_id_unique" UNIQUE("phone_number_id"),
	CONSTRAINT "connectors_mode_check" CHECK ("connectors"."mode" IN ('lead', 'voice'))
);
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "connector_id" uuid;
--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "client_agent_reached" boolean;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "connectors" ADD CONSTRAINT "connectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "connectors" ADD CONSTRAINT "connectors_phone_number_id_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connectors_user_id_idx" ON "connectors" USING btree ("user_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "calls" ADD CONSTRAINT "calls_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
