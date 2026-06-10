# Architecture de Tamara (app web)

> Guide de lecture du code pour un développeur qui découvre le projet.
> Dernière mise à jour : 2026-06-10.

## C'est quoi, ce repo ?

**Tamara** est un SaaS multi-tenant de **secrétaire vocale IA** : chaque client
(« tenant ») a un numéro de téléphone ; un agent vocal IA (OpenAI Realtime)
répond à ses appels, prend des RDV dans Google Calendar, enregistre les
contacts, envoie des récapitulatifs WhatsApp, et peut passer des appels
sortants (campagnes).

Ce repo contient **l'application web** (Next.js) : site marketing, dashboard
client, interface admin, et toutes les routes API. L'**agent vocal temps réel**
vit dans un repo séparé (`assistAI-claude-agent`, le « worker »), déployé sur
Railway, qui consomme les APIs `/api/agent/*` de ce repo.

```
   Appel entrant ──► Twilio ──► LiveKit SIP ──► Worker (repo séparé, Railway)
                                                  │  GET /api/agent/config
                                                  │  POST /api/calls/end
                                                  ▼
                                            Ce repo (web, Railway)
                                                  │
                                       Postgres · Google APIs · WhatsApp
```

## Stack

| Brique | Choix |
| --- | --- |
| Framework | Next.js 16 (App Router) — ⚠️ lire `AGENTS.md` : version avec breaking changes, docs dans `node_modules/next/dist/docs/` |
| Langage | TypeScript strict |
| Base de données | Postgres + Drizzle ORM (`lib/db/`, migrations dans `drizzle/`) |
| Auth | next-auth v5 (Google OAuth + email/mot de passe) — `auth.ts` |
| i18n | next-intl, locales `fr` (défaut) / `he` (RTL) / `en` — `i18n/`, traductions dans `messages/*.json` |
| Téléphonie | Twilio (numéros, SIP trunk) + LiveKit (SFU, SIP) |
| IA | OpenAI Realtime (voix, côté worker) + OpenAI API (scan de site, résumés) |
| Notifications | WhatsApp (templates Twilio Content), email (Resend) |
| Paiement | HYP (passerelle israélienne) — `lib/hyp.ts` |
| Déploiement | **Railway** (web + worker). L'intégration Vercel visible sur les PRs n'est qu'une preview. |

## Arborescence commentée

```
app/
  [locale]/              Pages localisées (préfixe /fr /he /en)
    page.tsx               Landing marketing (démo vocale anonyme incluse)
    login/ signup/ verify-email/
    onboarding/            Wizard post-signup : connexion Google + choix numéro
    dashboard/             Espace client (le cœur du produit)
      config-form.tsx        Orchestrateur du formulaire de config agent
      config/                Modules du formulaire (panels, sections, types…)
      calendar/ contacts/ logs/ billing/ campaigns/ settings/
    dashboard-preview/     Previews visuelles non-prod (palettes, redesign)
  admin/                 Interface admin (volontairement NON localisée)
    users/[userId]/        Vue tenant — réutilise les composants /dashboard
                           via la prop asUserId (impersonation lecture)
    finance/               Dashboard coûts/revenus/marge
  api/                   Routes API (voir section dédiée)
  dashboard/ login/ …    Redirects de compat → /<locale>/…

components/              Composants partagés (landing, démo vocale, UI)
  VoiceAgent.tsx           Démo vocale publique de la landing (WebRTC direct)
  LiveTestPanel.tsx        Test live du dashboard (WebRTC direct, 40s)
  LiveTestPanelLK.tsx      Variante LiveKit (pipeline identique à la prod)
  marketing/               Sections de la landing

lib/                     Logique métier (voir section dédiée)
i18n/                    Config next-intl (routing, navigation, request)
messages/                fr.json / he.json / en.json
drizzle/                 Migrations SQL générées (drizzle-kit)
scripts/
  migrate.mjs              Lancé par `npm start` avant le serveur (Railway)
  tests/                   Tests unitaires (tsx) : `npm test`
proxy.ts                 Middleware : i18n marketing + headers sécurité
auth.ts auth-handlers.ts next-auth v5 (providers, callbacks, provisioning)
```

## Les routes API (`app/api/`)

Trois familles, trois modes d'auth — **toujours passer par les guards
centralisés de `lib/api/auth-guards.ts`** :

