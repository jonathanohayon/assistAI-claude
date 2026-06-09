ALTER TABLE "campaigns" ADD COLUMN "success_criteria" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill : remonter le critère de succès de la persona embarquée vers la
-- colonne campagne dédiée.
UPDATE "campaigns"
SET "success_criteria" = COALESCE(persona->>'successCriteria', '')
WHERE "success_criteria" = '' AND persona->>'successCriteria' IS NOT NULL;