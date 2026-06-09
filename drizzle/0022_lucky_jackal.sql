CREATE TABLE "outbound_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agent_name" text DEFAULT 'Sarah' NOT NULL,
	"voice" text DEFAULT 'marin' NOT NULL,
	"language" text DEFAULT 'fr' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"greeting" text DEFAULT '' NOT NULL,
	"knowledge" text DEFAULT '' NOT NULL,
	"knowledge_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notifications" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" jsonb DEFAULT '{"phone":true}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_agents" ADD CONSTRAINT "outbound_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_agent_id_outbound_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."outbound_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill : extraire la persona embarquée de chaque campagne existante vers
-- un agent réutilisable dédié, puis lier la campagne à cet agent. Idempotent
-- (ne traite que les campagnes encore non liées).
DO $$
DECLARE c RECORD; new_id uuid;
BEGIN
  FOR c IN SELECT * FROM "campaigns" WHERE agent_id IS NULL LOOP
    INSERT INTO "outbound_agents"
      (user_id, name, agent_name, voice, language, instructions, greeting, knowledge, knowledge_sources)
    VALUES (
      c.user_id,
      COALESCE(NULLIF(c.persona->>'agentName', ''), 'Sarah') || ' — ' || c.name,
      COALESCE(NULLIF(c.persona->>'agentName', ''), 'Sarah'),
      COALESCE(NULLIF(c.persona->>'voice', ''), 'marin'),
      COALESCE(NULLIF(c.persona->>'language', ''), 'fr'),
      COALESCE(c.persona->>'instructions', ''),
      COALESCE(c.persona->>'greeting', ''),
      COALESCE(c.persona->>'knowledge', ''),
      COALESCE(c.persona->'knowledgeSources', '[]'::jsonb)
    )
    RETURNING id INTO new_id;
    UPDATE "campaigns" SET agent_id = new_id WHERE id = c.id;
  END LOOP;
END $$;