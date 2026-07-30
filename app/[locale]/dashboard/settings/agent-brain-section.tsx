"use client";

import { useEffect, useState } from "react";

/**
 * Choix du cerveau de l'agent : la persona Tamara, ou l'agent du tenant.
 *
 * Le réglage est explicite parce que ses conséquences le sont : en mode
 * externe, la persona configurée plus haut dans cette page n'est plus utilisée
 * du tout. Le dire ici évite qu'un tenant modifie sa persona pendant des
 * heures sans comprendre pourquoi son agent n'en tient aucun compte.
 */

type Brain = { enabled: boolean; url: string; secret?: string };

export function AgentBrainSection() {
  const [brain, setBrain] = useState<Brain>({ enabled: false, url: "" });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/agent-brain")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { brain: Brain } | null) => {
        if (d?.brain) setBrain(d.brain);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async (next: Brain) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/dashboard/agent-brain", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const d = (await res.json()) as { brain?: Brain; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? "Enregistrement impossible.");
        return;
      }
      if (d.brain) setBrain(d.brain);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  /** Vérifie que le endpoint répond au contrat avant de compter dessus. */
  const test = async () => {
    setProbe("…");
    try {
      const res = await fetch(brain.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: "dashboard_probe",
          turn_id: 1,
          language: "fr",
          transcript: "Bonjour, ceci est un test depuis le dashboard.",
          history: [],
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        reply?: unknown;
      } | null;
      setProbe(
        typeof data?.reply === "string" && data.reply.trim()
          ? `Réponse : « ${data.reply.slice(0, 120)} »`
          : `HTTP ${res.status} — pas de champ "reply" exploitable.`,
      );
    } catch {
      // Un échec ici est souvent du CORS : le navigateur ne peut pas joindre
      // un endpoint qui n'autorise pas cette origine, alors que le worker,
      // lui, appelle depuis le serveur et n'a pas cette contrainte.
      setProbe(
        "Injoignable depuis le navigateur (souvent du CORS). Le worker appelle depuis le serveur et n'est pas concerné.",
      );
    }
  };

  if (!loaded) {
    return (
      <p className="mt-4 text-xs text-[var(--color-muted-foreground)]">
        Chargement…
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={brain.enabled}
            disabled={busy}
            onChange={(e) => save({ ...brain, enabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            <span className="block text-sm font-medium text-[var(--color-foreground)]">
              Utiliser mon propre agent
            </span>
            <span className="mt-0.5 block text-xs text-[var(--color-muted-foreground)]">
              Tamara garde la voix, le numéro et la téléphonie ; c&apos;est
              votre agent qui décide des réponses.
            </span>
          </span>
        </label>

        {brain.enabled && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            Tant que ce mode est actif, la persona configurée plus haut
            n&apos;est pas utilisée.
          </p>
        )}

        <div className="mt-4">
          <label
            htmlFor="brain-url"
            className="block text-xs font-medium text-[var(--color-foreground)]"
          >
            URL de votre agent
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id="brain-url"
              type="url"
              dir="ltr"
              spellCheck={false}
              placeholder="https://api.votreboite.com/agent/reply"
              value={brain.url}
              onChange={(e) => setBrain({ ...brain, url: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-xs"
            />
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => save(brain)}
                disabled={busy}
                className="rounded-lg bg-[var(--color-foreground)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                {saved ? "Enregistré" : "Enregistrer"}
              </button>
              <button
                type="button"
                onClick={test}
                disabled={!brain.url.startsWith("http")}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
              >
                Tester
              </button>
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
          {probe && (
            <p className="mt-2 rounded-lg bg-[var(--color-muted)] px-3 py-2 text-[11px] break-words text-[var(--color-foreground)]">
              {probe}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-xs">
        <p className="font-medium text-[var(--color-foreground)]">
          Ce que Tamara envoie à votre agent
        </p>
        <pre
          dir="ltr"
          className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 font-mono text-[11px] leading-relaxed"
        >
{`POST ${brain.url || "<votre-url>"}
{ "call_id": "…", "turn_id": 3, "language": "fr",
  "transcript": "…", "history": [{ "role": "user", "text": "…" }] }

→ 200 { "reply": "…" }   sous 2 s`}
        </pre>
        <p className="mt-2 text-[var(--color-muted-foreground)]">
          Au-delà de 2 secondes, le tour est traité comme un silence : une
          phrase d&apos;attente est prononcée à votre place.
        </p>
      </div>
    </div>
  );
}
