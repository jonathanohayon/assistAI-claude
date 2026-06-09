import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Colonne binaire Postgres (audio PCM brut). Drizzle n'a pas de `bytea` natif.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// Users own one or more agent_configs. Phase 1 = single user, single config.
// Schema is multi-tenant ready so phase 2 only adds rows, no migration.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // 'admin' = global ops (manage tenants, assign numbers); 'user' = standard tenant.
  role: text("role").notNull().default("user"),
  // Optional human label shown in /admin (e.g. salon name).
  displayName: text("display_name").notNull().default(""),

  // Subscription state — drives trial gating & dashboard banners.
  // 'trialing' (default for new signups, durée définie par lib/trial.ts),
  // 'active' (paid), 'expired' (trial ended without subscribing),
  // 'cancelled' (was active).
  subscriptionStatus: text("subscription_status").notNull().default("trialing"),
  // Chosen plan key — see lib/plans.ts. Captured at signup (?plan=…) and
  // updatable from /dashboard/billing.
  subscriptionPlan: text("subscription_plan").notNull().default("essential"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  // Stamp posé par le cron trial-cleanup quand l'email d'alerte 2h-avant
  // a été envoyé, pour idempotence (un seul warning par trial). Reste null
  // tant que pas envoyé OU si le user upgrade avant la fenêtre warning.
  trialWarningSentAt: timestamp("trial_warning_sent_at", { withTimezone: true }),
  // Fin de la période payée en cours (posé après un paiement HYP réussi).
  // Null tant que jamais payé. Le renouvellement (one-shot) repousse cette
  // date ; à expiration le compte repasse 'expired'.
  paidUntil: timestamp("paid_until", { withTimezone: true }),
  // Verrou anti-suppression : posé à now+2h quand un paiement HYP est lancé,
  // pour que le cron trial-cleanup ne supprime PAS un compte dont le
  // paiement est en vol (user sur la page HYP au moment où le trial expire).
  deletionLockedUntil: timestamp("deletion_locked_until", { withTimezone: true }),

  // ─ Abonnement : gestion (cancel / renouvellement / changement de plan) ─
  subscriptionPeriod: text("subscription_period"),
  autoRenew: boolean("auto_renew").notNull().default(true),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  scheduledPlan: text("scheduled_plan"),
  scheduledPlanPeriod: text("scheduled_plan_period"),
  scheduledPlanAt: timestamp("scheduled_plan_at", { withTimezone: true }),
  // Carte enregistrée via tokenisation HYP (HK/J5) — Phase D, gated.
  hypToken: text("hyp_token"),
  hypTokenExp: text("hyp_token_exp"),
  cardLast4: text("card_last4"),
  cardBrand: text("card_brand"),

  // Per-tenant Google integration. When refresh_token is null the agent
  // tools fall back to the global Google credentials in env. Calendar +
  // Sheets share the same OAuth scopes so one refresh_token covers both.
  googleRefreshToken: text("google_refresh_token"),
  googleCalendarId: text("google_calendar_id").notNull().default("primary"),
  googleSheetId: text("google_sheet_id").notNull().default(""),

  // Email verification gate : false jusqu'à ce que le user entre le code
  // à 4 chiffres reçu par mail. Bloque l'accès à /onboarding et /dashboard
  // tant que pas true (le user reste sur /verify-email après signup).
  emailVerified: boolean("email_verified").notNull().default(false),

  // Locale de l'utilisateur pour les emails transactionnels (verification,
  // welcome, trial warning, deleted). Saved at signup depuis l'URL locale
  // (/he/signup → 'he'). Default 'fr' = même que routing.defaultLocale.
  // Lookup pour les emails envoyés hors-request (cron, API routes).
  locale: text("locale").notNull().default("fr"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// 4-digit codes envoyés par email pour valider l'adresse au signup.
// Une ligne par tentative : on garde l'historique pour audit, le code
// "actif" est le plus récent non-consumé. Hash bcrypt du code en DB
// (jamais en clair). attempts incrémenté à chaque mauvaise saisie pour
// rate-limit (max 5 tentatives par code, après quoi il faut resend).
export const emailVerifications = pgTable("email_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const agentConfigs = pgTable("agent_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // Persona + voice config — exposed in dashboard.
  instructions: text("instructions").notNull(),
  greetingInstructions: text("greeting_instructions").notNull(),
  // Nom prononcé par l'agent dans la phrase d'accueil ("Bonjour, c'est Sarah").
  // Facultatif — peut rester vide si déjà encodé dans `instructions`.
  agentName: text("agent_name").notNull().default(""),
  model: text("model").notNull().default("gpt-realtime-2"),
  voice: text("voice").notNull().default("marin"),
  temperature: real("temperature").notNull().default(0.8),
  speed: real("speed").notNull().default(1.0),
  maxResponseTokens: integer("max_response_tokens").notNull().default(220),

  // WhatsApp number of the salon owner — receives a recap after every call.
  // Stored E.164 (e.g. +972585001007); empty = WhatsApp recap disabled.
  ownerWhatsapp: text("owner_whatsapp").notNull().default(""),

  // Default greeting language. The agent will use this for the very first
  // message of each call, then auto-detect and adapt to the caller. Values:
  // 'fr' | 'he' | 'en'.
  primaryLanguage: text("primary_language").notNull().default("fr"),

  // Rappel automatique J-1 envoyé au CLIENT la veille de son RDV (cron
  // /api/cron/appointment-reminders). Désactivé par défaut. WhatsApp uniquement
  // (on ne capture que le téléphone du client, pas son email) : template Twilio
  // Content avec fallback sur le template client approuvé. Le téléphone est lu
  // depuis l'event Google Calendar (ligne "Tel :" de la description).
  reminderEnabled: boolean("reminder_enabled").notNull().default(false),

  // Si false, le tenant n'hérite pas des blocs admin (spoken_time,
  // spoken_phone, hangup, per_call_context, config_blocks, admin_global)
  // dans son system prompt assemblé. Seuls persona + language directive
  // sont conservés. Activé par défaut pour préserver le comportement
  // historique. UI : checkbox + popup dans /dashboard/config et /admin.
  inheritAdminGlobals: boolean("inherit_admin_globals").notNull().default(true),

  personality: jsonb("personality")
    .$type<{
      joie?: number;
      empathie?: number;
      dynamisme?: number;
      vitesse?: number;
      creativite?: number;
      humour?: number;
      professionnel?: number;
      reactivite?: number;
      accent?: number;
    }>()
    .notNull()
    .default({}),

  // Niveau de réduction de bruit (ai-coustics Quail Voice Focus 2.1 L).
  // Échelle 1-10 → mappée vers enhancementLevel 0.1-1.0 côté worker.
  // 1 = quasi-désactivé (passthrough), 8 = équilibré (default), 10 = agressif.
  // Appliqué SUR LE CHEMIN TÉLÉPHONE (Twilio worker) et SUR LE CHEMIN WEB
  // (LiveTest via LiveKit, une fois Phase 2 shippée).
  noiseReductionLevel: integer("noise_reduction_level").notNull().default(8),

  // Base de connaissances tenant — array de "business" que l'agent peut
  // référencer. Legacy (deprecated 2026-05-28) : remplacé par `business`
  // colonne structurée. Conservé une release pour fallback worker.
  knowledge: jsonb("knowledge")
    .$type<
      Array<{
        id: string;
        toolName: string;
        businessName: string;
        openingHours: string;
        description: string;
      }>
    >()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // Données structurées du tenant : identité, centres (avec horaires hebdo)
  // et soins/tarifs. Remplace `knowledge` (array plat) à terme. Le worker
  // expose 5 tools fixes (list_centres, get_centre_info, get_opening_hours,
  // list_services, find_service) qui lisent cette structure.
  // Géré depuis /dashboard/config → tile "Business".
  business: jsonb("business")
    .$type<{
      identity: { name: string; tagline: string; email: string };
      centres: Array<{
        id: string;
        name: string;
        address: string;
        hours: Record<
          "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
          { open: boolean; openTime: string; closeTime: string }
        >;
      }>;
      services: Array<{
        id: string;
        name: string;
        durationMinutes: number;
        priceILS: number;
        centreIds: string[] | "all";
        description: string;
      }>;
      /** Free-text règles strictes injectées en system prompt. */
      centresRules?: string;
    }>()
    .notNull()
    .default(
      sql`'{"identity":{"name":"","tagline":"","email":""},"centres":[],"services":[]}'::jsonb`,
    ),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Log of every call handled by the agent. Stores raw transcript + AI summary
// + WhatsApp delivery sids so we can audit / re-send if needed.
export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  fromNumber: text("from_number").notNull().default(""),
  transcript: jsonb("transcript")
    .$type<Array<{ role: "user" | "assistant"; text: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  summary: text("summary").notNull().default(""),
  // Durée de l'appel en secondes (déjà présente en DB via migration 0021 ;
  // ajoutée au schéma pour aligner le code — utilisée par le moteur Finance).
  durationSeconds: integer("duration_seconds").notNull().default(0),

  whatsappClientSid: text("whatsapp_client_sid"),
  whatsappOwnerSid: text("whatsapp_owner_sid"),
  whatsappError: text("whatsapp_error"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ─── Outbound call center (campagnes sortantes) ──────────────────────────
// Un agent sortant réutilisable = une identité d'appel (voix + persona +
// business/connaissance + notifs + canaux). Plusieurs campagnes peuvent
// partager le même agent ; chaque campagne y associe son objectif + ses
// contacts. Découplé de `campaigns` (qui embarquait jusqu'ici la persona).
export const outboundAgents = pgTable("outbound_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Libellé affiché dans la liste des agents (ex: "Sarah — vente café").
  name: text("name").notNull(),
  // ─── Persona : voix + identité parlée ───
  agentName: text("agent_name").notNull().default("Sarah"),
  voice: text("voice").notNull().default("marin"),
  language: text("language").notNull().default("fr"),
  instructions: text("instructions").notNull().default(""),
  greeting: text("greeting").notNull().default(""),
  // ─── Business : ce que l'agent vend / représente (fiche distillée d'un
  //     ou plusieurs sites web + URLs sources affichées). ───
  knowledge: text("knowledge").notNull().default(""),
  knowledgeSources: jsonb("knowledge_sources")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  // ─── Notifications : destinataires des récaps post-appel. ───
  notifications: jsonb("notifications")
    .$type<{ whatsapp?: string; email?: string }>()
    .notNull()
    .default({}),
  // ─── Canaux : sur quels canaux l'agent opère (défauts ; le n° appelant
  //     précis est choisi par campagne). ───
  channels: jsonb("channels")
    .$type<{ phone?: boolean; whatsappVoice?: boolean }>()
    .notNull()
    .default(sql`'{"phone":true}'::jsonb`),
  // ─── Réglages voix (mêmes dimensions que l'agent entrant). Sliders UI 1-10
  //     mappés en speed/temperature/VAD au runtime (lib/voice-tuning.ts). ───
  personality: jsonb("personality")
    .$type<{ vitesse?: number; creativite?: number; reactivite?: number }>()
    .notNull()
    .default({}),
  noiseReductionLevel: integer("noise_reduction_level").notNull().default(8),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type OutboundAgent = typeof outboundAgents.$inferSelect;
export type NewOutboundAgent = typeof outboundAgents.$inferInsert;

// Une campagne = un objectif + une persona + une file de contacts à appeler
// en parallèle par des agents IA. Le worker poll les contacts `queued`
// (claim atomique), dial via trunk SIP sortant, puis POST le résultat.

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Agent sortant réutilisable associé. Nullable pendant la migration
  // (Phase 1 additive) ; backfillé pour les lignes existantes. Tant que
  // `campaign-config` ne JOIN pas encore l'agent (Phase 2), la persona
  // embarquée ci-dessous reste la source de vérité au runtime.
  agentId: uuid("agent_id").references(() => outboundAgents.id, {
    onDelete: "set null",
  }),
  // 'cold' | 'sales' | 'lead_gen' | 'marketing' | 'custom' — pilote le preset
  // de script + critères de succès injectés dans le prompt.
  goalPreset: text("goal_preset").notNull().default("custom"),
  // Objectif libre injecté dans le system prompt de l'agent.
  objective: text("objective").notNull().default(""),
  // Critère de succès de la campagne (lié à l'objectif) — injecté dans le
  // prompt + utilisé en analyse post-appel. Niveau campagne (Phase 2 :
  // extrait de persona.successCriteria).
  successCriteria: text("success_criteria").notNull().default(""),
  // 'draft' | 'running' | 'paused' | 'completed' | 'archived'
  status: text("status").notNull().default("draft"),
  // Caller-id E.164 (numéro appartenant au tenant — validé à la création).
  fromNumber: text("from_number").notNull().default(""),
  // Persona déplacée vers `outbound_agents` (Phase 2) ; colonne retirée en
  // Phase 3. La campagne référence un agent via `agentId`.
  // Schéma d'extraction défini par l'utilisateur → JSON typé par appel.
  extractionSchema: jsonb("extraction_schema")
    .$type<
      Array<{
        key: string;
        label: string;
        type: "string" | "number" | "boolean" | "enum";
        options?: string[];
        required?: boolean;
      }>
    >()
    .notNull()
    .default(sql`'[]'::jsonb`),
  // Nombre d'appels simultanés autorisés pour cette campagne.
  concurrency: integer("concurrency").notNull().default(3),
  retryRules: jsonb("retry_rules")
    .$type<{
      maxAttempts: number;
      retryOn: Array<"no_answer" | "busy" | "voicemail" | "failed">;
      backoffMinutes: number;
    }>()
    .notNull()
    .default(
      sql`'{"maxAttempts":1,"retryOn":[],"backoffMinutes":60}'::jsonb`,
    ),
  callWindow: jsonb("call_window")
    .$type<{
      timezone: string;
      days: number[]; // 0-6 (dim..sam)
      startHour: number;
      endHour: number;
      respectDnc: boolean;
    }>()
    .notNull()
    .default(
      sql`'{"timezone":"Asia/Jerusalem","days":[1,2,3,4,5],"startHour":9,"endHour":18,"respectDnc":true}'::jsonb`,
    ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// File d'attente de la campagne — une ligne par contact à appeler.
// `userId` dénormalisé pour le scoping worker sans jointure.
export const campaignContacts = pgTable(
  "campaign_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    contactName: text("contact_name").notNull().default(""),
    // Colonnes CSV/Excel custom → variables {{...}} de personnalisation.
    vars: jsonb("vars")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    // 'queued' | 'claimed' | 'calling' | 'completed' | 'failed'
    //   | 'no_answer' | 'voicemail' | 'busy' | 'skipped'
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    // Gate de backoff retry : ne pas re-claim avant cette date.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // Lease anti-double-dial : posé au claim, reset par le reaper si périmé.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byCampaignStatus: index("campaign_contacts_campaign_status_idx").on(
      t.campaignId,
      t.status,
    ),
  }),
);

// Une ligne par tentative d'appel terminée (miroir de `calls`).
export const campaignCalls = pgTable("campaign_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => campaignContacts.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Lien optionnel vers la table `calls` (réutilisation pipeline existante).
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  phoneNumber: text("phone_number").notNull().default(""),
  // 'connected' | 'no_answer' | 'voicemail' | 'busy' | 'failed'
  outcome: text("outcome").notNull().default("failed"),
  // Disposition auto-classifiée par l'IA (interested|callback|qualified|...).
  disposition: text("disposition").notNull().default(""),
  // 'positive' | 'neutral' | 'negative'
  sentiment: text("sentiment").notNull().default(""),
  summary: text("summary").notNull().default(""),
  transcript: jsonb("transcript")
    .$type<Array<{ role: "user" | "assistant"; text: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  // Champs extraits typés selon campaigns.extractionSchema.
  extracted: jsonb("extracted")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  // Coût en centimes pour le KPI cost-per-connect (rempli plus tard).
  costCents: integer("cost_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// One row per tenant-owned phone number. The agent looks up the called
// number on each inbound call to know which tenant's persona to load.
export const phoneNumbers = pgTable("phone_numbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // E.164 — globally unique. Index ensures fast lookup on every call.
  phoneNumber: text("phone_number").notNull().unique(),
  // Optional friendly label ("Cabinet principal", "Salon Tel Aviv", etc.).
  label: text("label").notNull().default(""),
  // Twilio resource SID so we can release the number when the tenant cancels.
  // Empty for legacy numbers attached manually before auto-provisioning.
  twilioSid: text("twilio_sid").notNull().default(""),
  // ISO country code for billing/UI ("US", "IL", ...).
  countryCode: text("country_code").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Une ligne par tentative de paiement HYP (abonnement one-shot). L'`id`
// uuid sert d'Order opaque envoyé à HYP : le handler de retour s'y fie pour
// connaître le plan/montant/devise ATTENDUS (jamais déduit du client). Voir
// docs/superpowers/specs/2026-06-03-hyp-payment-design.md.
//
// Sécurité : au retour HYP, on VERIFY côté serveur (HYP re-signe → un retour
// forgé ne peut pas falsifier CCode=0) PUIS on compare Order+Amount+Coin
// retournés à cette ligne. hyp_transaction_id unique = anti-rejeu/idempotence.
export const paymentOrders = pgTable("payment_orders", {
  // Order opaque envoyé à HYP (param `Order`).
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // Plan/période achetés — figés au moment de la création de l'ordre.
  planKey: text("plan_key").notNull(),
  period: text("period").notNull(), // 'monthly' | 'annual'
  // Nature de l'ordre pour les reçus/audit : 'subscription' | 'renewal' | 'plan_change'.
  kind: text("kind").notNull().default("subscription"),
  // Devise résolue côté serveur depuis users.locale (he→ILS, sinon EUR).
  currency: text("currency").notNull(), // 'ILS' | 'EUR'
  coin: text("coin").notNull(), // '1' (ILS) | '3' (EUR) — param HYP `Coin`
  // Montant attendu, comparé au montant retourné par HYP au VERIFY.
  expectedAmount: real("expected_amount").notNull(),
  // 'pending' (créé) | 'paid' (vérifié + activé) | 'failed' (refusé/abandonné).
  status: text("status").notNull().default("pending"),
  // Référence transaction HYP (Id) posée à l'activation. Unique → idempotence.
  hypTransactionId: text("hyp_transaction_id").unique(),
  // Réponse VERIFY brute (debug / audit / litige).
  rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  // Au-delà de cette date l'ordre pending n'est plus activable (anti-rejeu).
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

// Cache de l'audio d'accueil pré-généré (PCM16 24kHz mono) joué instantanément
// au décroché par le worker. Une ligne par (tenant, texte d'opener, voix,
// langue, version de rendu). Régénéré quand le texte/voix change (text_hash ou
// voice change) ou quand render_version est bumpé. Voir
// docs/superpowers/specs/2026-06-04-instant-greeting-design.md.
export const greetingAudio = pgTable(
  "greeting_audio",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    textHash: text("text_hash").notNull(),
    voice: text("voice").notNull(),
    language: text("language").notNull(),
    renderVersion: integer("render_version").notNull().default(1),
    audioPcm: bytea("audio_pcm").notNull(),
    sampleRate: integer("sample_rate").notNull().default(24000),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    uniq: unique("greeting_audio_key").on(
      t.userId,
      t.textHash,
      t.voice,
      t.language,
      t.renderVersion,
    ),
  }),
);

// Idempotence des rappels de RDV J-1. Les RDV vivent uniquement dans Google
// Calendar (pas de table dédiée), donc on trace ici chaque rappel envoyé pour
// ne JAMAIS doubler si le cron repasse. Clé unique (user_id, event_id).
export const appointmentReminders = pgTable(
  "appointment_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ID de l'événement Google Calendar du RDV.
    eventId: text("event_id").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    status: text("status").notNull(), // "sent" | "failed"
    clientPhone: text("client_phone").notNull().default(""),
    error: text("error").notNull().default(""),
    // Début du RDV (UTC) — utile pour l'audit / debug.
    appointmentStart: timestamp("appointment_start", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    uniq: unique("appointment_reminders_user_event").on(t.userId, t.eventId),
  }),
);

// Append-only event log. Surfaced live in /dashboard/logs so the operator
// can see end-to-end call/tool/whatsapp activity without grepping Railway logs.
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  // 'info' | 'warn' | 'error' — drives the badge colour in the dashboard.
  level: text("level").notNull().default("info"),
  // 'agent' | 'web' | 'calendar' | 'sheets' | 'whatsapp' | 'auth' | 'tenant'
  source: text("source").notNull(),
  // Stable machine-readable event name, e.g. 'call_received', 'tool_invoked'.
  event: text("event").notNull(),
  // Human-readable one-line summary.
  message: text("message").notNull(),
  // Free-form structured payload (call ids, durations, errors, etc.)
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// Singleton key-value store for app-wide settings (system prompt that
// every tenant inherits, default Twilio config, etc.). Read-mostly so a
// single row per key is fine.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;
export type NewPhoneNumber = typeof phoneNumbers.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type NewAgentConfig = typeof agentConfigs.$inferInsert;
export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type CampaignContact = typeof campaignContacts.$inferSelect;
export type NewCampaignContact = typeof campaignContacts.$inferInsert;
export type CampaignCall = typeof campaignCalls.$inferSelect;
export type NewCampaignCall = typeof campaignCalls.$inferInsert;
