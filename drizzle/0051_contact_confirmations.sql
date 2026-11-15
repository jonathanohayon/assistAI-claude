ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "contact_confirmations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Verified numbers N1 (lib/contact-confirmation.ts): every value already set
-- when this runs is grandfathered = read as CONFIRMED, with by "grandfathered"
-- and the time of this migration (the start of N5's grace). Only kinds with
-- no record yet are added, so a re-run writes nothing. transfer_number is
-- the KEPT number: transfer_number, or the parked one when the Tools switch
-- is OFF (lib/tools/store.ts accountTransferNumber).
UPDATE "agent_configs" AS c
SET "contact_confirmations" = c."contact_confirmations" || g."add"
FROM (
  SELECT
    s."id",
    jsonb_strip_nulls(jsonb_build_object(
      'owner_whatsapp',
      CASE WHEN s."owner_whatsapp" <> '' AND NOT (s."contact_confirmations" ? 'owner_whatsapp')
        THEN jsonb_build_object('value', s."owner_whatsapp", 'state', 'confirmed', 'at', t."at", 'by', 'grandfathered') END,
      'transfer_number',
      CASE WHEN COALESCE(NULLIF(s."transfer_number", ''), s."transfer_number_parked", '') <> '' AND NOT (s."contact_confirmations" ? 'transfer_number')
        THEN jsonb_build_object('value', COALESCE(NULLIF(s."transfer_number", ''), s."transfer_number_parked"), 'state', 'confirmed', 'at', t."at", 'by', 'grandfathered') END,
      'owner_recap_email',
      CASE WHEN s."owner_recap_email" <> '' AND NOT (s."contact_confirmations" ? 'owner_recap_email')
        THEN jsonb_build_object('value', s."owner_recap_email", 'state', 'confirmed', 'at', t."at", 'by', 'grandfathered') END
    )) AS "add"
  FROM "agent_configs" AS s
  CROSS JOIN (SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "at") AS t
) AS g
WHERE g."id" = c."id" AND g."add" <> '{}'::jsonb;
