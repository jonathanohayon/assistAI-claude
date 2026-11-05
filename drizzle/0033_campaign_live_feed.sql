ALTER TABLE "campaign_contacts" ADD COLUMN "call_state" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_contacts" ADD COLUMN "call_state_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "events_campaign_created_idx" ON "events" USING btree (("metadata"->>'campaignId'),"created_at") WHERE "events"."metadata" ? 'campaignId';