# Logique du greeting (première réponse de l'agent)

Doc de référence pour comprendre comment le worker décide ce que l'agent
dit en tout premier quand un appel démarre (téléphone ou web LiveTest).

Last updated : 2026-05-15.

---

## Vue d'ensemble

Quand une session démarre, le worker (`~/Desktop/assistAI-claude-agent/agent.ts`)
appelle `session.generateReply(...)` UNE fois pour déclencher la 1ʳᵉ
phrase de l'agent. Le contenu de cette phrase dépend de 2 inputs :

1. **`agent_configs.greeting_instructions`** (per-tenant, DB) — texte
   exact que l'agent doit prononcer, ou vide.
2. **`app_settings.greeting_fallback_template_by_plan`** (per-plan, admin
   editable via `/admin` → Salutation fallback) — directive de secours
   appliquée seulement si le tenant n'a rien renseigné.

---

## Les 3 cas possibles

| Priorité | `greeting_instructions` tenant | Admin fallback per-plan | Comportement |
|----------|--------------------------------|-------------------------|--------------|
| **Cas 1** | Non-vide (ex. `Bonjour, votre commande est prête.`) | Peu importe | Le worker force le LLM à prononcer **TEXTUELLEMENT** cette phrase mot pour mot en première réponse, puis à enchaîner sur la 1ʳᵉ étape du workflow persona. |
| **Cas 2** | Vide | Non-vide pour le plan du tenant | Le template admin est injecté comme directive (avec `{agent_name}` substitué). Safety net pour les tenants au persona incomplet. |
| **Cas 3** | Vide | Vide aussi | **Aucune injection**. Le LLM ouvre la conversation seul, selon la persona du tenant. ⇐ comportement par défaut depuis le 2026-05-15. |

---

## Code path

### 1. Worker `entry()` (agent.ts ~ligne 285)

```
ctx.connect()
 ↓
detectOrigin(ctx)         // sip / web / unknown via attributes + metadata
 ↓
fetchConfig(origin)       // GET /api/agent/config?phone=... ou ?userId=...
 ↓
session.start({           // ouvre WebSocket OpenAI Realtime + démarre VAD
  agent: TenantAgent,
  room: ctx.room,
  inputOptions: { noiseCancellation: audioEnhancement(...) },
});
 ↓
TenantAgent.onEnter()
 ↓
this.session.generateReply({ instructions?: greetInstructions })
```

### 2. Construction de `greetInstructions` (agent.ts ~ligne 860)

