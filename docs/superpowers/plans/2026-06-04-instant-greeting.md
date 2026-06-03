# Accueil instantané pré-généré — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jouer un opener audio pré-généré (voix Realtime exacte) dès la connexion de la room LiveKit, pour ramener la latence d'accueil de ~2,3 s à ~300 ms, sans régression.

**Architecture :** Le web (`assist-ai`) synthétise l'opener offline via l'API Realtime OpenAI (même voix que le live), le cache en Postgres, et l'expose sur un endpoint interne. Le worker (`assistAI-claude-agent`) le fetch tôt dans l'appel, joue les frames sur la sortie audio de l'agent (piste unique), gèle la VAD pendant la lecture, et laisse le modèle silencieux jusqu'au 1er tour client (handoff). Fallback intégral au greeting modèle si quoi que ce soit manque.

**Tech Stack :** Next.js 16 + Drizzle/Postgres (web), `ws` pour la WS Realtime OpenAI, `@livekit/agents` 1.4 + `@livekit/rtc-node` (worker), tsx + node:assert pour les tests.

**Spec :** `docs/superpowers/specs/2026-06-04-instant-greeting-design.md`

---

## File Structure

**Web (`~/Desktop/assist-ai`) :**
- Create `lib/opener.ts` — pur : construit le texte d'opener (greeting + question localisée si absente) + hash. **Testable unitairement.**
- Create `lib/greeting-render.ts` — server-only : WS Realtime OpenAI → PCM24k normalisé. (API-dependent.)
- Modify `lib/db/schema.ts` — table `greeting_audio` + migration.
- Create `lib/greeting-audio-storage.ts` — get/put cache (Drizzle).
- Create `app/api/agent/greeting-audio/route.ts` — endpoint interne hit/miss + enqueue lazy.
- Modify config save path (dashboard greeting) — enqueue proactif (à localiser : route qui écrit `greeting_instructions`).
- Create `scripts/tests/opener.test.ts` — tests purs.

**Worker (`~/Desktop/assistAI-claude-agent`) :**
- Create `src/greeting-player.ts` — fetch audio + injecte frames dans la sortie agent + gating VAD. (API-dependent.)
- Modify `agent.ts` — câblage : fetch tôt, handoff (onEnter sans generateReply + message assistant + warming), flag `greeting_source`.

---

## PHASE 1 — Web : opener builder (pur, full TDD)

### Task 1 : `buildOpenerText` + `openerHash`

**Files:**
- Create: `~/Desktop/assist-ai/lib/opener.ts`
- Test: `~/Desktop/assist-ai/scripts/tests/opener.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

```ts
// scripts/tests/opener.test.ts
import assert from "node:assert/strict";
import { buildOpenerText, openerHash, DEFAULT_OPENING_QUESTION } from "../../lib/opener";

let passed = 0; const failures: string[] = [];
const group = (label: string, fn: () => void) => { try { fn(); passed++; } catch (e) { failures.push(`[${label}] ${e instanceof Error ? e.message : e}`); } };

// 1. greeting finissant par "?" → verbatim, pas d'append
group("ends with ? → verbatim", () => {
  assert.strictEqual(
    buildOpenerText("Bonjour, c'est Johana, comment puis-je vous aider ?", "fr"),
    "Bonjour, c'est Johana, comment puis-je vous aider ?",
  );
});
// 2. greeting sans question → append localisé FR
group("no question fr → append", () => {
  assert.strictEqual(
    buildOpenerText("Bonjour, c'est Johana.", "fr"),
    "Bonjour, c'est Johana. " + DEFAULT_OPENING_QUESTION.fr,
  );
});
// 3. HE + EN
group("he/en append", () => {
  assert.ok(buildOpenerText("שלום, כאן יוהנה.", "he").endsWith(DEFAULT_OPENING_QUESTION.he));
  assert.ok(buildOpenerText("Hello, this is Johana.", "en").endsWith(DEFAULT_OPENING_QUESTION.en));
});
// 4. locale inconnue → fallback fr
group("unknown locale → fr", () => {
  assert.ok(buildOpenerText("Hola.", "de").endsWith(DEFAULT_OPENING_QUESTION.fr));
});
// 5. trailing guillemets/espaces ignorés pour la détection du "?"
group("trailing quote tolerated", () => {
  assert.strictEqual(buildOpenerText('Bonjour ? "', "fr"), 'Bonjour ? "');
});
// 6. hash stable + sensible au texte
group("hash", () => {
  assert.strictEqual(openerHash("a"), openerHash("a"));
  assert.notStrictEqual(openerHash("a"), openerHash("b"));
  assert.match(openerHash("a"), /^[a-f0-9]{16,64}$/);
});
// 7. vide → vide (pas d'opener à pré-render)
group("empty stays empty", () => {
  assert.strictEqual(buildOpenerText("   ", "fr"), "");
});

