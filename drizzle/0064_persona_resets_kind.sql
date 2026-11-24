ALTER TABLE "persona_resets" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'persona' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "persona_resets" ADD CONSTRAINT "persona_resets_kind_check" CHECK ("persona_resets"."kind" IN ('persona', 'company_sheet'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
