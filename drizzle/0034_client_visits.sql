CREATE TABLE IF NOT EXISTS "client_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"client_phone" text NOT NULL,
	"client_name" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_visits_user_event" UNIQUE("user_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "visits_synced_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_visits_user_id_users_id_fk') THEN
    ALTER TABLE "client_visits" ADD CONSTRAINT "client_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_visits_user_phone_idx" ON "client_visits" USING btree ("user_id","client_phone");