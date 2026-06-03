CREATE TABLE IF NOT EXISTS "greeting_audio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"text_hash" text NOT NULL,
	"voice" text NOT NULL,
	"language" text NOT NULL,
	"render_version" integer DEFAULT 1 NOT NULL,
	"audio_pcm" "bytea" NOT NULL,
	"sample_rate" integer DEFAULT 24000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "greeting_audio_key" UNIQUE("user_id","text_hash","voice","language","render_version")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "greeting_audio" ADD CONSTRAINT "greeting_audio_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
