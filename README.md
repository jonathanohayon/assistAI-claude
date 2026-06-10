# Tamara — app web

SaaS multi-tenant de **secrétaire vocale IA** : chaque client a un numéro de
téléphone, un agent vocal (OpenAI Realtime) répond à ses appels, prend des RDV
Google Calendar, enregistre les contacts, envoie des récaps WhatsApp et gère
des campagnes d'appels sortants.

Ce repo = **l'application web** (Next.js 16) : landing, dashboard client,
admin, et toutes les routes API. L'agent vocal temps réel vit dans le repo
séparé `assistAI-claude-agent` (le « worker »).

> 📖 **Commencer par [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** : vue
> d'ensemble, arborescence commentée, flux principaux, conventions et pièges
> connus.

## Démarrage rapide

```bash
npm install
# Secrets dans .env.local (DATABASE_URL, OPENAI_API_KEY, TWILIO_*, LIVEKIT_*,
# INTERNAL_SECRET, RESEND_API_KEY, HYP_*, …) — demander à Jonathan.
npm run db:migrate     # applique les migrations drizzle/
npm run dev            # http://localhost:3000
```

## Commandes utiles

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de dev |
| `npm run build` | Build prod (à faire passer avant toute PR) |
| `npm test` | Tests unitaires (`scripts/tests/*.test.ts`, runner tsx) |
| `npx tsc --noEmit` | Type-check strict |
| `npx eslint .` | Lint (0 erreur attendu) |
| `npm run db:generate` | Génère une migration après modif de `lib/db/schema.ts` |
| `npm run db:migrate` | Applique les migrations |
| `npm run db:studio` | Explorateur de BDD Drizzle |

## Déploiement

**Railway** (web + worker + Postgres). Le déploiement part de `main` ;
`npm start` applique les migrations (`scripts/migrate.mjs`) avant de lancer
le serveur. Les crons Railway appellent les routes `/api/cron/*` (protégées
par `INTERNAL_SECRET`).

⚠️ L'intégration Vercel visible sur les PRs GitHub n'est qu'une **preview** —
ce n'est pas le déploiement de prod.

## Avant de coder

- Lire `AGENTS.md` : la version de Next.js utilisée a des breaking changes,
  les guides à jour sont dans `node_modules/next/dist/docs/`.
- Lire [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), en particulier les
  sections **Conventions** et **Pièges connus**.
- Tout texte visible dans `app/[locale]/` passe par next-intl
  (`messages/{fr,he,en}.json`) — jamais de chaîne en dur.