if (failures.length) { console.error(`${failures.length} FAILED:`); failures.forEach(f => console.error("  ✗ " + f)); process.exit(1); }
console.log(`ALL ${passed} TESTS PASSED`);
```

- [ ] **Step 2 : Lancer → échoue**

Run: `cd ~/Desktop/assist-ai && npx tsx scripts/tests/opener.test.ts`
Expected: FAIL (`Cannot find module '../../lib/opener'`).

- [ ] **Step 3 : Implémenter**

```ts
// lib/opener.ts
import { createHash } from "node:crypto";

export const DEFAULT_OPENING_QUESTION: Record<"fr" | "he" | "en", string> = {
  fr: "Comment puis-je vous aider ?",
  he: "איך אפשר לעזור?",
  en: "How can I help you?",
};

function localeKey(locale: string): "fr" | "he" | "en" {
  return locale === "he" ? "he" : locale === "en" ? "en" : "fr";
}

/**
 * Texte de l'opener prononcé à l'accueil. Si le greeting n'invite pas à parler
 * (ne finit pas par "?"), on append une question d'ouverture localisée — c'est
 * ce que le modèle faisait déjà après le greeting verbatim. Vide → "" (pas de
 * pré-render, fallback modèle).
 */
export function buildOpenerText(greeting: string, locale: string): string {
  const g = (greeting ?? "").trim();
  if (!g) return "";
  // Détection "invite à parler" : dernier caractère significatif = "?"
  const stripped = g.replace(/["'»)\s]+$/u, "");
  if (stripped.endsWith("?")) return g;
  return `${g} ${DEFAULT_OPENING_QUESTION[localeKey(locale)]}`;
}

/** Hash stable du texte d'opener — clé de cache. */
export function openerHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}
```

- [ ] **Step 4 : Lancer → passe**

Run: `cd ~/Desktop/assist-ai && npx tsx scripts/tests/opener.test.ts`
Expected: `ALL 7 TESTS PASSED`.

- [ ] **Step 5 : Commit**

```bash
cd ~/Desktop/assist-ai
git add lib/opener.ts scripts/tests/opener.test.ts
git commit -m "feat(greeting): opener text builder + hash (pur, testé)"
```

---

## PHASE 2 — Web : table de cache `greeting_audio`

### Task 2 : schéma + migration

**Files:**
- Modify: `~/Desktop/assist-ai/lib/db/schema.ts`
- Create (généré) : `~/Desktop/assist-ai/drizzle/00XX_*.sql`

- [ ] **Step 1 : Ajouter la table** (après `paymentOrders`, mirror du style existant)

```ts
// lib/db/schema.ts — ajouter
import { customType } from "drizzle-orm/pg-core";
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() { return "bytea"; },
});

