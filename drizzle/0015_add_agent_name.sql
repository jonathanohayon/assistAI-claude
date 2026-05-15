-- Nom prononcé par l'agent dans la phrase d'accueil ("Bonjour, c'est Sarah").
-- Facultatif (default ''). Applique en prod avec :
--   npm run db:migrate
-- (ou ALTER TABLE manuel si drizzle-kit re-génère d'autres tables — voir
-- migrations/0014_add_personality_column pour le précédent gotcha)
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "agent_name" text DEFAULT '' NOT NULL;
