CREATE TABLE IF NOT EXISTS "contact_confirmation_codes" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"salt" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_confirmation_codes_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "contact_confirmation_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