// Cache de l'audio d'accueil pré-généré (PCM16 24kHz mono). Une ligne par
// (tenant, texte d'opener, voix, langue, version de rendu). Régénéré quand le
// texte/voix change (text_hash/voice change) ou render_version bump.
export const greetingAudio = pgTable("greeting_audio", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  textHash: text("text_hash").notNull(),
  voice: text("voice").notNull(),
  language: text("language").notNull(),
  renderVersion: integer("render_version").notNull().default(1),
  audioPcm: bytea("audio_pcm").notNull(),
  sampleRate: integer("sample_rate").notNull().default(24000),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
}, (t) => ({
  uniq: unique("greeting_audio_key").on(t.userId, t.textHash, t.voice, t.language, t.renderVersion),
}));
```
(Ajouter `integer`, `unique`, `customType` aux imports drizzle si absents.)

- [ ] **Step 2 : Générer la migration**

Run: `cd ~/Desktop/assist-ai && npx drizzle-kit generate`
Expected: nouveau fichier `drizzle/00XX_*.sql` créé.

- [ ] **Step 3 : Rendre la migration idempotente** (cohérent avec le repo)

Éditer le `.sql` généré : `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`, et envelopper l'`ADD CONSTRAINT`/FK dans un `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object/duplicate_table THEN null; END $$;` (cf. `drizzle/0018_bright_monster_badoon.sql`).

- [ ] **Step 4 : Typecheck**

Run: `cd ~/Desktop/assist-ai && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5 : Commit**

```bash
cd ~/Desktop/assist-ai
git add lib/db/schema.ts drizzle/
git commit -m "feat(greeting): table greeting_audio (cache PCM) + migration"
```

### Task 3 : storage get/put

**Files:**
- Create: `~/Desktop/assist-ai/lib/greeting-audio-storage.ts`

- [ ] **Step 1 : Implémenter** (pas de test unitaire DB ici — couvert par l'endpoint en intégration)

```ts
// lib/greeting-audio-storage.ts (server-only)
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { greetingAudio } from "@/lib/db/schema";

export const GREETING_RENDER_VERSION = 1;

export type GreetingKey = {
  userId: string; textHash: string; voice: string; language: string;
};

export async function getGreetingAudio(k: GreetingKey) {
  const [row] = await db.select()
    .from(greetingAudio)
    .where(and(
      eq(greetingAudio.userId, k.userId),
      eq(greetingAudio.textHash, k.textHash),
      eq(greetingAudio.voice, k.voice),
      eq(greetingAudio.language, k.language),
      eq(greetingAudio.renderVersion, GREETING_RENDER_VERSION),
    )).limit(1);
  return row ?? null;
}

export async function putGreetingAudio(k: GreetingKey, audioPcm: Buffer, sampleRate: number) {
  await db.insert(greetingAudio).values({
    ...k, renderVersion: GREETING_RENDER_VERSION, audioPcm, sampleRate,
  }).onConflictDoNothing();
}
```

- [ ] **Step 2 : Typecheck + commit**

```bash
cd ~/Desktop/assist-ai && npx tsc --noEmit && \
git add lib/greeting-audio-storage.ts && \
git commit -m "feat(greeting): storage get/put cache audio"
```

---

## PHASE 3 — Web : rendu Realtime (API-dependent — VÉRIFIER avant de coder)

### Task 4 : `renderOpenerAudio` via WS Realtime OpenAI

**Files:**
- Create: `~/Desktop/assist-ai/lib/greeting-render.ts`

> ⚠️ **Cette tâche dépend du protocole Realtime OpenAI. NE PAS deviner — vérifier d'abord.**

- [ ] **Step 1 : Vérifier le protocole** (lecture, pas de code deviné)

Lire la doc/protocole Realtime pour la génération text→audio offline :
- Endpoint WS : `wss://api.openai.com/v1/realtime?model=<cfg.model>`, header `Authorization: Bearer $OPENAI_API_KEY` + `OpenAI-Beta: realtime=v1`.
- Séquence : à l'ouverture envoyer `session.update` `{ session: { type:"realtime", voice, output_audio_format:"pcm16", modalities:["audio","text"], instructions:"" } }`, puis `conversation.item.create` (role `user` ou `system`) avec le texte « Dis exactement : <opener> », puis `response.create` `{ response: { modalities:["audio"], instructions:"Prononce TEXTUELLEMENT le message, sans rien ajouter." } }`.
- Capter les events `response.audio.delta` (base64 PCM16 24kHz) → concat ; fin sur `response.done`.
- Confirmer le format exact (sample rate 24000, mono, PCM16 little-endian).

Noter dans un commentaire en tête du fichier la séquence d'events réellement observée.

- [ ] **Step 2 : Implémenter** (squelette — adapter selon Step 1)

```ts
// lib/greeting-render.ts (server-only)
import WebSocket from "ws";

const OPENAI_WS = "wss://api.openai.com/v1/realtime";

/**
 * Synthétise l'opener en PCM16 24kHz mono via l'API Realtime (MÊME voix que le
 * live → match exact). Renvoie un Buffer PCM. Throw si échec (l'appelant gère
 * le fallback). Normalisation loudness appliquée (RMS cible).
 */
export async function renderOpenerAudio(opts: {
  text: string; voice: string; model: string; instructions?: string;
}): Promise<{ pcm: Buffer; sampleRate: number }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY manquant");
  const url = `${OPENAI_WS}?model=${encodeURIComponent(opts.model)}`;
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${key}`, "OpenAI-Beta": "realtime=v1" },
  });
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    const fail = (e: unknown) => { try { ws.close(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    const timer = setTimeout(() => fail(new Error("render timeout")), 15000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session.update", session: {
        type: "realtime", voice: opts.voice, output_audio_format: "pcm16",
        modalities: ["audio", "text"], instructions: opts.instructions ?? "",
      }}));
      ws.send(JSON.stringify({ type: "conversation.item.create", item: {
        type: "message", role: "user",
        content: [{ type: "input_text", text: `Dis EXACTEMENT, mot pour mot, sans rien ajouter : """${opts.text}"""` }],
      }}));
      ws.send(JSON.stringify({ type: "response.create", response: {
        modalities: ["audio"],
        instructions: "Prononce textuellement le message demandé. N'ajoute rien.",
      }}));
    });
    ws.on("message", (raw) => {
      let ev: { type?: string; delta?: string };
      try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.type === "response.audio.delta" && ev.delta) chunks.push(Buffer.from(ev.delta, "base64"));
      else if (ev.type === "response.done") {
        clearTimeout(timer); try { ws.close(); } catch {}
        if (!chunks.length) return reject(new Error("no audio"));
        resolve({ pcm: normalizeLoudness(Buffer.concat(chunks)), sampleRate: 24000 });
      } else if (ev.type === "error") fail(new Error("realtime error: " + raw.toString().slice(0, 200)));
    });
    ws.on("error", fail);
  });
}

