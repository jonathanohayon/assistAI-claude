CREATE TABLE IF NOT EXISTS "account_product_trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"minutes_included" integer NOT NULL,
	CONSTRAINT "account_product_trials_once" UNIQUE("user_id","product"),
	CONSTRAINT "account_product_trials_product_check" CHECK ("account_product_trials"."product" IN ('reception', 'reception_multi', 'sales', 'connect'))
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "account_product_trials" ADD CONSTRAINT "account_product_trials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
