CREATE TABLE "campaign_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"call_id" uuid,
	"phone_number" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT 'failed' NOT NULL,
	"disposition" text DEFAULT '' NOT NULL,
	"sentiment" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"contact_name" text DEFAULT '' NOT NULL,
	"vars" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"goal_preset" text DEFAULT 'custom' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"from_number" text DEFAULT '' NOT NULL,
	"persona" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extraction_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"concurrency" integer DEFAULT 3 NOT NULL,
	"retry_rules" jsonb DEFAULT '{"maxAttempts":1,"retryOn":[],"backoffMinutes":60}'::jsonb NOT NULL,
	"call_window" jsonb DEFAULT '{"timezone":"Asia/Jerusalem","days":[1,2,3,4,5],"startHour":9,"endHour":18,"respectDnc":true}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "campaign_calls" ADD CONSTRAINT "campaign_calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_calls" ADD CONSTRAINT "campaign_calls_contact_id_campaign_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."campaign_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_calls" ADD CONSTRAINT "campaign_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_calls" ADD CONSTRAINT "campaign_calls_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_contacts" ADD CONSTRAINT "campaign_contacts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_contacts" ADD CONSTRAINT "campaign_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_contacts_campaign_status_idx" ON "campaign_contacts" USING btree ("campaign_id","status");