/** Normalise le RMS du PCM16 vers une cible (évite saut de volume amorce↔live). */
function normalizeLoudness(pcm: Buffer, targetRms = 3000): Buffer {
  const n = Math.floor(pcm.length / 2);
  let sum = 0;
  for (let i = 0; i < n; i++) { const s = pcm.readInt16LE(i * 2); sum += s * s; }
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms < 1) return pcm;
  const gain = Math.min(8, targetRms / rms);
  if (Math.abs(gain - 1) < 0.05) return pcm;
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i * 2) * gain)));
    out.writeInt16LE(v, i * 2);
  }
  return out;
}
```
(Vérifier que `ws` est dans les deps web : `grep '"ws"' package.json`, sinon `npm i ws @types/ws`.)

- [ ] **Step 3 : Smoke-test réel** (génération + écoute)

```bash
cd ~/Desktop/assist-ai && npx tsx -e '
import { renderOpenerAudio } from "./lib/greeting-render";
const r = await renderOpenerAudio({ text: "Bonjour, c'est Johana. Comment puis-je vous aider ?", voice: "marin", model: "gpt-realtime-2" });
const fs = await import("node:fs");
// wrap PCM24k mono en WAV pour écoute
const hdr = Buffer.alloc(44); const d = r.pcm; const sr = r.sampleRate;
hdr.write("RIFF",0); hdr.writeUInt32LE(36+d.length,4); hdr.write("WAVE",8); hdr.write("fmt ",12);
hdr.writeUInt32LE(16,16); hdr.writeUInt16LE(1,20); hdr.writeUInt16LE(1,22); hdr.writeUInt32LE(sr,24);
hdr.writeUInt32LE(sr*2,28); hdr.writeUInt16LE(2,32); hdr.writeUInt16LE(16,34); hdr.write("data",36); hdr.writeUInt32LE(d.length,40);
fs.writeFileSync("/tmp/opener.wav", Buffer.concat([hdr,d]));
console.log("wrote /tmp/opener.wav", d.length, "bytes @", sr);
' && open /tmp/opener.wav
```
Expected : un WAV se génère, et à l'écoute la **voix correspond à `marin`** et dit l'opener. Si la voix/format ne colle pas → retourner au Step 1 (protocole).

- [ ] **Step 4 : Commit**

```bash
cd ~/Desktop/assist-ai
git add lib/greeting-render.ts package.json package-lock.json
git commit -m "feat(greeting): renderOpenerAudio via WS Realtime (voix exacte) + normalize"
```

---

## PHASE 4 — Web : endpoint interne

### Task 5 : `GET /api/agent/greeting-audio`

**Files:**
- Create: `~/Desktop/assist-ai/app/api/agent/greeting-audio/route.ts`

> Lire d'abord `app/api/agent/config/route.ts` pour copier : auth `x-internal-secret`, résolution tenant depuis `?phone=`, et la lecture de `greeting_instructions` + `voice` + `primaryLanguage` du tenant.

- [ ] **Step 1 : Implémenter**

```ts
// app/api/agent/greeting-audio/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildOpenerText, openerHash } from "@/lib/opener";
import { getGreetingAudio, putGreetingAudio } from "@/lib/greeting-audio-storage";
import { renderOpenerAudio } from "@/lib/greeting-render";
// + helpers de résolution tenant copiés depuis api/agent/config

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-internal-secret") !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const phone = new URL(req.url).searchParams.get("phone");
  if (!phone) return NextResponse.json({ error: "phone requis" }, { status: 400 });

  // 1. Résoudre tenant + cfg (voice, primaryLanguage, greeting_instructions / fallback admin)
  const cfg = await resolveTenantGreetingCfg(phone); // ← à implémenter en copiant api/agent/config
  if (!cfg) return new NextResponse(null, { status: 204 });

  const text = buildOpenerText(cfg.greeting, cfg.language);
  if (!text) return new NextResponse(null, { status: 204 }); // rien à pré-render

  const key = { userId: cfg.userId, textHash: openerHash(text), voice: cfg.voice, language: cfg.language };

  // 2. Cache hit → renvoyer le PCM brut
  const hit = await getGreetingAudio(key);
  if (hit) {
    return new NextResponse(Buffer.from(hit.audioPcm), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "x-voice": hit.voice, "x-sample-rate": String(hit.sampleRate),
      },
    });
  }

  // 3. Miss → enqueue génération background (NE PAS attendre) + 204
  void renderOpenerAudio({ text, voice: cfg.voice, model: cfg.model })
    .then((r) => putGreetingAudio(key, r.pcm, r.sampleRate))
    .catch(() => {});
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 2 : Implémenter `resolveTenantGreetingCfg`** en copiant la logique de `app/api/agent/config/route.ts` (résolution tenant depuis phone_numbers, lecture `agent_configs` + fallback admin greeting per-plan). Retourne `{ userId, voice, model, language, greeting }` ou null.