```ts
const customGreeting = cfg.greetingInstructions?.trim();

const namePart =
  cfg.agentName && cfg.agentName.trim().length > 0
    ? `« ${cfg.agentName.trim()} »`
    : 'défini dans tes instructions système';

const adminFallback =
  cfg.greetingFallbackTemplate &&
  cfg.greetingFallbackTemplate.trim().length > 0
    ? cfg.greetingFallbackTemplate.replace(/\{agent_name\}/g, namePart)
    : '';   // ← VIDE par défaut : pas d'override

const greetInstructions =
  customGreeting && customGreeting.length > 0
    ? `Commence ta première réponse en prononçant TEXTUELLEMENT,
       mot pour mot et dans la même langue, la phrase d'accueil
       ci-dessous (entre triple guillemets). Ne reformule pas, ne
       paraphrase pas cette phrase. PUIS, dans la même réponse vocale
       (même tour, sans attendre que l'interlocuteur parle), enchaîne
       directement avec la PREMIÈRE étape de ton persona/workflow...

       Phrase d'accueil littérale :
       """
       ${customGreeting}
       """`
    : adminFallback;
```

### 3. Appel à `generateReply`

```ts
if (greetInstructions.length > 0) {
  await this.session.generateReply({ instructions: greetInstructions });
} else {
  // Cas 3 : pas d'override, le persona system prompt gère seul.
  await this.session.generateReply();
}
```

---

## Placeholders supportés

Dans le template admin "Salutation fallback" (cas 2 uniquement), un
placeholder est substitué côté worker au runtime :

- `{agent_name}` → `« <nom> »` si `agent_configs.agent_name` est non-vide,
  sinon la string littérale `défini dans tes instructions système`
  (le LLM ira chercher le nom dans le persona system prompt).

Pas d'autre placeholder pour l'instant. Ajouter en suivant le pattern
`replace(/\{xxx\}/g, value)` dans le worker.

---

## Edge cases & gotchas

### `<REGLE_STRICTE>` dans le persona

Si le tenant écrit dans `instructions` un truc du style :
```
<REGLE_STRICTE>Répète mot pour mot le texte.</REGLE_STRICTE>
<TEXTE>Bonjour, votre commande est prête.</TEXTE>
```

→ Le bon endroit pour mettre la phrase exacte = `greeting_instructions`,
pas `instructions`. Sinon le worker (cas 1 ou 2) injecte sa propre directive
qui peut court-circuiter la REGLE_STRICTE.

### Langue par défaut

Le worker ajoute une directive de langue séparée (voir `languageDirective`
dans `/api/agent/config`) basée sur `agent_configs.primary_language` (fr/he/en).
Cette directive demande à l'agent d'ouvrir dans cette langue puis de
s'adapter dès que l'interlocuteur parle. Cette directive est dans le SYSTEM
prompt (pas dans `greetInstructions`), donc indépendante des cas ci-dessus.

### Conflit cas 1 + persona

Si le greeting_instructions et le persona se contredisent (ex. greeting
= "Hello" mais persona = "tu parles français") → la directive `Commence
ta première réponse... mot pour mot` du cas 1 GAGNE pour la 1ʳᵉ phrase
uniquement. Ensuite l'agent suit le persona. Mismatch garanti = symptôme
d'un greeting orphelin oublié en DB.

### `gpt-realtime-2` ignore parfois la persona

Le modèle peut produire un préambule générique (style "How can I help
you today? Please share your phone number...") au lieu de suivre la
persona. Causes possibles :
- L'agent a parlé avant que le system prompt soit pleinement injecté
  (race condition côté OpenAI)
- Le persona contient des contradictions internes
- gpt-realtime-2 a un biais commercial entraîné

Mitigation : utiliser `greeting_instructions` non-vide pour forcer
textuel — c'est la seule garantie absolue.

---

## Édition admin & tenant

### Admin (`/admin` → tile "Salutation fallback")

Édite `app_settings.greeting_fallback_template_by_plan` per-plan
(whatsapp / global / premium). Vide = pas d'override (default depuis
2026-05-15). Placeholders : `{agent_name}`.

### Tenant (`/dashboard` → Notifications/Persona — TODO surface in UI)

Édite `agent_configs.greeting_instructions`. Doit contenir la phrase
**EXACTE** à prononcer (le worker la met entre triple guillemets et
demande au LLM de la prononcer mot pour mot). Pas de placeholder
supporté côté tenant.

---

## Historique des changements

- **2026-05-15** (commit `e1149bb` worker + `410fa14` web) — fallback
  default → vide ; cas 3 ajouté (no injection, persona seul).
- **2026-05-15 (matin)** — déplacement du fallback hardcoded worker
  vers admin-editable (`app_settings.greeting_fallback_template_by_plan`).
- **2026-05-14** — fix "Lina / Centre Harmonie" hallucination : fallback
  hardcoded devient "ne pas inventer de nom de structure".
- **2026-05-12** — premier fallback hardcoded ajouté ("Salue par ton
  prénom et le nom du centre") — biais "centre de beauté" qui faisait
  halluciner les persona non-centre.

---

## Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `lib/agent-prompt-defaults.ts` | `DEFAULT_GREETING_FALLBACK_TEMPLATE` (default vide) |
| `lib/settings.ts` | `getGreetingFallbackTemplateByPlan` / setter — persistance app_settings |
| `app/api/agent/config/route.ts` | Sert `greetingFallbackTemplate` per-plan au worker |
| `app/api/admin/settings/route.ts` | GET + PUT du template per-plan (admin UI) |
| `app/admin/system-directives-form.tsx` | UI éditeur "Salutation fallback" |
| `~/Desktop/assistAI-claude-agent/agent.ts` (worker) | `greetInstructions` + `session.generateReply` |
