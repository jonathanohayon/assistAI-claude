"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { showLevel3 } from "@/components/bricks/level3";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";

type Meta = { prefix: string; createdAt: string } | null;

/**
 * "API & developer access" card: an API key, an endpoint and a curl sample.
 *
 * Engineering-facing, so it is level-3 content (same rule as AgentUrlCard):
 * shown only when the viewer's developer mode is on, admins always. While the
 * flag loads it counts as off. Off means the card is not in the DOM and the
 * key metadata (GET /api/dashboard/api-key) is never fetched, because the
 * fetch lives in ApiKeySection, which the gate does not render.
 */
export function ApiKeyCard({ isAdmin }: { isAdmin: boolean }) {
  const dev = useDeveloperMode();
  return <ApiKeyCardGate isAdmin={isAdmin} developerMode={dev.on} />;
}

/** The gate itself, without the store (rendered as-is by the tests). */
export function ApiKeyCardGate({ isAdmin, developerMode }: { isAdmin: boolean; developerMode: boolean }) {
  const t = useTranslations("DashboardSettings");
  if (!showLevel3({ isAdmin, developerMode })) return null;
  return (
    <section
      aria-labelledby="api-key-title"
      className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6"
    >
      <h2 id="api-key-title" className="font-display text-lg text-[var(--color-foreground)]">
        {t("apiSection")}
      </h2>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("apiDesc")}</p>
      <ApiKeySection />
    </section>
  );
}

export function ApiKeySection() {
  const t = useTranslations("DashboardSettings");
  const [meta, setMeta] = useState<Meta>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("https://app.tamara.example");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window dispo post-mount uniquement (SSR-safe)
    setOrigin(window.location.origin);
    fetch("/api/dashboard/api-key")
      .then((r) => (r.ok ? r.json() : { meta: null }))
      .then((d: { meta: Meta }) => setMeta(d.meta))
      .catch(() => {});
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/dashboard/api-key", { method: "POST" });
      const d = (await res.json()) as { key: string; meta: Meta };
      setRevealed(d.key);
      setMeta(d.meta);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await fetch("/api/dashboard/api-key", { method: "DELETE" });
      setRevealed(null);
      setMeta(null);
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  const example = `curl "${origin}/api/v1/transcripts?phone=+972500000000&from=2026-06-01&order=desc" \\\n  -H "Authorization: Bearer ${revealed ?? t("apiKeyPlaceholder")}"`;

  return (
    <div className="mt-4 space-y-4">
      {/* Key status */}
      {meta ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-muted)] px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-[var(--color-foreground)]" dir="ltr">
              tmr_{meta.prefix}••••••••
            </span>
            <span className="text-xs text-[var(--color-muted-foreground)]">
              {t("apiActiveSince")} {new Date(meta.createdAt).toLocaleDateString()}
            </span>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)] disabled:opacity-50"
            >
              {t("apiRegenerate")}
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {t("apiRevoke")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--color-muted)] px-4 py-3 text-sm">
          <span className="text-[var(--color-muted-foreground)]">{t("apiNoKey")}</span>
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[#be185d] px-4 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {t("apiGenerate")}
          </button>
        </div>
      )}

      {/* Key revealed only once */}
      {revealed && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-medium text-amber-800">{t("apiKeyOnceWarning")}</p>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-xs text-[var(--color-foreground)] ring-1 ring-inset ring-amber-200"
            >
              {revealed}
            </code>
            <button
              type="button"
              onClick={() => copy(revealed)}
              className="shrink-0 rounded-lg bg-[var(--color-foreground)] px-3 py-2 text-xs font-medium text-white"
            >
              {copied ? t("apiCopied") : t("apiCopy")}
            </button>
          </div>
        </div>
      )}

      {/* Quick reference */}
      <div className="rounded-xl border border-[var(--color-border)] bg-white px-4 py-3 text-xs">
        <p className="font-medium text-[var(--color-foreground)]">{t("apiEndpointLabel")}</p>
        <code dir="ltr" className="mt-1 block break-all font-mono text-[var(--color-muted-foreground)]">
          GET {origin}/api/v1/transcripts
        </code>
        <p className="mt-2 text-[var(--color-muted-foreground)] [overflow-wrap:anywhere]">{t("apiDocsParams")}</p>
        <pre dir="ltr" className="mt-2 overflow-x-auto rounded-lg bg-[var(--color-muted)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-foreground)]">
{example}
        </pre>
      </div>
    </div>
  );
}
