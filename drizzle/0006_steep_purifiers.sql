ALTER TABLE "users" ADD COLUMN "google_refresh_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_calendar_id" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sheet_id" text DEFAULT '' NOT NULL;