- [ ] **Step 3 : Typecheck + build**

Run: `cd ~/Desktop/assist-ai && npx tsc --noEmit && npx next build`
Expected: build OK, route `/api/agent/greeting-audio` listée.

- [ ] **Step 4 : Smoke-test endpoint** (local ou prod après deploy)

```bash
# en prod : 1er appel = 204 (miss + génération lancée) ; après quelques s, re-appel = 200 + binaire
curl -s -o /tmp/g.pcm -D - "https://aitamara.com/api/agent/greeting-audio?phone=+97223764700" \
  -H "x-internal-secret: $INTERNAL_SECRET" | head
```
Expected : 1er = `204` ; après ~10 s, 2e = `200` + `x-voice` + corps binaire non vide.

- [ ] **Step 5 : Commit + déployer (web auto-deploy)**

```bash
cd ~/Desktop/assist-ai
git add app/api/agent/greeting-audio/route.ts
git commit -m "feat(greeting): endpoint /api/agent/greeting-audio (hit/miss + lazy render)"
git push
```

---

## PHASE 5 — Web : génération proactive à la sauvegarde du greeting

### Task 6 : enqueue render quand le tenant sauve son greeting

**Files:**
- Modify: la route qui persiste `greeting_instructions` (à localiser : `grep -rn "greetingInstructions" app/api/dashboard app/api/admin`).

