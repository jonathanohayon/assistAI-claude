-- J-1 WhatsApp reminder ON by default (2026-11, Fable's plan via tamaraAlbert).
-- 1) New tenants: column default true (idempotent).
ALTER TABLE "agent_configs" ALTER COLUMN "reminder_enabled" SET DEFAULT true;--> statement-breakpoint
-- 2) Existing tenants with Google Calendar connected (reminders read their
--    calendar): switched on once. Tenants without a calendar are left as is;
--    the reminder cron skips them anyway.
UPDATE "agent_configs" SET "reminder_enabled" = true
FROM "users"
WHERE "users"."id" = "agent_configs"."user_id"
  AND "users"."google_refresh_token" IS NOT NULL
  AND "agent_configs"."reminder_enabled" = false;
