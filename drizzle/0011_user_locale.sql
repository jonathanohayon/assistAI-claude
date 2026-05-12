-- Add users.locale column for transactional emails (verification, welcome,
-- trial warning, trial deleted) and any future user-facing copy that runs
-- outside an HTTP request context where we can't read URL/cookie locale.
--
-- Default 'fr' matches routing.defaultLocale + preserves behavior for users
-- created before this migration. Saved at signup based on the URL locale
-- (/he/signup → locale='he', etc).

ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'fr';
