-- Per-tenant call-transfer number (lib/transfer-number.ts). '' = no transfer.
-- IF NOT EXISTS keeps re-runs harmless.
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "transfer_number" text DEFAULT '' NOT NULL;
