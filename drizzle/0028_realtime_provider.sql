-- Admin-only speech-to-speech engine per tenant (lib/realtime-provider.ts).
-- NULL = openai, so no backfill. IF NOT EXISTS keeps re-runs harmless.
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "realtime_provider" text;