| Préfixe | Qui appelle | Guard |
| --- | --- | --- |
| `/api/dashboard/*`, `/api/calendar/*`, `/api/google/*`, `/api/onboarding/*`, `/api/sheets/*` | Le navigateur du client connecté | `requireSession()` ou `resolveTargetUserId()` (supporte `?asUserId=` pour l'admin) |
| `/api/admin/*` | Le navigateur d'un admin | `requireAdmin()` |
| `/api/agent/*`, `/api/calls/end`, `/api/cron/*`, `/api/admin/internal-*` | Machine : worker Railway, crons | `requireInternalSecret(req)` (header `x-internal-secret`) |

Cas particuliers :
- `/api/session` + `/api/demo-config` : démo vocale anonyme de la landing
  (pas d'auth, quotas/caps côté code).
- `/api/twilio/voice-bridge` : webhook TwiML appelé par Twilio.
- `/api/dashboard/hyp/callback` : callback de paiement HYP (signature vérifiée).
- `/api/admin/internal-*` : outils d'ops gardés long terme (debug/admin via
  secret interne).

Conventions :
- Codes : `401` = pas authentifié (session ou secret manquant/faux),
  `403` = authentifié mais pas le droit, `400` = body invalide.
- Body JSON : `parseJsonBody<T>()` de `lib/api/request-parsing.ts`.
- Tout événement métier significatif → `logEvent()` (`lib/logger.ts`),
  visible dans /dashboard/logs et /admin.

## La lib (`lib/`)

Modules principaux, par domaine :

**Agent & prompts**
- `agent-prompt-defaults.ts`, `agent-prompt-preview.ts`, `personality.ts`,
  `voice-tuning.ts` — construction du system prompt de l'agent (persona +
  directives admin per-plan + base de connaissances + détails métier).
- `opener.ts`, `greeting-render.ts`, `greeting-audio-storage.ts`,
  `greeting-warm.ts` — phrase d'accueil pré-générée en audio (latence).
- `realtime.ts`, `realtime-events.ts`, `use-realtime-catalog.ts` — accès
  OpenAI Realtime côté web (démo/test live) + catalogue modèles/voix.

**Tenants & téléphonie**
- `tenant.ts` — résolution numéro appelé → tenant (⚠️ si la row
  `phone_numbers` manque, fallback silencieux sur un autre tenant).
- `twilio-numbers.ts` (achat/release de numéros Twilio) +
  `livekit-sip.ts` (rattachement au trunk LiveKit). Les deux vont ensemble :
  après `purchaseNumber()`, toujours `addNumberToTrunk()`.
- `sync-tenant.ts`, `release-user.ts`, `auth/provision-tenant.ts`.

**Métier**
- `business.ts` — config métier du tenant (centres, prestations, horaires,
  base de connaissances) injectée dans le prompt.
- `schedule.ts`, `tz.ts` — créneaux et fuseaux (Jérusalem), source de vérité
  timezone unique dans `tz.ts`.
- `google.ts`, `sheets-helpers.ts` — Calendar + Sheets du tenant.
- `website-scan/` — « Remplir depuis mon site web » : crawl (avec garde
  SSRF), agents d'extraction OpenAI, merge dans la config.
- `campaigns/` — appels sortants : import contacts, dispatch, dial LiveKit,
  analyse des résultats. `outbound-agents/` — agents IA sortants réutilisables.

**Facturation & plans**
- `plans.ts`, `plan-features.ts` + `plan-features-storage.ts` (matrice
  plan × feature éditable depuis /admin), `plan-pricing*.ts`, `plan-i18n.ts`.
- `subscription.ts`, `billing-activation.ts`, `billing-pricing.ts`,
  `trial.ts`, `hyp.ts` (paiement), `finance/` (coûts + marges admin).

**Notifications**
- `whatsapp.ts` (provider Meta ou Twilio, fallback template), `email.ts`
  (Resend), `reminders.ts` (rappel RDV J-1), `summarize.ts` (récap post-appel).

**Transverse**
- `db/` (client + schéma Drizzle), `settings.ts` (clé/valeur `app_settings`,
  helper `getJsonSetting`), `logger.ts`, `phone-utils.ts` (normalisation
  téléphone — LA référence, ne pas redéfinir localement), `numbers.ts`
  (`clamp`), `api/` (guards + parsing), `app-origin.ts`, `verify-code.ts`,
  `admin-impersonate.ts`.

## Modèle de données (tables Drizzle, `lib/db/schema.ts`)

- `users` — tenant = user. Plan, statut d'abonnement, trial, tokens Google,
  rôle (`admin`).
- `agentConfigs` — config de l'agent du tenant (prompt, voix, langue,
  personnalité, métier en jsonb, base de connaissances…).
- `phoneNumbers` — mapping numéro → tenant (routing des appels entrants).
- `calls` — historique d'appels + métriques de latence.
- `outboundAgents`, `campaigns`, `campaignContacts`, `campaignCalls` —
  appels sortants.
- `paymentOrders` — commandes HYP (la vérité sur les montants).
- `greetingAudio` — cache audio des phrases d'accueil.
- `appointmentReminders` — rappels WhatsApp J-1.
- `events` — journal d'événements (logs dashboard/admin).
- `appSettings` — clé/valeur global admin (directives per-plan, matrice
  features, tarifs, rate cards…).
