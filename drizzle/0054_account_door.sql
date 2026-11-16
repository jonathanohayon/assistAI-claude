ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "door" text;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "users" ADD CONSTRAINT "users_door_check" CHECK ("users"."door" IN ('reception', 'sales', 'connect'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
