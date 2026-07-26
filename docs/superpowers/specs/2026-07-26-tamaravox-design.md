# Cahier des charges — tamaravox.com

**Tamara — The voice + phone layer for AI agents**
Design doc / spec · 2026-07-26 · v1.0
Statut : **en attente de relecture founder** avant passage au plan d'implémentation (`writing-plans`).

> Produit dans ce doc = **nouveau frontend beta** (`tamaravox.com`) posé sur le backend voix **existant** (repo `tamara`, worker `assistAI-claude-agent`). Repositionnement : de « réceptionniste vocale pour cliniques » → **couche voix + téléphone que l'on branche sur n'importe quel agent AI existant**.

---

## Table des matières

1. [Objectif & contrainte structurante](#1-objectif--contrainte-structurante)
2. [Décisions verrouillées](#2-décisions-verrouillées)
3. [Positionnement & narratif](#3-positionnement--narratif)
4. [Thèse d'acquisition](#4-thèse-dacquisition)
5. [Architecture technique](#5-architecture-technique)
6. [Le delta backend : mode « webhook agent »](#6-le-delta-backend--mode-webhook-agent)
7. [Design system (vox)](#7-design-system-vox)
8. [Architecture de l'information & pages](#8-architecture-de-linformation--pages)
9. [Spec — Homepage `/`](#9-spec--homepage-)
10. [Spec — `/connect` (surface héro)](#10-spec--connect-surface-héro)
11. [Spec — `/pricing`](#11-spec--pricing)
12. [Spec — `/docs`](#12-spec--docs)
13. [Spec — `/login` & `/signup`](#13-spec--login--signup)
14. [Les 3 « wow moments »](#14-les-3-wow-moments)
15. [Non-fonctionnel (perf, a11y, RTL, SEO)](#15-non-fonctionnel-perf-a11y-rtl-seo)
16. [Plan d'exécution](#16-plan-dexécution)
17. [Definition of Done & critères d'acceptation](#17-definition-of-done--critères-dacceptation)
18. [Risques & points ouverts](#18-risques--points-ouverts)
19. [Hors périmètre (YAGNI)](#19-hors-périmètre-yagni)

---

## 1. Objectif & contrainte structurante

Créer un nouveau frontend beta **professionnel et futuriste** pour Tamara, réutilisant **exactement** le backend actuel (auth, API, téléphonie, voix), cohabitant avec aitamara.com.

**La contrainte qui pilote tout n'est pas marketing.** Le founder veut **vendre l'entreprise sous ~1 mois pour plusieurs millions**. Conséquence : le site n'est pas « une jolie beta », c'est un **actif d'acquisition**. Chaque écran sert **deux publics simultanément** :

- **Le client** (entreprise qui a déjà un agent AI) → doit comprendre en 5 s, essayer, et pouvoir payer. Sa présence = **traction**.
- **L'acquéreur** (consolidateur voice-infra type Vapi / Retell / Bland) → doit voir une **infrastructure réelle, en production, de-riskée**, moins chère à racheter qu'à reconstruire.

Règle transverse validée avec le founder : **angle acquisition visible mais élégant** — on n'écrit jamais « à vendre » ; on rend les **preuves** (télémétrie live, démo réelle, breadth téléphonie, trilingue) impossibles à ignorer.

---

## 2. Décisions verrouillées

| # | Décision | Choix arrêté |
|---|----------|--------------|
| Client cible | À qui on vend le produit | Entreprises / équipes produit / agences **ayant déjà un agent AI** (CFO, support, sales, interne) et voulant le rendre joignable par téléphone. |
| Acquéreur cible | Qui rachète la boîte | **Consolidateur voice-infra** (Vapi / Retell / Bland) — thèse par défaut, pas d'acquéreur nommé à ce jour. |
| Langue | Site tamaravox.com | **Bilingue EN + FR, EN par défaut.** (HE reste une *capacité produit* mise en avant, pas une langue d'UI marketing complète.) |
| Architecture | Où vit le frontend | **Même repo `tamara`, nouveau route group `(vox)`** — réutilise auth, types, API, déploiement. |
| `/connect` | Nature de la démo | **Vraie démo « appelle ton agent »** branchée sur la stack voix existante (LiveKit/Twilio/Realtime), en 2 phases (A : demo agent réel ; B : proxy webhook BYO). |
| Ton acquisition | Visibilité | **Visible mais élégant** (télémétrie & preuves intégrées, jamais de mention « for sale »). |

---

## 3. Positionnement & narratif

**Catégorie possédée :**
- EN — *The voice and phone layer for AI agents.*
- FR — *La couche voix et téléphonie des agents IA.*

**Positionnement (1 phrase) :** Tamara se branche sur n'importe quel agent AI que vous exécutez déjà et le rend appelable — un vrai numéro, une voix humaine naturelle en EN/FR/HE, une réponse en moins de 300 ms, en ligne en quelques minutes.

**Essence 3 mots :** *Agents, now callable.*

**Système de taglines (final Fable) :**

| Usage | EN | FR |
|-------|----|----|
| Hero (H1) | **Give your AI agents a voice — and a phone number.** | **Donnez une voix — et un numéro — à vos agents IA.** |
| Deck / billboard | Your agents are smart. Now they pick up. | Vos agents sont intelligents. Maintenant, ils décrochent. |
| Alt 1 | Every agent deserves a phone number. | Chaque agent mérite un numéro de téléphone. |
| Alt 2 | Intelligence, now reachable. | L'intelligence, enfin joignable. |
| Alt 3 | From webhook to hello in minutes. | Du webhook au « allô » en quelques minutes. |
| Alt 4 | The phone line for AI. | La ligne téléphonique de l'IA. |

**Voix de marque (règle absolue, appliquée à toute la copy) :** *« Writes like an engineer, lands like a headline »* — phrases déclaratives courtes, présent, **tous les chiffres en monospace**, et **jamais de point d'exclamation** (y compris toasts et erreurs).

**Le mot « vox » :** la marque parlée reste **Tamara**. `vox` ne vit que dans le domaine, stylé `tamaravox.com` avec `vox` en `--text-muted` — lu comme un suffixe d'infra (à la `.dev`), sans renommer l'entreprise qu'un acquéreur rachète.

---

## 4. Thèse d'acquisition

Le marché voice-AI s'est scindé en deux : **les plateformes où l'on *construit* l'agent** (Vapi, Retell, Bland) et **les entreprises qui ont déjà construit le leur** et refusent de le reconstruire ailleurs. **Tamara possède le second** : la couche voix + téléphone **BYO-agent** qui se branche sur un agent existant via une seule API.

**Les 3 preuves affichées sur le site (de-risk de l'achat) :**
1. **Télémétrie de production live** — le *Latency Wall* streame des p50/p95 réels du trafic ; aucun mockup.
2. **Appelable depuis la page** — un vrai numéro provisionné répond 24/7 en 3 langues ; une due diligence commence par un appel.
3. **Surface d'intégration documentée** — un spec public « connectez votre agent » (un endpoint, un exemple de config) qui prouve que « minutes-to-live » est de l'architecture, pas du copywriting.

**Ligne « acquisition-grade » (bas de page pricing) :** *Revenu récurrent + minutes mesurées, facturés par le pipeline multi-tenant qui porte les appels de production aujourd'hui. Le coût à la minute est fixe au niveau opérateur — la marge tient à 10× le volume sans renégocier un seul contrat.*

---

## 5. Architecture technique

### 5.1 Stack réelle (corrige le brief)

| Élément | Réalité repo (à respecter) | Note vs brief |
|---------|----------------------------|---------------|
| Framework | **Next.js 16.2.4**, App Router | ⚠️ Brief disait « 15 ». `AGENTS.md` : *« This is NOT the Next.js you know »* → **lire `node_modules/next/dist/docs/` avant tout code**. |
| Langage | TypeScript strict | — |
| Styling | **Tailwind CSS v4** (`@import "tailwindcss"` + `@theme inline`) | Tokens = CSS vars scopables. |
| Animation | **`motion` v12** (import `motion/react`) | ⚠️ Pas `framer-motion`. Suivre le skill `motion`. |
| i18n | **next-intl v4**, segment `[locale]` (fr/he/en), `messages/` | Réutilisable. |
| Auth | **NextAuth (Auth.js)** — Credentials + Google, JWT, idle 1h, basePath `/api/admin/auth`, pages `login`/`signup`/`verify-email` | Réutilisée telle quelle, restylée vox. |
| Voix/tel | LiveKit SIP (`tamarProjectv1` Frankfurt), Twilio trunk (`;edge=frankfurt`), OpenAI Realtime (US forced) | Backend worker `~/Desktop/assistAI-claude-agent/`. |
| Deploy | **Railway** (europe-west4) | Domaine `tamaravox.com` ajouté au même service web. |

### 5.2 Cohabitation & routage par host

Le nouveau frontend vit dans le **même repo/déploiement**. Séparation par **host** dans le middleware Next :

- `tamaravox.com` → surface **`(vox)`** (EN par défaut).
- `aitamara.com` (+ tout host existant) → surface historique `[locale]` inchangée.

```
app/
  (vox)/                     ← nouveau route group, host tamaravox.com
    layout.tsx               ← <html class="vox"> + fonts vox + <VoxThemeProvider>
    page.tsx                 ← Homepage EN (défaut)
    connect/page.tsx
    pricing/page.tsx
    docs/page.tsx
    (auth réutilise /login /signup existants, restylés)
  [locale]/ …                ← site historique, intact
  api/ …                     ← backend partagé, intact
middleware.ts                ← + branche host → (vox) | [locale]
components/vox/              ← design system + sections dédiés (isolés)
messages/vox/{en,fr}.json    ← namespace i18n dédié
```

**Principe d'isolation :** aucun composant `(vox)` n'importe un composant du site historique et réciproquement, **sauf** les primitives backend/serveur partagées (auth handlers, clients API, types Drizzle). Objectif : zéro régression sur aitamara.com.

### 5.3 i18n de la surface vox

- Deux locales marketing : **`en` (défaut)** et `fr`. Messages dans `messages/vox/en.json` + `messages/vox/fr.json` (namespace séparé du site clinique pour ne pas polluer).
- Sélecteur EN/FR discret (header). URL : `/` = EN, `/fr` = FR (ou cookie `NEXT_LOCALE` + `?lang`). Décision d'implémentation : **path-based** (`/fr/...`) pour le SEO — meilleur pour la valeur d'acquisition (pages indexées FR + EN).
- **HE** n'est pas une locale d'UI marketing ici ; c'est une **capacité produit** démontrée dans `/connect` (voix + switch de langue) et citée dans la copy. (Évite de tripler la charge de copy, garde le trilingue comme *preuve* plutôt que comme surface.)

### 5.4 Réutilisation backend (contrats existants)

Aucun nouveau service marketing. Endpoints réutilisés :

- **Auth** : `/api/admin/auth/*` (NextAuth), `/api/auth/login`, `/api/auth/verify-email`, `/api/auth/resend-verification`.
- **Voix / démo** : `/api/livekit/*`, `/api/realtime/*`, `/api/agent/config`, `/api/agent/greeting-audio`, `/api/twilio/*`. Composants réutilisables : `LiveTestPanelLK`, `VoiceAgent`.
- **Plans / pricing** : `lib/plans` (`PLANS`, `PlanKey`), `lib/plan-features`. ⚠️ Les plans actuels sont pensés « clinique » — le pricing vox (§11) introduit **de nouveaux tiers** (Line/Trunk/Exchange/Carrier). Décision : le pricing vox est **présentation-only en Phase 1** (pas de refonte du billing) ; le mapping vers `lib/plans`/Stripe est un item Phase B (voir §16).

---

## 6. Le delta backend : mode « webhook agent »

**Découverte critique (honnêteté d'ingénierie).** Le backend actuel charge une **persona tenant** (`/api/agent/config` → instructions assemblées à partir de la config business du tenant) que le worker LiveKit exécute. Il **ne sait pas encore** appeler le **webhook externe d'un client** à chaque tour de parole. Or c'est exactement la promesse BYO-agent.

**Résolution en 2 phases — sans changer le cap, le front est écrit dès maintenant sur le contrat BYO cible :**

### Phase A — démo réelle via *demo agent* (jours)
`/connect` fait un **vrai appel** (navigateur → LiveKit → agent → voix → latence réelle → switch de langue), mais l'agent qui répond est un **demo agent Tamara existant** (ex. assistant de réservation salon, déjà en prod). Le champ webhook est **validé** (handshake POST réel, §6.1) mais ne pilote pas encore la conversation. Le wow « ça décroche vraiment, en 3 langues, sub-300ms » est **100 % réel dès la Phase A**.

### Phase B — proxy webhook BYO (l'atout d'acquisition)
Nouvelle capacité dans le **worker** (`assistAI-claude-agent`) : un **mode agent « webhook »** où, à chaque tour, le worker POSTe le tour du caller vers l'endpoint client et parle la réponse. Le front `(vox)` est déjà câblé sur ce contrat → Phase B = **« flip the switch »**, pas une réécriture.

### 6.1 Contrat webhook (source de vérité, affiché dans `/docs` et sous « View the contract »)

```
POST https://<agent-endpoint>
Headers:
  Content-Type: application/json
  X-Tamara-Signature: <HMAC-SHA256(body, tenant_secret)>   # secret montré après validation
Body:
  { "call_id": str, "turn_id": int, "language": "en|fr|he",
    "transcript": str, "history": [{ "role": "user|agent", "text": str }] }
Réponse attendue: 200  { "reply": str }   dans un budget de 2 s
```

**Deux nombres canoniques, identiques partout (pricing, FAQ, /connect, /docs) :** budget agent **`2 s`** par tour ; **p95 `< 300 ms`** round-trip côté Tamara. Ne jamais les diverger dans la copy.

### 6.2 Alignement patterns worker connus (mémoire projet)
- **Règles métier dans des tools déterministes**, pas dans le prompt (pattern établi). Le mode webhook = un « tool/route » déterministe, cohérent avec ce pattern.
- ⚠️ **Bug SDK Realtime mid-call** (le SDK drop un tool call si le LLM combine audio filler + tool) → le proxy webhook ne doit pas dépendre d'un tool-call combiné à de l'audio ; découpler l'appel réseau du flux voix.
- Latence : OpenAI Realtime **US forced**, SFU Frankfurt → le budget `2 s` webhook doit absorber le RTT ; documenter la région d'appel.

---

## 7. Design system (vox)

Nouveau brand surface **dark**, **assumé en rupture** avec la charte rose/cyan historique (mémoire `ui_brand_motion_rules` = ancienne charte, ne s'applique pas à vox). Isolé pour ne rien casser.

### 7.1 Implémentation des tokens (Tailwind v4, scopé)

Le thème global (`app/globals.css`) reste **clair** (aitamara.com). La surface vox **redéclare** les tokens sémantiques **dans un scope `.vox`** (sur le `<html>`/layout du route group). Comme `@theme inline` mappe `bg-background` → `var(--color-background)` au runtime, les utilities Tailwind existantes **rendent dark** dans le sous-arbre `.vox` sans nouvelle utility.

```css
/* ajout à globals.css — nouveaux tokens vox (génèrent bg-vox-blue, text-vox-cyan…) */
@theme inline {
  --color-vox-bg:      #05070B;
  --color-vox-surface: #0C1017;
  --color-vox-surface-2:#121826;
  --color-vox-border:  #1E2634;
  --color-vox-text:    #F2F5F9;
  --color-vox-muted:   #8B94A3;
  --color-vox-blue:    #2E6BFF;   /* actions, liens */
  --color-vox-cyan:    #22D3EE;   /* RÉSERVÉ au live : ondes, latence, signal */
  --color-vox-violet:  #7C6CFF;   /* rare : badges, fin de gradient — max 2×/écran */
}
/* scope : le sous-arbre vox remappe les sémantiques de base sur la palette dark */
.vox {
  --color-background: var(--color-vox-bg);
  --color-surface:    var(--color-vox-surface);
  --color-foreground: var(--color-vox-text);
  --color-muted-foreground: var(--color-vox-muted);
  --color-border:     var(--color-vox-border);
}
```

**Règle d'usage couleur (stricte) :** `vox-cyan` = uniquement le **live** (waveforms, latence, pulse de la Signal Line). `vox-blue` = actions/liens. `vox-violet` = 2× max par viewport. Glow cyan 12–18 % opacité, blur 40–80px, **jamais sur du texte**.

### 7.2 Typographie

| Rôle | Police | Notes |
|------|--------|-------|
| Display (titres) | **Satoshi** 500/700, tracking -2 % | via `next/font/local` (fichiers à ajouter) |
| Body / UI | **Geist** (ou Inter existant en fallback) | via `next/font` |
| Chiffres / code / latence | **Geist Mono** | *« les digits sont le décor »* — tout nombre en mono |
| **Hébreu (obligatoire)** | **Heebo** dans la stack `--font-sans` **et** `--font-mono` | ⚠️ sinon rendu Arial Hebrew (piège connu). Nécessaire pour la démo HE et tout transcript hébreu. |

Échelle : hero `clamp(3rem, 7vw, 5.5rem)` / H2 `2.5rem` / body `1.0625rem`, line-height 1.6.

### 7.3 Signature visuelle — « The Line That Answers »

Une **ligne cyan 1px** traverse le hero derrière le titre (= la ligne téléphonique). Au load : une **impulsion** entre par la gauche et la parcourt (appel entrant) → sous le titre, la ligne **explose en onde vocale** (barres verticales pilotées par l'**amplitude réelle** du greeting de l'agent de démo) → passé le titre, les pics **se détachent en ~40 particules** qui se figent en **constellation de nœuds** à droite (le réseau d'agents). Lu de gauche à droite : **appel → voix → agent**.

- Implémentation : **un seul `<canvas>`** — polyline + gradient stop voyageur + barres amplitude + système de particules easé vers des coordonnées fixes.
- `prefers-reduced-motion` : rendre une **frame statique de l'état médian** (onde figée), aucune boucle.

### 7.4 Motifs récurrents

1. **The Signal Line** — la ligne 1px sert de **séparateur de chaque section** ; quand un séparateur entre dans le viewport, **une** impulsion la traverse.
2. **The Latency Tick** — un petit chip mono `⏱ 284ms` à côté de tout élément live (widget démo, samples de code, footer) — martèle le chiffre qui vend la boîte.

### 7.5 Langage de motion

Infrastructure calme, pas une rave. Entrées : 300–400 ms, `cubic-bezier(0.16,1,0.3,1)`, rise 12px, stagger 60 ms. Nombres en **count-up** (mono). **Seule** animation *continue* autorisée = signal live (onde, latence, pulse). Hovers : 150 ms, bordure → cyan 40 %, glow 0→14 %. `useReducedMotion` : ne jamais dériver un état initial de sa valeur en SSR (piège connu → null en SSR).

### 7.6 Primitives à construire (`components/vox/`)

`VoxThemeRoot` (scope `.vox` + noise-grain) · `Button` (primary blue / secondary ghost) · `BetaBadge` · `GlowCard` · `SectionShell` (+ Signal Line divider) · `LatencyChip` · `SignalLineCanvas` (héro) · `WaveformCanvas` · `LangSwitch (EN·FR·HE)` · `CodeBlock` (mono, HE-safe) · `NumberDisplay` (mono, tap-to-copy) · `Reveal` (wrapper motion + reduced-motion).

---

## 8. Architecture de l'information & pages

| Route (host tamaravox.com) | Rôle client | Rôle acquéreur | Phase |
|---|---|---|---|
| `/` Homepage | Comprendre + envie d'essayer | Catégorie claire, positionnement défendable | 2 |
| `/connect` ⭐ | Essayer en vrai, wow | **La démo = preuve que l'infra existe** | 3 (A) / B |
| `/pricing` | Pouvoir acheter | Modèle de revenu = actif valorisable | 4 |
| `/docs` | « branché en 10 min » | API mûre, pas un prototype | 4 |
| `/login` `/signup` | Compte (auth existante) | Base users réelle | 4 |

Header global : wordmark `tamara` (crossbar = Signal Line) · nav (Product/`/connect`, Docs, Pricing) · **LangSwitch EN/FR** · CTA `Get your agent a number →`. Badge **beta** discret. Footer : liens + `Call our agent now (it picks up)` + Latency Tick live.

---

## 9. Spec — Homepage `/`

Sections dans l'ordre. Copy = **finale Fable**, à placer dans `messages/vox/{en,fr}.json`.

### 9.1 Hero
- Badge EN : `● PRIVATE BETA — provisioning numbers now` · FR : `● BÊTA PRIVÉE — numéros en cours d'attribution`
- H1 EN : **Give your AI agents a voice — and a phone number.** · FR : **Donnez une voix — et un numéro — à vos agents IA.**
- Subhead EN : *Connect the agent you already run — CFO, support, sales, internal — via one API call. Tamara answers with a natural human voice in English, French, and Hebrew. Under 300 ms. Live in minutes.* · FR : *Connectez l'agent que vous avez déjà — finance, support, ventes, interne — en un appel d'API. Tamara répond avec une voix humaine naturelle en français, anglais et hébreu. Moins de 300 ms. En ligne en quelques minutes.*
- CTA principal EN : **Get your agent a number →** · FR : **Obtenez un numéro pour votre agent →** (→ `/connect`)
- CTA secondaire EN : **Call our agent now** *(it picks up)* · FR : **Appelez notre agent** *(il décroche)* (→ widget wow #1)
- Visuel : `SignalLineCanvas` (§7.3) + carte widget « It picks up » (§14.1).

### 9.2 Problème → Solution
- H2 EN : *Your AI agents are smart. They're just not reachable.* · FR : *Vos agents IA sont intelligents. Ils sont juste injoignables.*
- Corps EN : *You've already built the hard part — agents that reason, decide, and act. But they live behind dashboards and Slack threads, while your customers, vendors, and teams still reach for the phone. Tamara is the missing layer: point us at your agent's endpoint, and it gets a number, a voice, and manners. No re-platforming. No rebuilding. Your agent stays yours — it just starts answering calls.*

### 9.3 Comment ça marche (3 étapes)
- H2 EN : *Three steps. Zero migration.* · FR : *Trois étapes. Zéro migration.*
1. **Connect your agent.** *Point Tamara at your agent's API or webhook. Whatever it speaks — REST, function calls, streaming — we translate.*
2. **Choose its voice.** *Pick a voice, a personality, and its languages. English, French, and Hebrew are native, not bolted on.*
3. **Go live on a real number.** *We provision the number, handle telephony, interruptions, and turn-taking. First call in minutes, not sprints.*

### 9.4 Cas d'usage
- H2 EN : *One layer. Every agent.* · FR : *Une seule couche. Tous vos agents.*
- **CFO / Finance** — *Your finance agent, on the record.* / *Vendors call to chase invoices and get instant, accurate answers — pulled live from the same agent that runs your books.*
- **Support** — *Answer every call. Escalate the right ones.* / *Your support agent resolves the routine 80% by phone and hands humans a transcript, not a mystery.*
- **Sales** — *Never send a lead to voicemail again.* / *Inbound calls get qualified, booked, and logged by the agent that already knows your pipeline.*
- **HR / Internal** — *Give the intranet a phone number.* / *Payroll, PTO, IT resets — employees call one line and your internal agent handles it in their language.*

### 9.5 Pourquoi Tamara (4 différenciateurs)
- H2 EN : *Built to bolt on, not lock in.* · FR : *Conçu pour se brancher, pas pour enfermer.*
1. **Bring your own agent.** *Others make you rebuild your agent on their platform. Tamara wraps the one you already trust. Your logic, your data, your models — untouched.*
2. **Natively trilingual.** *EN/FR/HE with mid-call language switching. Not translated prompts — voices that sound local in Paris, New York, and Tel Aviv.*
3. **Sub-300 ms, measured in production.** *Below the threshold where a pause reads as a machine. We publish the meter; judge it live.* (→ ancre vers Latency Wall)
4. **Minutes to first call.** *One endpoint, one config, one number. The demo on this page was wired up the same way you will be.*

### 9.6 Latency Wall (section pleine largeur — wow #2, §14.2)

### 9.7 CTA final
- EN : **Your AI agent deserves a phone number.** *It took you months to make it smart. It takes Tamara minutes to make it answer.* — Bouton **Claim your number →**
- FR : **Votre agent IA mérite un numéro de téléphone.** *Il vous a fallu des mois pour le rendre intelligent. Il faut quelques minutes à Tamara pour le faire décrocher.* — Bouton **Réservez votre numéro →**

---

## 10. Spec — `/connect` (surface héro)

Titre EN : **Put your agent on the phone.** · FR : **Mettez votre agent au téléphone.**

### 10.1 Machine à états (source de vérité UI)

État propre, pas de flags épars. Machine finie :

```
idle
  → (Validate endpoint) → validating_endpoint
      → endpoint_ok → configuring
      → endpoint_error → (Retry | demo)
  → (Use a demo agent) → configuring (mode=demo)
configuring (voice + language)
  → (Provision test number) → provisioning_number → ready
ready
  → (Call from browser) → in_call → call_ended
erreurs transverses: error | rate_limited (depuis n'importe quel état réseau)
```

Implémentation : `useReducer` (ou XState léger) typé, un seul objet `ConnectState` ; le transport temps réel (WebRTC/LiveKit via `LiveTestPanelLK`) alimente `in_call`. **Aucun WebSocket mocké** en Phase A : le fallback simulé n'existe que si l'endpoint du prospect est down. Microcopy **finale Fable** par état :

| État | Headline EN / FR | Corps (EN) | Bouton primaire EN/FR | Secondaire / hint |
|------|------------------|-----------|-----------------------|-------------------|
| **idle** | Point Tamara at your agent. / Connectez Tamara à votre agent. | Paste the webhook your agent already answers. Tamara adds the number, the voice, and the languages. Two minutes from paste to a live call. | Validate endpoint / Valider l'endpoint | *Use a demo agent instead* · hint : `HTTPS only. We send one signed test POST — nothing touches your production traffic.` |
| **validating_endpoint** | Checking your endpoint. / Vérification de l'endpoint. | Signed handshake in flight. We expect `200` with a text reply inside `2 s`. | — (progress) | *Cancel* · status `POST sent · waiting on 200 …` |
| **endpoint_ok** | Your agent answers. / Votre agent répond. | Handshake returned `200` in `{ms} ms`. Reply parsed: "{first 60 chars}…". This agent can take calls. | Choose voice + language / Choisir la voix et la langue | hint : `{ms} ms counts against your 2 s turn budget. Under 800 ms feels human.` |
| **endpoint_error** | No valid answer from that endpoint. / Aucune réponse valide de cet endpoint. | (variante d'erreur §10.4) | Retry / Réessayer | *View the contract* · *Use a demo agent instead* |
| **configuring** | Give it a voice. / Donnez-lui une voix. | Pick a voice and a primary language. Callers can switch mid-call — the voice follows, your agent gets the transcript tagged. | Provision test number / Provisionner un numéro de test | voice cards + **Preview** `3 s` ; segmented `EN · FR · HE` ; hint : `Nothing locks in.` |
| **provisioning_number** | Provisioning your number. / Provisionnement du numéro. | Reserving a live number and wiring it to your agent — SIP route, trunk, voice pipeline. Usually under `30 s`. | — | microsteps live : `Number reserved · Trunk attached · Agent linked` · *Cancel* |
| **ready** | Your agent has a phone number. / Votre agent a un numéro de téléphone. | Call it from any phone, right now. Stays live for `15 min`, up to `3` concurrent calls. | Call from browser / Appeler depuis le navigateur | `NumberDisplay` mono tap-to-copy `+972 3 555 0184` · *Copy* · *Show QR* · hint `Expires in {mm:ss}. Sign up to keep it.` |
| **in_call** | Live — your agent is on the line. / En direct — votre agent est en ligne. | HUD §10.3 | End call / Raccrocher | *Mute* |
| **call_ended** | Call complete. / Appel terminé. | That was your agent, on a real number, over a real carrier. Here is the tape. | Keep this number — start on Line / Gardez ce numéro — commencez sur Line | *Run it again* · summary card §10.5 |
| **error** | Something broke on our side. / Une erreur de notre côté. | Internal fault. Your endpoint is fine — the last handshake passed. Retry keeps your settings. | Retry session / Relancer la session | *Report it* · `Error ref {id}` |
| **rate_limited** | Beta capacity is full right now. / Capacité bêta atteinte. | Demo lines are a real telephony pool, not a queue animation — a line frees when a call ends. Est. wait `~{n} min`. | Hold my spot / Réserver ma place | *Email me when a line opens* |

### 10.2 Champ webhook
- Label EN : **Agent webhook URL** · FR : **URL du webhook de votre agent**
- Placeholder : `https://api.yourco.com/agent/reply`
- Helper : *The endpoint your agent already serves. Tamara POSTs each caller turn; your agent returns text; Tamara speaks it in `< 300 ms`.*
- Contrat (disclosure « View the contract ») : voir **§6.1** (source unique).
- CTA : **Validate endpoint / Valider l'endpoint**

### 10.3 HUD in-call
- **LatencyChip** `287 ms` label `round trip` — vert `<300`, ambre `<600`, rouge au-delà.
- **Transcript** empty state : *Transcript starts when someone speaks. Say hello.*
- **LangSwitch** `EN · switch` → cycle `EN→FR→HE`, toast : *Voice switched to FR. Your agent sees `language: "fr"` on the next turn.*
- **Mute/Unmute**, **End call**. Turn ticker discret : `turn 7 · agent replied in 412 ms`.

### 10.4 Variantes d'erreur (Fable, calmes, actionnables, sans « ! »)
- **Bad endpoint** — *That URL did not resolve to an agent. The host returned `{status}` where we expected `200` with a text reply. The contract below shows the exact POST we send, so you can curl it yourself first.*
- **Agent timeout** — *Your agent took longer than `2 s` to reply. On a phone call that is dead air, so we enforce the budget. Trim the chain, cache the cold start, or return a short ack fast — then retry.*
- **Beta capacity** — *Demo lines are at capacity. This pool is real provisioned telephony, kept small during private beta. Capacity frees as calls end — hold your spot and we email you. Your settings are saved.*

### 10.5 Demo agent fallback
*No endpoint handy? Use our demo agent — a salon booking assistant running the full stack: real number, real carrier, all `3` languages, `~280 ms` round trips. Swap in your webhook whenever it exists.* — label **Use a demo agent instead / Essayer avec un agent de démo**. **(= le chemin par défaut de la Phase A.)**

### 10.6 Post-call summary — **Call report / Rapport d'appel**
Duration `3:42` · Avg round trip `291 ms` (p95 `344 ms`) · Turns `14` · Language `FR → EN` switched at `1:58` · Transcript link (tagué par langue). Footer : *This ran on production infrastructure — the paid tiers are this exact stack with your number on it.* CTA unique : **Keep this number — start on Line / Gardez ce numéro — commencez sur Line**.

---

## 11. Spec — `/pricing`

Copy **finale Fable**. **Phase 1 = présentation-only** (le branchement Stripe/`lib/plans` est Phase B). Tous les nombres en mono ; noms de tiers **jamais traduits**.

- **Hero** EN : *Priced like infrastructure. Metered like bandwidth.* · FR : *Tarifé comme de l'infrastructure. Mesuré comme de la bande passante.* Subhead : *A platform fee for the voice layer. A per-minute rate for talk time. A flat rate per number. Every price on this page bills in production today.*
- **Modèle** : platform fee + per-minute voice + per-number telephony (un compteur, trois lignes, une facture).
- **Bandeau beta** : *Private beta. Launch rates, locked `12` months. Monthly terms, cancel anytime. Request to dial tone under `48 h`.*

| Tier | Prix | Pour | Inclus (extrait) | Upgrade |
|------|------|------|------------------|---------|
| **Line** | `$99`/mo | 1er agent au téléphone | `1` numéro (+`$5`/mo), `500` min puis `$0.12`/min, `5` appels simultanés, EN/FR/HE, p95 `<300ms`, webhook `10 req/s`, support email `24h` | `2 000` min/mo ou `>5` lignes |
| **Trunk** *(most plugged in)* | `$499`/mo | le tel = une feature | `5` numéros, `3 000` min puis `$0.10`/min, `25` simultanés, **SLA** p95 `<300ms`, `50 req/s`, **porting in**, Slack partagé | `10 000+` min/mo, region pinning |
| **Exchange** | `$1,499`/mo | volume « board deck » | `20` numéros, `12 000` min puis `$0.08`/min, `100` (burst `250`), SLA p95 `<250ms`, isolation dédiée EU/US, `200 req/s` + failover, ingénieur nommé, `99.9%` | committed-use → Carrier |
| **Carrier** | talk to us | plateformes / consolidateurs | BYO trunking ou le nôtre, per-min `<$0.08`, MSA+DPA, migration incluse | — |

- **Usage explainer** : minutes à la seconde arrondies à la seconde sup (`3:42` = `3.7` min), reset mensuel sans report, overage même facture ; numéros au prorata jour ; **language switching / transcripts / webhooks non mesurés** (« the product, not an upsell »).
- **FAQ** (5) : compat BYO / coût des langues / sens de la latence (p95 SIP edge, budget `2 s`) / provisioning & porting (`<48h` beta) / sens de « private beta » (infra prod, capacité gated, rates lockés `12` mois).
- **Ligne acquisition-grade** (§4) en bas.

---

## 12. Spec — `/docs`

Documentation minimale, **preuve de maturité API** (rôle acquéreur). Sections :
1. **Quickstart** — brancher son agent en 3 étapes (curl du handshake).
2. **Webhook contract** — §6.1 verbatim (payload, réponse, budget `2 s`).
3. **Exemples de payload** — request/response JSON, incluant un exemple `language: "he"` (RTL).
4. **Authentification** — `X-Tamara-Signature` HMAC-SHA256, où récupérer le secret (après validation dans `/connect`), vérification côté client (snippet).
5. **Langues & switch** — comportement mid-call, `language` par tour.
6. **Limites** — throughput par tier, budget `2 s`, codes d'erreur.

Rendu : `CodeBlock` mono HE-safe (Heebo dans la stack mono). Contenu statique (MDX ou données typées) — pas de CMS.

---

## 13. Spec — `/login` & `/signup`

Réutilisent **l'auth existante** (NextAuth, handlers `/api/admin/auth/*`, `/api/auth/*`), **restylés** sous le thème vox (dark). Pas de nouvelle logique auth. Signup gated par l'env existant (`SAAS_SIGNUP_ENABLED`). Après login → destination produit (dashboard existant ou `/connect` selon état onboarding). Réutiliser `IdleWatcher`. Verrou : ne pas dupliquer les pages `[locale]/login` — soit variantes stylées vox montées sous `(vox)`, soit détection host dans le composant login partagé (préférence : composant partagé + variante de thème via `.vox`).

---

## 14. Les 3 « wow moments »

### 14.1 « It picks up » — widget d'appel live (hero)
Carte hero : vrai numéro **localisé au visiteur** (FR/US/IL) + bouton **Call from browser** (WebRTC via LiveKit). Pendant l'appel : waveform live, transcript streaming, **LatencyChip par tour** (`312ms · 268ms · 291ms`), chip **switch language** (EN/FR/HE sans coupure). Réutilise `LiveTestPanelLK`. *« Nothing says buy-us like an acquirer calling the product from the landing page. »*

### 14.2 The Latency Wall (section pleine largeur)
Histogramme **live** des `1 000` derniers round-trips de prod, **p50/p95** en chiffres mono géants, règle cyan à `300 ms`, barres qui streament via **SSE**. Caption : *Measured on real calls, not a benchmark. Refreshes as you watch.* Source : endpoint télémétrie (nouveau, léger, lecture des `calls.durationSeconds`/latence — à exposer côté API ; si latence par tour non stockée aujourd'hui, Phase A affiche p50/p95 agrégés réels sur données disponibles, jamais fabriqués).
> ⚠️ **Honnêteté data** : n'afficher que des chiffres réels. Si la granularité « round-trip par tour » n'existe pas encore en base, la Latency Wall démarre sur la métrique réelle disponible (durée/agrégats) et gagne en résolution quand le worker émet la latence par tour. **Aucune donnée inventée** (règle absolue : un acquéreur audite).

### 14.3 The Wire — playground webhook→voix
Split : à gauche un JSON de réponse d'agent éditable (ou « paste your endpoint ») ; à droite un cadre téléphone. **Speak** fait voyager le payload sur la Signal Line (`webhook → tamara → PSTN`) et sortir la **voix** dans la langue choisie, LatencyChip attaché. Démontre physiquement le wedge **BYO-agent**.

---

## 15. Non-fonctionnel (perf, a11y, RTL, SEO)

- **Perf** : LCP < 2.5s ; le `SignalLineCanvas` ne bloque pas le LCP (titre en HTML, canvas en couche derrière) ; canvas throttlé, `requestAnimationFrame` pausé hors-viewport ; fonts `display: swap`.
- **Reduced motion** : `prefers-reduced-motion` → frames statiques (canvas médian, pas de count-up, pas de pulses). Ne pas dériver l'état initial de `useReducedMotion` en SSR.
- **A11y** : contrastes AA sur fond `#05070B` (texte `#F2F5F9` OK ; `--vox-muted` à vérifier ≥ 4.5:1 sur surfaces) ; focus-visible (ring existant) ; le widget d'appel utilisable clavier ; live regions ARIA pour transcript/latence ; canvas décoratifs `aria-hidden`, alternative texte pour l'info portée.
- **RTL / hébreu** : tout affichage HE (transcript, démo) en `dir="rtl"` + Heebo ; réutiliser les gotchas connus (`.he-text`, bumps de taille). Le marketing reste LTR (EN/FR).
- **SEO / OG (rôle acquéreur)** : métadonnées propres EN+FR (`hreflang`), OG image « The Line That Answers », titres = catégorie. Sitemap. Objectif : un acquéreur qui google « voice layer for AI agents » tombe dessus.
- **Analytics** : events clés (call started/ended, endpoint validated, tier CTA) — réutiliser l'analytics existant si présent, sinon léger et first-party.

---

## 16. Plan d'exécution

Validation founder **à la fin de chaque étape** (exigence explicite). Chaque étape = spec → plan (`writing-plans`) → implémentation.

- **Étape 0 — Cahier des charges** *(ce doc)*. → relecture founder.
- **Étape 1 — Setup & Design System.** Route group `(vox)` + host routing middleware ; tokens dark scopés (§7.1) ; fonts (Satoshi/Geist/Geist Mono + Heebo) ; primitives `components/vox/` ; namespace i18n `messages/vox` ; un écran statique de contrôle. **→ validation.**
- **Étape 2 — Homepage.** Sections §9 avec motion ; `SignalLineCanvas` ; widget wow #1 (peut démarrer en démo agent Phase A) ; Latency Wall (données réelles disponibles). **→ validation.**
- **Étape 3 — `/connect` (Phase A, réelle).** Machine à états §10 ; validation endpoint (handshake réel §6.1) ; provisioning numéro de test + appel navigateur via stack existante ; HUD + summary. Agent répondant = **demo agent**. **→ validation.**
- **Étape 4 — Pages annexes.** `/pricing` (présentation), `/docs` (contrat §6.1), `/login`+`/signup` restylés. **→ validation.**
- **Étape 5 — Acquisition polish.** OG/SEO, Latency Wall haute résolution, cohérence des `2 s` / `<300 ms` partout, QA mobile, mode « prospect-ready ». **→ validation.**
- **Phase B (worker) — vrai BYO.** Mode « webhook agent » dans `assistAI-claude-agent` (§6) → `/connect` proxifie réellement l'endpoint collé ; mapping pricing → `lib/plans`/Stripe. *L'atout d'acquisition ; le front est déjà câblé.*

---

## 17. Definition of Done & critères d'acceptation

**Global**
- [ ] `tamaravox.com` sert la surface `(vox)` (dark), `aitamara.com` **inchangé** (zéro régression visuelle/fonctionnelle).
- [ ] Les nombres `2 s` (budget webhook) et `< 300 ms` (p95) sont **identiques** partout (pricing, FAQ, /connect, /docs).
- [ ] Aucune donnée fabriquée affichée (latence, télémétrie = réel ou absent).
- [ ] EN par défaut, FR complet sur Home/Connect/Pricing (headlines+CTA+labels), `hreflang` OK.
- [ ] `prefers-reduced-motion` respecté sur tous les canvases/animations.

**Homepage** — 6 sections rendues, copy Fable exacte, Signal Line + widget hero fonctionnels, Latency Wall live.
**/connect (A)** — machine à états complète, handshake webhook réel (200 + reply parsé + `{ms}`), provisioning + **appel navigateur réel** vers demo agent, HUD (latence/transcript/switch), summary card, 3 erreurs gérées, rate_limited honnête.
**/pricing** — 4 tiers, usage explainer, FAQ, ligne acquisition, tout en mono, tiers non traduits.
**/docs** — contrat §6.1, exemples (dont HE/RTL), auth HMAC.
**Auth** — login/signup vox réutilisent NextAuth existant, signup gated, redirection correcte.

---

## 18. Risques & points ouverts

| # | Risque / question | Impact | Mitigation / décision |
|---|-------------------|--------|-----------------------|
| R1 | **BYO webhook = capacité worker inexistante** | Le cœur de la promesse | Phasage A/B (§6) ; front câblé sur le contrat cible dès maintenant. |
| R2 | **Latence par tour peut-être non stockée** | Latency Wall | Démarrer sur métrique réelle disponible ; jamais inventer ; worker émet la latence en Phase B. |
| R3 | Thème dark scopé sous Tailwind v4 | Régression possible sur site clair | Scope `.vox` strict + QA visuelle aitamara.com ; pas de modif des tokens globaux. |
| R4 | Pricing vs `lib/plans` (clinique) | Cohérence billing | Pricing présentation-only Phase 1 ; mapping Stripe Phase B. |
| R5 | Fonts Satoshi (licence/fichiers) | Build Étape 1 | Fournir les fichiers `.woff2` ; fallback Geist/Inter si indispo. **→ à confirmer founder.** |
| R6 | Numéros de démo = pool téléphonie réel (coût/capacité) | `/connect` en prod | Pool limité + `rate_limited` honnête + expiration `15 min` ; surveiller coût Twilio. |
| R7 | OpenAI Realtime US forced + SFU Frankfurt | Budget latence | Documenter région ; le `2 s` webhook absorbe le RTT. |
| Q1 | **Satoshi dispo ?** sinon Geist display seul | Direction typo | À trancher Étape 1. |
| Q2 | HE en UI marketing plus tard ? | Scope i18n | Non pour l'instant (capacité produit only). |

---

## 19. Hors périmètre (YAGNI)

- Pas de refonte du dashboard/admin existant (réutilisés tels quels).
- Pas de billing/Stripe nouveau en Phase 1 (pricing = présentation).
- Pas de CMS pour `/docs` (statique).
- Pas de HE comme locale d'UI marketing.
- Pas de multi-tenant self-serve onboarding nouveau (l'existant suffit).
- Pas de refonte du worker hors mode « webhook agent » (Phase B ciblée).

---

*Fin du cahier des charges v1.0. Prochaine étape après validation founder : `writing-plans` sur l'Étape 1 (Setup & Design System).*