- [ ] **Step 1 : Localiser** le(s) handler(s) qui écrivent `agent_configs.greeting_instructions` (dashboard config PUT + admin configs PUT).

- [ ] **Step 2 : Après l'écriture réussie**, déclencher un render proactif fire-and-forget pour la voix+langue courantes du tenant :

```ts
// après le update agent_configs ... (import en haut)
import { buildOpenerText, openerHash } from "@/lib/opener";
import { getGreetingAudio, putGreetingAudio } from "@/lib/greeting-audio-storage";
import { renderOpenerAudio } from "@/lib/greeting-render";

async function warmGreetingAudio(userId: string, greeting: string, voice: string, language: string, model: string) {
  const text = buildOpenerText(greeting, language);
  if (!text) return;
  const key = { userId, textHash: openerHash(text), voice, language };
  if (await getGreetingAudio(key)) return;       // déjà en cache
  try { const r = await renderOpenerAudio({ text, voice, model }); await putGreetingAudio(key, r.pcm, r.sampleRate); } catch {}
}
// appel : void warmGreetingAudio(userId, newGreeting, cfg.voice, cfg.primaryLanguage, cfg.model);
```

- [ ] **Step 3 : Typecheck + commit + push**

```bash
cd ~/Desktop/assist-ai && npx tsc --noEmit && \
git add -A && git commit -m "feat(greeting): pré-génération proactive à la sauvegarde du greeting" && git push
```

---

## PHASE 6 — Worker : lecture + handoff (API-dependent — VÉRIFIER avant de coder)

### Task 7 : player audio + injection dans la sortie agent

**Files:**
- Create: `~/Desktop/assistAI-claude-agent/src/greeting-player.ts`
- Modify: `~/Desktop/assistAI-claude-agent/agent.ts`

> ⚠️ **Dépend de l'API audio de `@livekit/agents` 1.4. VÉRIFIER d'abord.**

- [ ] **Step 1 : Vérifier l'API d'injection audio** (lecture, pas de code deviné)

Lire dans `node_modules/@livekit/agents/dist/voice/` :
- comment publier/écrire des frames sur la sortie audio de l'agent (`room_io/_output.d.ts` : `ParticipantAudioOutput.captureFrame(AudioFrame)`),
- comment obtenir cette sortie depuis la `session`/`RoomIO`,
- le constructeur `AudioFrame` (`@livekit/rtc-node`) : `data: Int16Array`, `sampleRate`, `channels`, `samplesPerChannel`,
- comment **geler la VAD/entrée** pendant la lecture (chercher `inputEnabled`, `interrupt`, `setInputAudioEnabled`, ou couper le RoomIO input). Noter le hook trouvé.

Documenter en tête de `greeting-player.ts` l'API réellement disponible.

- [ ] **Step 2 : Implémenter le player** (adapter au Step 1)

