# Centre d'appels sortant — ops & contrat worker

Feature : campagnes d'appels sortants IA (cold/sales/lead-gen/marketing). Visible
sur tous les plans, activée sur `premium` + admin (flag `outbound_campaigns`).

## Schéma DB

`campaigns`, `campaign_contacts` (file d'attente), `campaign_calls` (résultats).
Migration : `drizzle/0020_*.sql`. Régénérer : `npm run db:generate && npm run db:migrate`.

## Flux

1. Dashboard → tuile « Centre d'appels sortant » → workspace : créer campagne,
   importer contacts (paste / CSV / Excel / Google Sheets), lancer.
2. Un **dialer** réclame les contacts dûs (claim atomique `FOR UPDATE SKIP LOCKED`,
   respecte status `running`, fenêtre d'appel timezone, concurrence/campagne) et
   origine les appels via LiveKit SIP sortant en dispatchant l'agent worker.
3. L'agent worker conduit l'appel (config via `/api/agent/campaign-config`) puis
   poste le résultat à `/api/agent/campaign-result` (analyse IA : résumé +
   disposition + sentiment + extraction ; transition contact ; retry ;
   auto-complétion de la campagne).

## Deux architectures de dialing (en choisir UNE)

- **Web cron (recommandé)** : `GET /api/cron/campaign-dispatch?limit=N`
  (`x-internal-secret`). Hooker sur le scheduler Railway toutes les ~30–60 s.
  Le web réclame + dial + dispatch l'agent. Le worker ne fait que l'agent.
- **Worker-poll** : le worker `GET /api/agent/campaign-jobs?limit=N`
  (`x-internal-secret`) et dial lui-même. Dans ce cas NE PAS activer le cron web
  (sinon double-claim).

## Infra LiveKit/Twilio sortant (prérequis, console)

1. Twilio Elastic SIP Trunking : créer un trunk, noter le **Termination URI**,
   Credential List (user/pass), activer les **Geographic Permissions** des pays
   de destination, et disposer de numéros/caller-ids vérifiés.
2. Provisionner le trunk sortant LiveKit :
   ```
   SIP_OUTBOUND_ADDRESS=xxx.pstn.twilio.com \
   SIP_OUTBOUND_NUMBERS=+972...,+33... \
   SIP_OUTBOUND_USER=... SIP_OUTBOUND_PASS=... \
   npx tsx scripts/setup-outbound-trunk.mts
   ```
   → copier `LIVEKIT_OUTBOUND_TRUNK_SID=...` dans l'env (web + worker).

## Env

| Var | Où | Rôle |
|-----|-----|------|
| `LIVEKIT_OUTBOUND_TRUNK_SID` | web + worker | trunk SIP sortant |
| `INTERNAL_SECRET` | web + worker | RPC web↔worker (déjà set) |
| `LIVEKIT_URL/_API_KEY/_API_SECRET` | web + worker | déjà set |
| `SIP_OUTBOUND_*` | setup only | provisioning du trunk |
| `CAMPAIGN_ANALYZE_MODEL` | web (option) | modèle analyse post-appel |

## Contrat worker (déjà implémenté côté `~/Desktop/assistAI-claude-agent`)

- `src/origin.ts` : détecte `source:'campaign'` dans `ctx.job.metadata`.
- `src/config-fetcher.ts` : `origin.kind==='campaign'` → `/api/agent/campaign-config`.
- `src/post-call.ts` / `agent.ts` : fin d'appel → `postCampaignResult()` →
  `/api/agent/campaign-result`.

Le dispatch (web ou worker) passe `metadata = {source:'campaign', campaignId,
contactId, userId}` à `createDispatch` + `createSipParticipant` (cf.
`lib/livekit-sip-outbound.ts`).
