-- Engine that took each call (worker >= 2026-11-03). NULL for older calls.
-- IF NOT EXISTS keeps re-runs harmless.
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "realtime_provider" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "realtime_model" text;
