CREATE TABLE "appointment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"status" text NOT NULL,
	"client_phone" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"appointment_start" timestamp with time zone,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_reminders_user_event" UNIQUE("user_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "reminder_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;