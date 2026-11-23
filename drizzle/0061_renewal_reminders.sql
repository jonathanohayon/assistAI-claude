CREATE TABLE IF NOT EXISTS "renewal_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_reminders_once" UNIQUE("user_id","period_end")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "renewal_reminders" ADD CONSTRAINT "renewal_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
