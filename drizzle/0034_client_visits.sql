CREATE TABLE "client_visits" (
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
ALTER TABLE "users" ADD COLUMN "visits_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_visits" ADD CONSTRAINT "client_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_visits_user_phone_idx" ON "client_visits" USING btree ("user_id","client_phone");