```ts
// src/greeting-player.ts
import { AudioFrame } from "@livekit/rtc-node";

const FRAME_MS = 20;

/** Découpe un PCM16 mono en AudioFrames de 20ms à `sampleRate`. */
export function pcmToFrames(pcm: Buffer, sampleRate: number): AudioFrame[] {
  const samplesPerFrame = Math.floor((sampleRate * FRAME_MS) / 1000);
  const bytesPerFrame = samplesPerFrame * 2;
  const frames: AudioFrame[] = [];
  for (let off = 0; off + bytesPerFrame <= pcm.length; off += bytesPerFrame) {
    const slice = pcm.subarray(off, off + bytesPerFrame);
    const i16 = new Int16Array(slice.buffer, slice.byteOffset, samplesPerFrame);
    frames.push(new AudioFrame(Int16Array.from(i16), sampleRate, 1, samplesPerFrame));
  }
  return frames;
}

/** Fetch l'opener pré-généré. null si 204/erreur/timeout. */
export async function fetchOpenerPcm(phone: string, internalSecret: string, baseUrl: string, timeoutMs = 500): Promise<{ pcm: Buffer; sampleRate: number } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/agent/greeting-audio?phone=${encodeURIComponent(phone)}`, {
      headers: { "x-internal-secret": internalSecret }, signal: ctrl.signal,
    });
    if (res.status !== 200) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const sr = Number(res.headers.get("x-sample-rate") ?? "24000");
    return buf.length ? { pcm: buf, sampleRate: sr } : null;
  } catch { return null; } finally { clearTimeout(t); }
}
```

- [ ] **Step 3 : Test unitaire pur de `pcmToFrames`**

```ts
// scripts ad-hoc ou tools/ — npx tsx :
import assert from "node:assert/strict";
import { pcmToFrames } from "../src/greeting-player";
const pcm = Buffer.alloc(24000 * 2); // 1s @24k
const frames = pcmToFrames(pcm, 24000);
assert.strictEqual(frames.length, 50);            // 1000ms / 20ms
assert.strictEqual(frames[0].samplesPerChannel, 480);
console.log("pcmToFrames OK");
```
Run: `cd ~/Desktop/assistAI-claude-agent && npx tsx <ce-fichier>` → `pcmToFrames OK`.

- [ ] **Step 4 : Câbler dans `agent.ts`** — entre `ctx.connect()` (room dispo) et `session.start()` :
  - `const opener = await fetchOpenerPcm(dialedNumber, INTERNAL_SECRET, WEB_BASE_URL);`
  - si `opener` : geler l'entrée VAD (hook du Step 1), publier les frames (`pcmToFrames` → `captureFrame` en boucle ~20ms), dégeler après la durée totale + ~300ms jitter, set `greetingSource = "prerendered"`.
  - dans `onEnter` : **si `greetingSource === "prerendered"`** → NE PAS `generateReply` ; à la place injecter dans le chatCtx un message `assistant` = le texte d'opener + un message `system` « Tu as déjà accueilli l'appelant, ne resalue pas, réponds à sa prochaine intervention. » ; sinon comportement actuel.
  - **Warming parallèle** : laisser `session.start()` se faire pendant/juste après la lecture de l'amorce (déjà en parallèle puisque la lecture n'attend pas le modèle).

- [ ] **Step 5 : Typecheck**

Run: `cd ~/Desktop/assistAI-claude-agent && npm run typecheck`
Expected: exit 0.

- [ ] **Step 6 : Commit + déployer worker** (⚠️ pas d'auto-deploy — cf. [[worker_repo]])

```bash
cd ~/Desktop/assistAI-claude-agent
git add -A && git commit -m "feat(greeting): lecture opener pré-généré + handoff + gating VAD"
git push
RAILWAY_TOKEN=<project-token> railway up --service assistAI-claude-agent --detach
```

---

## PHASE 7 — Validation bout-en-bout (appel réel)

### Task 8 : vérifier latence + qualité

- [ ] **Step 1** : s'assurer que le cache est chaud (sauver le greeting du tenant test → render proactif, ou curl l'endpoint 2x jusqu'à 200).
- [ ] **Step 2** : passer un **appel test** sur le numéro du tenant.
- [ ] **Step 3** : écouter — l'accueil doit arriver **quasi instantanément**, dans la **même voix** que la suite, **sans double accueil** ni couture, et le modèle répond correctement au 1er mot.
- [ ] **Step 4** : dans `/dashboard/logs`, vérifier `greeting_source: prerendered` et le nouveau `greetingMs` (doit chuter à ~300-500ms). Lire la ligne `call_metrics` via `railway logs --service assistAI-claude-agent`.
- [ ] **Step 5** : tester le **fallback** : tenant sans greeting / voix non supportée → l'appel marche en mode modèle (zéro régression).

---

## Notes
- **Tests** : seules les unités pures (`opener.ts`, `pcmToFrames`) sont testées unitairement (tsx). Le reste (rendu Realtime, audio LiveKit, latence) se valide par smoke-tests + appel réel — c'est inhérent au domaine voix/temps-réel.
- **Fallback partout** : toute défaillance retombe sur le greeting modèle actuel.
- **Déploiement** : web auto-deploy sur push ; **worker via `railway up`** (pas d'auto-deploy).
