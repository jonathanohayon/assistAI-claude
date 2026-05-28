-- Données structurées du tenant : identité + centres (horaires hebdo) +
-- soins/tarifs. Remplace progressivement agent_configs.knowledge (array
-- plat) → conservé pour 1 release de fallback worker, sera droppé en 0019.
-- IF NOT EXISTS pour idempotency (cf. bug startup 0017 sans cette protection).
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "business" jsonb
  NOT NULL
  DEFAULT '{"identity":{"name":"","tagline":"","email":""},"centres":[],"services":[]}'::jsonb;
