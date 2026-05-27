"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Bouton "Sync now" : déclenche immédiatement la sync Calendar → Sheet
 * Clients pour le user loggué. Le cron Railway 5min fait pareil en
 * arrière-plan, ceci est juste un refresh manuel pour les impatients.
 */
export function SyncNowButton({ asUserId }: { asUserId?: string } = {}) {
  const t = useTranslations("DashboardCalendar");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    message: string;
  } | null>(null);

  const onClick = () => {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/dashboard/sync-now${qs}`, { method: "POST" });
        const data = (await res.json()) as {
          ok?: boolean;
          inserted?: number;
          updated?: number;
          scanned?: number;
          skipped?: number;
          reason?: string;
          elapsedMs?: number;
        };
        if (!res.ok || data.ok === false) {
          setFeedback({
            kind: "err",
            message: data.reason
              ? t("syncFailedReason", { reason: data.reason })
              : t("syncFailedHttp", { status: res.status }),
          });
          return;
        }
        const ins = data.inserted ?? 0;
        const upd = data.updated ?? 0;
        const total = data.scanned ?? 0;
        setFeedback({
          kind: "ok",
          message:
            ins + upd === 0
              ? t("syncSucceededNoChanges", { total, ms: data.elapsedMs ?? 0 })
              : t("syncSucceededChanges", { inserted: ins, updated: upd, total }),
        });
        // Refresh la page pour réafficher les events Calendar éventuellement
        // nouveaux (cas où le sync a importé un RDV créé ailleurs).
        router.refresh();
      } catch (e) {
        setFeedback({
          kind: "err",
          message: e instanceof Error ? e.message : t("errNetwork"),
        });
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-[var(--color-primary)] disabled:cursor-wait disabled:opacity-50"
      >
        {isPending ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 animate-spin">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            {t("syncing")}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
              <path
                d="M3 12a9 9 0 0 1 15.6-6.2L21 8m0-5v5h-5M21 12a9 9 0 0 1-15.6 6.2L3 16m0 5v-5h5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t("syncButton")}
          </>
        )}
      </button>
      {feedback && (
        <p
          className={`text-[11px] ${
            feedback.kind === "ok"
              ? "text-[var(--color-muted-foreground)]"
              : "text-[var(--color-destructive)]"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
