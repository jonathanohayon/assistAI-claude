CREATE TABLE IF NOT EXISTS "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_key" text NOT NULL,
	"period" text NOT NULL,
	"currency" text NOT NULL,
	"coin" text NOT NULL,
	"expected_amount" real NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hyp_transaction_id" text,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payment_orders_hyp_transaction_id_unique" UNIQUE("hyp_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "paid_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deletion_locked_until" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
