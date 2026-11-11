"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { showLevel3 } from "@/components/bricks/level3";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";

/**
 * URL publique de l'agent — à copier dans un client vocal (tamaravox) pour
 * que cet agent décroche le téléphone.
 *
 * Le jeton est réaffichable, contrairement à la clé API : c'est une URL qu'on
 * recopie, pas un secret saisi une fois. Il est aussi distinct de la clé API,
 * qui ouvrirait l'accès aux transcripts — partager cette URL ne donne que la
 * parole.
 *
 * Engineering-facing, so it is level-3 content: shown only when the viewer's
 * developer mode is on (admins always see it, same rule as every brick).
 * Off means the card is not in the DOM and the token is never fetched.
 */
export function AgentUrlCard({ isAdmin }: { isAdmin: boolean }) {
  const dev = useDeveloperMode();
  return <AgentUrlCardGate isAdmin={isAdmin} developerMode={dev.on} />;
}

/** The gate itself, without the store (rendered as-is by the tests). */
export function AgentUrlCardGate({ isAdmin, developerMode }: { isAdmin: boolean; developerMode: boolean }) {
  const t = useTranslations("AgentUrl");
  if (!showLevel3({ isAdmin, developerMode })) return null;
  return (
    <section
      aria-labelledby="agent-url-title"
      className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="agent-url-title" className="font-display text-lg text-[var(--color-foreground)]">
        {t("title")}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("desc")}</p>
      <AgentUrlSection />
    </section>
  );
}

export function AgentUrlSection() {
  const t = useTranslations("AgentUrl");
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
        <p className="text-sm font-medium text-[var(--color-foreground)]">{t("urlLabel")}</p>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("urlHint")}</p>

        <div className="mt-3 flex items-center gap-2">
          <code
            dir="ltr"
            className="min-w-0 flex-1 truncate rounded-lg bg-[var(--color-muted)] px-3 py-2 text-start font-mono text-xs text-[var(--color-foreground)]"
          >
            {url || "…"}
          </code>
          <button
            type="button"
            onClick={copy}
            disabled={!url}
            className="min-h-11 shrink-0 rounded-lg bg-[var(--color-foreground)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {copied ? t("copied") : t("copy")}
          </button>
          {/* Announces the copy to screen readers (the label swap alone isn't). */}
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? t("copied") : ""}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--color-muted-foreground)]">{t("warning")}</p>
          <button
            type="button"
            onClick={rotate}
            disabled={busy}
            className="min-h-11 shrink-0 rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
          >
            {t("rotate")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-xs">
        <p className="font-medium text-[var(--color-foreground)]">{t("contractTitle")}</p>
        <pre
          dir="ltr"
          className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 text-start font-mono text-[11px] leading-relaxed text-[var(--color-foreground)]"
        >
{`POST ${url || t("urlPlaceholder")}
{ "call_id": "…", "turn_id": 1, "language": "fr",
  "transcript": "Bonjour…", "history": [] }

→ 200 { "reply": "…" }   ${t("replyWithin")}`}
        </pre>
      </div>
    </div>
  );
}
