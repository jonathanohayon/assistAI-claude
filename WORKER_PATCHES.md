# Patches appliqués au worker LiveKit (`assistAI-claude-agent/`)

Le worker se trouve dans `~/Desktop/assistAI-claude-agent/` et a été patché en
même temps que ce repo Next.js. Les changements ci-dessous résolvent
**Bug #1 (endCall ne raccroche pas Twilio)** et **Bug #4 (bruit de fond)**.

À redéployer sur Railway après ces changements (le worker tourne en service
séparé).

## ✅ Bug #4 — Suppression du bruit (ai-coustics)

Plugin LiveKit officiel. Branché sur les frames audio entrants avant qu'ils
n'atteignent le LLM. Modèle par défaut `rookS` (optimisé latence téléphonique).

```ts
// agent.ts (top)
import * as aic from '@livekit/plugins-ai-coustics';

// dans entry(), au moment de session.start :
await session.start({
  agent,
  room: ctx.room,
  inputOptions: {
    noiseCancellation: aic.audioEnhancement(),
  },
});
```

Installé via :

```bash
npm install @livekit/plugins-ai-coustics
```

> **Note licence** : ai-coustics nécessite une licence/credentials côté
> serveur LiveKit Cloud. Si LiveKit Cloud n'a pas la licence configurée, le
> plugin renvoie le frame inchangé (pas de crash). Vérifier dans la console
> LiveKit Cloud → Project Settings → Plugins. Sinon, fallback : utiliser
> `@livekit/plugins-krisp` ou la suppression de bruit native LiveKit.

## ✅ Bug #1 — endCall raccroche maintenant pour de vrai

Le tool `end_call` existait déjà mais n'appelait que `session.close()`, qui
**ne déconnecte pas** le participant SIP. Résultat : Twilio gardait la ligne
ouverte (et continuait à facturer).

Fix : après `session.close()`, on supprime la room LiveKit via
`RoomServiceClient.deleteRoom()`. Cela force la déconnexion de tous les
participants, y compris le SIP — Twilio reçoit le BYE et raccroche.

```ts
import { RoomServiceClient } from 'livekit-server-sdk';

// dans closeSession(reason) :
await session.close();

const httpUrl = process.env['LIVEKIT_URL']!.replace(/^wss?:\/\//, (m) =>
  m === 'wss://' ? 'https://' : 'http://',
);
const svc = new RoomServiceClient(
  httpUrl,
  process.env['LIVEKIT_API_KEY']!,
  process.env['LIVEKIT_API_SECRET']!,
);
await svc.deleteRoom(ctx.room.name ?? '');
```

## Vérification

Après redéploiement Railway du worker :

1. **Bruit** : appelle depuis un endroit bruyant (rue, café). La voix doit
   passer nettement plus claire au LLM. Surveille les transcriptions dans
   `/dashboard/logs` — les hallucinations dues au bruit doivent disparaître.
2. **Hangup** : dis "merci, au revoir, à bientôt". L'agent répond, puis la
   ligne raccroche **dans la seconde** (avant : silence interminable).
3. **Sécurité (silence watchdog)** : si quelqu'un oublie de raccrocher,
   `SILENCE_HANGUP_MS` (30s par défaut) raccroche aussi via le même chemin.

## Fichier patché

Tout est dans **`~/Desktop/assistAI-claude-agent/agent.ts`** :
- Imports : `aic` + `RoomServiceClient`
- `closeSession()` : ajout de `deleteRoom`
- `session.start()` : ajout de `inputOptions.noiseCancellation`

`npm run typecheck` ✅ passe.
