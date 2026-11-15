ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "contact_confirmations" jsonb DEFAULT '{}'::jsonb NOT NULL;
