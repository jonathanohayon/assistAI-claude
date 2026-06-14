"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { ConnectGoogleLink } from "@/components/ConnectGoogleLink";

interface SheetItem {
  id: string;
  name: string;
}

interface SheetState {
  selectedId: string | null;
  selectedName: string | null;
  list: SheetItem[];
  scopeMissing: boolean;
}

/**
 * Encadré de gestion du Google Sheet lié (clients ou commandes).
 * fetch GET /api/dashboard/sheets?type={type}. Permet de créer un nouveau
 * Sheet ou d'en choisir un existant. Style aligné config (rounded-2xl).
 */
export function SheetPicker({ type }: { type: "customers" | "orders" }) {
  const t = useTranslations("DashboardCrm");
  const [state, setState] = useState<SheetState | null>(null);
  const [loading, setLoading] = useState(true);
  const [createName, setCreateName] = useState("");
  const [pickId, setPickId] = useState("");
  const [createStatus, setCreateStatus] = useState<
    "idle" | "creating" | "saved" | "error"
  >("idle");
  const [pickStatus, setPickStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [pasteValue, setPasteValue] = useState("");
  const [pasteStatus, setPasteStatus] = useState<
    "idle" | "saving" | "saved" | "error" | "invalid"
  >("idle");
  const [isPending, startTransition] = useTransition();

  // Extrait l'ID d'un Sheet depuis une URL Google Sheets ou un ID brut collé.
  const extractSheetId = (input: string): string | null => {
    const m = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    const raw = input.trim();
    return /^[a-zA-Z0-9-_]{20,}$/.test(raw) ? raw : null;
  };

  const load = async () => {
    try {
      const res = await fetch(
        `/api/dashboard/sheets?type=${encodeURIComponent(type)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setState({
        selectedId: data?.selectedId ?? null,
        selectedName: data?.selectedName ?? null,
        list: Array.isArray(data?.list) ? data.list : [],
        scopeMissing: Boolean(data?.scopeMissing),
      });
      setPickId(data?.selectedId ?? "");
    } catch {
      setState({
        selectedId: null,
        selectedName: null,
        list: [],
        scopeMissing: false,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial du Sheet lié : setState après fetch, pattern voulu
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const createSheet = () => {
    if (!createName.trim()) return;
    setCreateStatus("creating");
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, action: "create", name: createName.trim() }),
        });
        if (!res.ok) throw new Error("create");
        setCreateStatus("saved");
        setCreateName("");
        await load();
      } catch {
        setCreateStatus("error");
      }
    });
  };

  const selectSheet = () => {
    if (!pickId) return;
    setPickStatus("saving");
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, action: "select", id: pickId }),
        });
        if (!res.ok) throw new Error("select");
        setPickStatus("saved");
        await load();
      } catch {
        setPickStatus("error");
      }
    });
  };

  // Sélection par lien/ID collé — marche SANS le scope Drive (pas besoin de
  // lister). On extrait l'ID puis on réutilise l'action "select".
  const selectByPaste = () => {
    const id = extractSheetId(pasteValue);
    if (!id) {
      setPasteStatus("invalid");
      return;
    }
    setPasteStatus("saving");
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/sheets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, action: "select", id }),
        });
        if (!res.ok) throw new Error("select");
        setPasteStatus("saved");
        setPasteValue("");
        await load();
      } catch {
        setPasteStatus("error");
      }
    });
  };

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-md"
          aria-hidden
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </span>
        <h3 className="font-display text-base font-bold text-[var(--color-foreground)]">
          {t("sheetTitle")}
        </h3>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          <div className="h-10 animate-pulse rounded-lg bg-[var(--color-muted)]/60" />
          <div className="h-10 animate-pulse rounded-lg bg-[var(--color-muted)]/60" />
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {/* Sheet actuellement lié */}
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 px-4 py-3">
            {state?.selectedId ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[var(--color-foreground)]">
                  <span className="text-[var(--color-muted-foreground)]">
                    {t("sheetCurrent")}{" "}
                  </span>
                  <span className="font-medium">
                    {state.selectedName || state.selectedId}
                  </span>
                </p>
                <a
                  href={`https://docs.google.com/spreadsheets/d/${state.selectedId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                >
                  {t("sheetOpen")}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                    aria-hidden
                  >
                    <path d="M15 3h6v6" />
                    <path d="M10 14 21 3" />
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  </svg>
                </a>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {t("sheetNone")}
              </p>
            )}
          </div>

          {/* Créer un nouveau Sheet */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <input
                type="text"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  setCreateStatus("idle");
                }}
                placeholder={t("sheetCreatePlaceholder")}
                aria-label={t("sheetCreatePlaceholder")}
                className="min-w-[180px] flex-1 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
              />
              <button
                type="button"
                onClick={createSheet}
                disabled={
                  isPending || createStatus === "creating" || !createName.trim()
                }
                className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:scale-100"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {createStatus === "creating"
                  ? t("sheetCreating")
                  : t("sheetCreateBtn")}
              </button>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {t("sheetColumnsHint")}{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                {type === "customers"
                  ? t("sheetColumnsCustomers")
                  : t("sheetColumnsOrders")}
              </span>
            </p>
            {createStatus === "saved" && (
              <p className="text-xs font-medium text-emerald-700">
                {t("sheetSaved")}
              </p>
            )}
            {createStatus === "error" && (
              <p className="text-xs font-medium text-red-700">
                {t("sheetError")}
              </p>
            )}
          </div>

          {/* Choisir un Sheet existant */}
          <div className="space-y-3 border-t border-[var(--color-border)]/60 pt-4">
            <p className="text-xs font-medium text-[var(--color-foreground)]">
              {t("sheetPickLabel")}
            </p>

            {/* Dropdown (comme le sélecteur de calendriers) — nécessite le
                scope Drive pour lister. */}
            {!state?.scopeMissing && state && state.list.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <select
                    value={pickId}
                    onChange={(e) => {
                      setPickId(e.target.value);
                      setPickStatus("idle");
                    }}
                    aria-label={t("sheetPickBtn")}
                    className="min-w-[180px] flex-1 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
                  >
                    {state?.list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={selectSheet}
                    disabled={isPending || pickStatus === "saving" || !pickId}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-foreground)] shadow-sm transition-colors hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    {pickStatus === "saving" ? "…" : t("sheetPickBtn")}
                  </button>
                </div>
                {pickStatus === "saved" && (
                  <p className="text-xs font-medium text-emerald-700">
                    {t("sheetSaved")}
                  </p>
                )}
                {pickStatus === "error" && (
                  <p className="text-xs font-medium text-red-700">
                    {t("sheetError")}
                  </p>
                )}
              </div>
            )}

            {/* Sans scope Drive : on ne peut pas lister → on propose la
                reconnexion (pour avoir le dropdown) ET la sélection par lien. */}
            {state?.scopeMissing && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {t("sheetReconnectHint")}{" "}
                <ConnectGoogleLink className="font-medium text-[var(--color-primary)] underline underline-offset-2">
                  {t("sheetReconnect")}
                </ConnectGoogleLink>
              </p>
            )}

            {/* Sélection par lien/ID collé — universelle, sans reconnexion. */}
            <div className="space-y-1.5">
              <label className="text-xs text-[var(--color-muted-foreground)]">
                {t("sheetPasteLabel")}
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <input
                  type="text"
                  dir="ltr"
                  value={pasteValue}
                  onChange={(e) => {
                    setPasteValue(e.target.value);
                    setPasteStatus("idle");
                  }}
                  placeholder={t("sheetPastePlaceholder")}
                  aria-label={t("sheetPasteLabel")}
                  className="min-w-[180px] flex-1 rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-1"
                />
                <button
                  type="button"
                  onClick={selectByPaste}
                  disabled={
                    isPending || pasteStatus === "saving" || !pasteValue.trim()
                  }
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-foreground)] shadow-sm transition-colors hover:bg-[var(--color-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  {pasteStatus === "saving" ? "…" : t("sheetPasteBtn")}
                </button>
              </div>
              {pasteStatus === "invalid" && (
                <p className="text-xs font-medium text-red-700">
                  {t("sheetPasteInvalid")}
                </p>
              )}
              {pasteStatus === "saved" && (
                <p className="text-xs font-medium text-emerald-700">
                  {t("sheetSaved")}
                </p>
              )}
              {pasteStatus === "error" && (
                <p className="text-xs font-medium text-red-700">
                  {t("sheetError")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
