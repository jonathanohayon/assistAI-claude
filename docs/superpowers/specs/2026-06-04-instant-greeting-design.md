# Accueil instantané pré-généré — design

Date : 2026-06-04 · Cross-repo (web `assist-ai` + worker `assistAI-claude-agent`)

## Problème

Le 1er mot de l'agent (« greeting ») arrive après **~2,1–2,3 s** de silence. Mesuré
(`greetingMs` dans les logs worker) : c'est la **1ère réponse Realtime**, donc prompt
froid (~1800 tokens), prefill + time-to-first-audio. Décomposition d'un appel réel :
`greetingMs 2124ms = FirstAudio ~1019–1268ms (modèle) + ~850–1100ms prefill`. Le cache
de prompt n'aide quasi pas l'accueil (il se construit *pendant* l'appel). Aucune
micro-optim ne descend ça → il faut **découpler l'accueil du modèle**.

## Objectif

Jouer un **opener audio pré-généré** dès que la room LiveKit est connectée (avant le
`session.start()` lent), pour un accueil perçu en **~300 ms**. Le modèle Realtime se
monte en parallèle et prend la main au 1er tour client. **Qualité = priorité n°1** :
l'amorce doit sonner **exactement** comme l'agent (même voix).

Validé par revue council (gpt-5.2, 2026-06-04) — ce design intègre ses affinements.

## Principe (Option 1 retenue)

Opener **complet** pré-généré (accueil + question d'ouverture), joué instantanément.
Le modèle reste **silencieux jusqu'au 1er mot du client**, puis prend la main — il n'a
jamais à prononcer l'accueil. **Zéro couture** (une seule source pour l'accueil).

## Architecture

### 1. Voix exacte (le point qualité)
- Pré-render avec le **même modèle Realtime + voix + mêmes `instructions`** que le live
  (voix par défaut `marin`/`cedar` = voix gpt-realtime, **absentes du TTS standalone** →
  un TTS tiers sonnerait différent). Génération offline via l'API Realtime OpenAI
  (ouvrir une session, `response.create` avec le texte, capturer `response.audio.delta`).
- Stockage **PCM16 24 kHz mono lossless** (pas de MP3/Opus → artefacts/niveau).
- **`renderVersion`** dans la clé de cache → re-render si OpenAI fait évoluer la voix.
- **Normalisation du loudness** (cible RMS/LUFS cohérente avec l'audio modèle) pour
  éviter un saut de volume amorce↔live.
- Si la voix du tenant n'est pas synthétisable exactement → **pas de pré-render**
  (fallback modèle), jamais de voix « presque pareille ».

### 2. Texte de l'opener
- Base = `agent_configs.greeting_instructions` du tenant (verbatim), sinon
  `greeting_fallback` admin per-plan, sinon **pas de pré-render**.
- **Complétion auto** : si le texte ne finit pas par `?` (pas d'invitation à parler),
  on **append une question d'ouverture localisée par défaut** avant synthèse :
  FR « Comment puis-je vous aider ? » · HE « ?איך אפשר לעזור » · EN « How can I help you? ».
  → opener toujours complet. C'est **exactement ce que le modèle fait déjà** aujourd'hui
  (greeting verbatim *puis* question d'ouverture) → **zéro régression**, zéro nouvelle
  config tenant. (La question par défaut = constante localisée ; éditable /admin plus tard.)

### 3. Génération + cache (web `assist-ai`)
- **Proactif** : à la sauvegarde du greeting/voix/langue dans le dashboard → enqueue un
  render job (le 1er appel après édition est déjà instantané — surtout quand le tenant teste).
- **Lazy (filet)** : si cache miss au moment de l'appel → fallback modèle pour CET appel
  + génération en arrière-plan (le prochain appel est instantané).
- **Stockage Postgres** : nouvelle table `greeting_audio`
  `{ id, user_id FK, text_hash, voice, language, render_version, audio_pcm bytea,
     sample_rate int, created_at }`, unique sur
  `(user_id, text_hash, voice, language, render_version)`.
- Module `lib/greeting-render.ts` : ouvre la WS Realtime OpenAI, synthétise, normalise,
  écrit la ligne. Idempotent (skip si déjà présent).

### 4. Endpoint web
`GET /api/agent/greeting-audio?phone=<dialed>` (gated `x-internal-secret`, comme
`/api/agent/config`) :
- résout le tenant depuis le numéro, calcule l'opener + `text_hash`,
- **hit** → renvoie le PCM (binaire) + headers `voice`/`sampleRate`,
- **miss** → `204 No Content` + **enqueue génération background** (jamais bloquant).

### 5. Worker — lecture instantanée (`assistAI-claude-agent`)
Entre `ctx.connect()` (room dispo) et `session.start()` :
- fetch `/api/agent/greeting-audio` avec **timeout court (~500 ms)**.
- **Audio dispo** :
  - **Piste audio unique** : on injecte les frames de l'opener dans la **MÊME sortie
    audio que l'agent** (file de lecture sur la track « voix agent »), **pas une 2ᵉ piste**
    (sinon 2 voix / gain / souci bridge SIP).
  - **Gating VAD/STT** : pendant la durée de l'amorce (+ jitter ~600–1200 ms), on **gèle
    l'entrée** pour que l'audio joué ne soit pas capté comme « parole client » (echo →
    faux turn-detect). La VAD ne lit **que la piste SIP entrante**.
  - **Handoff anti double-accueil** : `onEnter` ne fait **plus** `generateReply` ;
    l'opener est injecté comme **message `assistant`** dans le chatCtx **+** règle système
    « tu as déjà accueilli, ne resalue pas, réponds à la prochaine intervention ». Réponse
    modèle uniquement au **1er tour client committé**.
- **Absent/timeout** → fallback comportement actuel (le modèle dit l'accueil). **Zéro régression.**
- **Warming parallèle** : pendant que l'amorce joue, ouvrir la session Realtime +
  envoyer le prompt en parallèle → modèle déjà « chaud » quand le client finit de parler.

### 6. Plomberie audio
- Tout en interne **24 kHz PCM16 mono** ; resampling 24 k→8/16 k **seulement à l'egress
  SIP**, via le **même resampler/limiter** que l'audio live (c'est ça qui les rend
  identiques à l'oreille).

### 7. Mesure
- `greetingMs` existant mesure le gain.
- Nouveau flag loggé `greeting_source: prerendered | model` dans `call_metrics`.

## Découpage (unités)

| Unité | Repo | Responsabilité |
|---|---|---|
| `lib/greeting-render.ts` | web | synthèse Realtime offline → PCM normalisé |
| table `greeting_audio` + migration | web | cache persistant |
| `GET /api/agent/greeting-audio` | web | hit/miss + enqueue lazy |
| hook proactif (dashboard save greeting/voix) | web | enqueue render à l'édition |
| opener builder (texte + question localisée) | web (partagé) | `buildOpenerText(cfg)` |
| worker greeting-player | worker | fetch + publish frames + VAD gating + fallback |
| worker handoff | worker | onEnter sans generateReply + injection assistant msg + warming |

## Gestion d'erreur / fallback
- Toute défaillance (miss, timeout, voix non supportée, render échoué, audio corrompu) →
  **fallback silencieux au greeting modèle actuel**. Le pré-render est un *enhancement*,
  jamais un point de défaillance bloquant.

## Hors scope (YAGNI v1)
- Question d'ouverture éditable depuis /admin (constante localisée pour v1).
- Variantes d'opener (heures ouvrées / fermées).
- Pré-cache de la 1ère réponse conversationnelle.

## Risques / à valider en impl
- **Génération Realtime WS server-side** depuis Next.js/Railway (lib `ws`) — capter
  l'audio proprement (fin de réponse, concat). Le morceau le plus lourd.
- **Format de frame LiveKit** attendu par `ParticipantAudioOutput.captureFrame` / l'API
  d'injection dans la sortie agent (à confirmer dans `@livekit/agents` 1.4).
- **Gating VAD** : trouver le bon hook (source = piste SIP only) pour ignorer l'entrée
  pendant l'amorce sans casser le barge-in après.
- Test : impossible de mesurer la latence sans **vrais appels** → vérif sur appel test
  (greetingMs + écoute qualité voix/couture).
