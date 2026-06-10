"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { ConnectGoogleLink } from "@/components/ConnectGoogleLink";

interface Calendar {
  id: string;
  summary: string;
  primary: boolean;
  timeZone: string | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; calendars: Calendar[]; selectedId: string }
  | { status: "invalid_grant" }
  | { status: "error"; message: string };

// Panel posé en haut de la page Calendrier qui permet :
//   - changer le calendrier Google utilisé par l'agent (dropdown)
//   - reconnecter Google même quand le flag connected=true (utile quand le
//     refresh token est mort → "expired"/"invalid_grant" → dashboard semble
//     connecté mais rien ne marche).
export function CalendarSettings({
  initialSelectedId,
  asUserId,
}: {
  initialSelectedId: string;
  /** Admin agissant sur un tenant — propagé aux APIs google + select-calendar. */
  asUserId?: string;
}) {
  const t = useTranslations("DashboardCalendar");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saving, startSaving] = useTransition();
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const qs = asUserId ? `?asUserId=${encodeURIComponent(asUserId)}` : "";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/google/calendars${qs}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as
          | { ok: true; calendars: Calendar[]; selectedId: string }
          | { ok: false; reason: string };
        if (cancelled) return;
        if (data.ok) {
          setState({
            status: "ready",
            calendars: data.calendars,
            selectedId: data.selectedId,
          });
        } else if (data.reason === "invalid_grant") {
          setState({ status: "invalid_grant" });
        } else {
          setState({ status: "error", message: data.reason });
        }
      } catch (e) {
        if (cancelled) return;
        setState({ status: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qs]);

  const handleSelect = (calendarId: string) => {
    if (state.status !== "ready" || calendarId === state.selectedId) return;
    startSaving(async () => {
      const res = await fetch(`/api/google/select-calendar${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId }),
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        setState({ ...state, selectedId: calendarId });
        const picked = state.calendars.find((c) => c.id === calendarId);
        setSavedToast(
          t("calendarSelected", { name: picked?.summary ?? calendarId }),
        );
        setTimeout(() => setSavedToast(null), 3000);
      }
    });
  };

  return (
    <div className="mb-6 rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
            {t("settingsTitle")}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
            {t("settingsDesc")}
          </p>

          {state.status === "loading" && (
            <p className="mt-3 text-xs italic text-[var(--color-muted-foreground)]">
              {t("loadingCalendars")}
            </p>
          )}

          {state.status === "ready" && (
            <div className="mt-3 flex items-center gap-3">
              <select
                value={state.selectedId}
                onChange={(e) => handleSelect(e.target.value)}
                disabled={saving}
                className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-foreground)] shadow-sm focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
              >
                {state.calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                    {c.primary ? t("primarySuffix") : ""}
                  </option>
                ))}
              </select>
              {saving && (
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  {t("saving")}
                </span>
              )}
              {savedToast && (
                <span className="text-xs text-emerald-700">{savedToast}</span>
              )}
            </div>
          )}

          {state.status === "invalid_grant" && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {t("errInvalidGrant")}
            </p>
          )}

          {state.status === "error" && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {t("errFetchList", { message: state.message })}
            </p>
          )}
        </div>

        <ConnectGoogleLink
          className="shrink-0 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] shadow-sm transition hover:bg-[var(--color-muted)]"
          title={t("reconnectTooltip")}
        >
          {t("reconnectButton")}
        </ConnectGoogleLink>
      </div>
      {/* initialSelectedId est passé pour SSR-render correct avant le fetch ;
          on s'en sert pas directement dans le rendu vu que le state est
          repris du serveur via l'API. Garde-le explicite pour signaler la
          dépendance, sans avoir à passer toute la liste depuis le SSR. */}
      <span className="sr-only" data-initial={initialSelectedId} />
    </div>
  );
}
