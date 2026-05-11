-- Email verification : ajout d'un gate au signup avec code 4 chiffres par mail.
-- Default false → tous les users existants doivent re-verify (au prochain
-- login ils seront redirigés vers /verify-email). À considérer si on veut
-- backfill TRUE pour l'admin actuel via un UPDATE post-migration.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "email_verifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_verifications_user_id_idx" ON "email_verifications" ("user_id");
CREATE INDEX IF NOT EXISTS "email_verifications_expires_at_idx" ON "email_verifications" ("expires_at");

-- Backfill : l'admin existant et les tenants déjà loggés ne sont pas re-verify
-- en cassant leur accès. On marque comme verified tout user créé avant cette
-- migration (createdAt antérieur à NOW() à l'instant du run).
UPDATE "users" SET "email_verified" = true;
