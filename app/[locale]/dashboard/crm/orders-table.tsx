"use client";

import { useTranslations, useLocale } from "next-intl";
import { useEffect, useState, useTransition } from "react";

interface Order {
  id: string;
  name: string;
  phone: string;
  date: string;
  description: string;
  center: string;
  start: string;
}

type SyncState = "idle" | "syncing" | "synced" | "noSheet" | "error";

/**
 * Table des commandes (RDV/demandes captées par l'agent), autonome :
 * fetch GET /api/dashboard/orders au montage. Bouton « Exporter vers le
 * Sheet » → POST /api/dashboard/orders. Style aligné sur contacts-table.
 */
export function OrdersTable() {
  const t = useTranslations("DashboardCrm");
  const locale = useLocale();
  const [orders, setOrders] = useState<Order[]>([]);
  const [source, setSource] = useState<"sheet" | "calendar" | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sync, setSync] = useState<SyncState>("idle");
  const [isPending, startTransition] = useTransition();

  const load = async () => {
    try {
      const res = await fetch("/api/dashboard/orders", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setOrders(Array.isArray(data?.orders) ? data.orders : []);
      setSource(data?.source ?? null);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial post-fetch, pattern voulu
    void load();
  }, []);

  const fmtDate = (value: string) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  const exportToSheet = () => {
    setSync("syncing");
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/orders", { method: "POST" });
        if (res.ok) {
          setSync("synced");
          await load(); // recharge depuis le Sheet pour voir les lignes exportées
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (res.status === 400 && data?.error === "no_orders_sheet") {
          setSync("noSheet");
          return;
        }
        setSync("error");
      } catch {
        setSync("error");
      }
    });
  };

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
        <div className="space-y-3 p-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg bg-[var(--color-muted)]/60"
            />
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-muted-foreground)]">
        {t("ordersEmpty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {source && (
        <p className="text-xs text-[var(--color-muted-foreground)]">
          {source === "sheet"
            ? t("ordersSourceSheet")
            : t("ordersSourceCalendar")}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-[20px] text-xs">
          {sync === "synced" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {t("ordersSynced")}
            </span>
          )}
          {sync === "noSheet" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              {t("ordersNoSheet")}
            </span>
          )}
          {sync === "error" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 font-medium text-red-700 ring-1 ring-inset ring-red-200">
              {t("ordersSyncError")}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={exportToSheet}
          disabled={isPending || sync === "syncing" || orders.length === 0}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:scale-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 ${sync === "syncing" ? "motion-safe:animate-spin" : ""}`}
            aria-hidden
          >
            {sync === "syncing" ? (
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            ) : (
              <>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M17 8l-5-5-5 5" />
                <path d="M12 3v12" />
              </>
            )}
          </svg>
          {sync === "syncing" ? t("ordersSyncing") : t("ordersSync")}
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl border border-[var(--color-border)] bg-white p-8 text-center text-sm text-[var(--color-muted-foreground)]">
          {t("ordersEmpty")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-muted)]/50 text-left text-xs uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("ordersColName")}</th>
                  <th className="px-4 py-3 font-medium">{t("ordersColPhone")}</th>
                  <th className="px-4 py-3 font-medium">{t("ordersColDate")}</th>
                  <th className="px-4 py-3 font-medium">
                    {t("ordersColDescription")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("ordersColCenter")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]/60">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3 align-top">
                      <span className="font-medium text-[var(--color-foreground)]">
                        {o.name || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs">
                      {o.phone ? <span dir="ltr">{o.phone}</span> : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-top text-xs text-[var(--color-muted-foreground)]">
                      {fmtDate(o.date)}
                    </td>
                    <td className="max-w-[280px] px-4 py-3 align-top text-xs text-[var(--color-muted-foreground)]">
                      <span className="line-clamp-2 whitespace-pre-line">
                        {o.description || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs">
                      {o.center || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
