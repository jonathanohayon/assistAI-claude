-- Admin-only voice profile per tenant (lib/voice-profile.ts). NULL = all
-- defaults (today's behaviour), so no backfill. IF NOT EXISTS = safe re-run.
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "voice_profile" jsonb;
