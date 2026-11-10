CREATE TABLE IF NOT EXISTS "voice_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voice_id" text NOT NULL,
	"style" text NOT NULL,
	"language" text NOT NULL,
	"version" integer NOT NULL,
	"audio_pcm" "bytea" NOT NULL,
	"sample_rate" integer DEFAULT 24000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_samples_key" UNIQUE("voice_id","style","language","version")
);
