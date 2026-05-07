CREATE TABLE "agent_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instructions" text NOT NULL,
	"greeting_instructions" text NOT NULL,
	"model" text DEFAULT 'gpt-realtime-mini' NOT NULL,
	"voice" text DEFAULT 'marin' NOT NULL,
	"temperature" real DEFAULT 0.8 NOT NULL,
	"speed" real DEFAULT 1 NOT NULL,
	"max_response_tokens" integer DEFAULT 220 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;