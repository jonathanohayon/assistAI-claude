"use client";

import { useEffect, useRef, useState } from "react";

/**
 * URL publique de l'agent — à copier dans un client vocal (tamaravox) pour
 * que cet agent décroche le téléphone.
 *
 * Le jeton est réaffichable, contrairement à la clé API : c'est une URL qu'on
 * recopie, pas un secret saisi une fois. Il est aussi distinct de la clé API,
 * qui ouvrirait l'accès aux transcripts — partager cette URL ne donne que la
 * parole.
 */
export function AgentUrlSection() {
  const [token, setToken] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window dispo post-mount uniquement (SSR-safe)
    setOrigin(window.location.origin);
    fetch("/api/dashboard/agent-url")
      .then((r) => (r.ok ? r.json() : { token: null }))
      .then((d: { token: string | null }) => setToken(d.token))
      .catch(() => {});
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const rotate = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/agent-url", { method: "POST" });
      const d = (await res.json()) as { token: string };
      setToken(d.token);
    } finally {
      setBusy(false);
    }
  };

  const url = token ? `${origin}/api/v1/agent/${token}` : "";

  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3">
        <p className="text-sm font-medium text-[var(--color-foreground)]">
          URL publique de votre agent
        </p>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          Collez-la dans un service vocal pour que votre agent réponde au
          téléphone. Elle utilise la persona configurée ci-dessus.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <code
            dir="ltr"
            className="min-w-0 flex-1 truncate rounded-lg bg-[var(--color-muted)] px-3 py-2 font-mono text-xs text-[var(--color-foreground)]"
          >
            {url || "…"}
          </code>
          <button
            type="button"
            onClick={copy}
            disabled={!url}
            className="shrink-0 rounded-lg bg-[var(--color-foreground)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {copied ? "Copié" : "Copier"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--color-muted-foreground)]">
            Toute personne disposant de cette URL peut faire parler votre
            agent. Elle ne donne accès ni à vos transcripts ni à votre compte.
          </p>
          <button
            type="button"
            onClick={rotate}
            disabled={busy}
            className="shrink-0 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            Régénérer
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-xs">
        <p className="font-medium text-[var(--color-foreground)]">
          Contrat attendu par les clients vocaux
        </p>
        <pre
          dir="ltr"
          className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-foreground)]"
        >
{`POST ${url || "<votre-url>"}
{ "call_id": "…", "turn_id": 1, "language": "fr",
  "transcript": "Bonjour…", "history": [] }

→ 200 { "reply": "…" }   sous 2 s`}
        </pre>
      </div>
    </div>
  );
}
