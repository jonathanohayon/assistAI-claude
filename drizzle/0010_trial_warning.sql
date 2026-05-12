-- Trial cleanup : ajoute un timestamp pour idempotence de l'email d'alerte
-- 2h-avant-fin envoyé par le cron /api/cron/trial-cleanup. Sans ce flag,
-- chaque tick de cron renverait le warning.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trial_warning_sent_at" timestamp with time zone;
