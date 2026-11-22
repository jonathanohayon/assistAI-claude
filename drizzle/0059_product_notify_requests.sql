CREATE TABLE IF NOT EXISTS "product_notify_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_notify_requests_once" UNIQUE("user_id","product"),
	CONSTRAINT "product_notify_requests_product_check" CHECK ("product_notify_requests"."product" IN ('reception', 'sales', 'connect'))
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "product_notify_requests" ADD CONSTRAINT "product_notify_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