- `emailVerifications` — codes de vérification email.

## Flux principaux

### 1. Appel entrant
1. Twilio reçoit l'appel → trunk SIP → LiveKit → le **worker** rejoint la room.
2. Worker → `GET /api/agent/config?number=…` (secret interne) : ce repo
   résout le tenant (`lib/tenant.ts`) et renvoie prompt + voix + features.
3. Pendant l'appel, l'agent utilise des **tools déterministes** (dispo
   calendrier, prise de RDV…) → routes `/api/calendar/*`.
   Règle maison : la logique métier vit dans les tools, pas dans le prompt.
4. Fin d'appel : worker → `POST /api/calls/end` → résumé OpenAI, log,
   récap WhatsApp client + propriétaire, enregistrement contact.

### 2. Onboarding d'un tenant
signup (`auth.ts`) → vérification email → wizard `/onboarding` : connexion
Google (OAuth via `/api/onboarding/google/*`) → choix d'un numéro →
`/api/onboarding/provision` (achat Twilio + trunk LiveKit + row
`phone_numbers`) → dashboard. Trial 1 jour (`lib/trial.ts`, cron
`trial-cleanup`).

### 3. Configuration de l'agent (dashboard)
`/dashboard` = grille de tuiles (`config-form.tsx` + `config/`).
Sauvegarde → `PUT /api/dashboard/config` → invalidation du cache greeting →
le prochain appel utilise la nouvelle config. « Remplir depuis mon site web »
→ `/api/dashboard/scan-website` (stream NDJSON d'agents d'extraction).

### 4. Campagnes sortantes
`/dashboard/campaigns` : créer un agent sortant → importer des contacts
(CSV/XLSX) → lancer. Le cron `campaign-dispatch` claim des contacts
(`lib/campaigns/claim.ts`) et déclenche les appels LiveKit sortants ;
résultats analysés et remontés (`/api/agent/campaign-result`).

### 5. Billing
Plans (whatsapp / global / premium…) × période. Paiement HYP
(`/api/dashboard/hyp/*`), activation `billing-activation.ts`, cron `billing`
pour les renouvellements/expirations. Admin : `/admin/finance` (coûts réels
via `POST /api/agent/usage`).

## Crons (Railway)

| Route | Rôle |
| --- | --- |
| `/api/cron/trial-cleanup` | Email H-2 + suppression des trials expirés |
| `/api/cron/billing` | Renouvellements / expirations d'abonnements |
| `/api/cron/campaign-dispatch` | Moteur des campagnes sortantes |
| `/api/cron/appointment-reminders` | Rappels WhatsApp J-1 |
| `/api/cron/sync-tenants` | Resync périodique des tenants |

Tous protégés par `requireInternalSecret`.

## Conventions du repo

- **Commentaires en français**, orientés « pourquoi » (le « comment » doit se
  lire dans le code).
- **Noms longs et explicites** plutôt que courts et ambigus.
- **i18n obligatoire** pour tout texte visible dans `app/[locale]/` :
  clé dans `messages/{fr,he,en}.json`, jamais de chaîne en dur.
  Exception : `/admin` et les previews (non localisés, français assumé).
- **`NextIntlClientProvider` est dans `app/[locale]/layout.tsx`** (pas le
  root layout) — ne pas le déplacer, sinon le switcher de langue casse en
  navigation douce.
- **Liens** : `Link` de `@/i18n/navigation` dans les pages localisées ;
  `NextLink` (next/link) pour `/admin` et previews ; `<a>` natif uniquement
  pour les routes API OAuth (utiliser `components/ConnectGoogleLink.tsx`).
- **Pas de règle métier dans le prompt de l'agent** : toujours un tool
  déterministe côté API.
- **Erreurs** : ne jamais avaler une erreur sans commentaire expliquant
  pourquoi c'est best-effort.

## Démarrer en local

```bash
npm install
cp .env.local.example .env.local   # si présent — sinon demander les secrets
npm run db:migrate                 # applique drizzle/ sur DATABASE_URL
npm run dev                        # http://localhost:3000
npm test                           # tests unitaires (scripts/tests/)
npx tsc --noEmit && npx eslint .   # à faire passer avant tout commit
```

## Pièges connus (lire avant de débugger)

- **« Mon changement de prompt n'a aucun effet »** → vérifier d'abord la row
  `phone_numbers` du tenant : si elle manque, l'agent fallback silencieusement
  sur un autre tenant.
- **Accueil tronqué/doublé en démo** → collision VAD auto-response +
  `response.create` : le micro doit rester coupé pendant l'accueil.
- **OpenAI Realtime refuse `temperature`** → param déprécié côté API GA ;
  le slider créativité n'est plus branché (voir commentaires dans
  `LiveTestPanel.tsx`).
- **Redirects en `:8080`** → voir le strip du port dans `proxy.ts`
  (spécificité Railway).
