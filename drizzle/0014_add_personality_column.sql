ALTER TABLE "agent_configs" ADD COLUMN "personality" jsonb DEFAULT '{}'::jsonb NOT NULL;
