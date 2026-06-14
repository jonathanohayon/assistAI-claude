"use client";

/**
 * CrmClient — switcher de tuiles pour l'onglet CRM fusionné (Agenda ·
 * Clients · Commandes). Reproduit le pattern de config-form.tsx :
 * une grille de cartes cliquables (Tile) qui ouvre un workspace sous la
 * grille via un state `activeTile`.
 *
 * 3 tuiles : "calendar" (réutilise CalendarSettings + CalendarTable),
 * "customers" (SheetPicker + ContactsTable) et "orders" (SheetPicker +
 * OrdersTable). Gating par feature de plan (hasCalendar / hasCrm) avec
 * bypass admin.
 */

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { ConnectGoogleLink } from "@/components/ConnectGoogleLink";

import { CalendarSettings } from "../calendar/calendar-settings";
import { CalendarTable } from "../calendar/calendar-table";
import { ContactsTable } from "../contacts/contacts-table";
import { Tile, type TileDef } from "../config/shared-ui";

import { OrdersTable } from "./orders-table";
import { SheetPicker } from "./sheet-picker";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  description: string;
  link: string;
}

interface Contact {
  rowIndex: number;
  timestamp: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

type TileId = "calendar" | "customers" | "orders";

// Keyframes consommées par <Tile> (anim-bounce-in) et le workspace
// (anim-fade-up). Elles vivent normalement dans CONFIG_FORM_CSS, injecté
// par config-form.tsx — la page CRM ne montant pas ce form, on réinjecte
// ici le strict nécessaire (+ garde prefers-reduced-motion).
const CRM_ANIM_CSS = `
        @keyframes crm-fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes crm-bounce-in {
          0% { opacity: 0; transform: scale(0.92); }
          60% { transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        .anim-fade-up { animation: crm-fade-up 0.6s ease-out backwards; }
        .anim-bounce-in { animation: crm-bounce-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards; }
        @media (prefers-reduced-motion: reduce) {
          .anim-fade-up, .anim-bounce-in { animation: none !important; }
        }
`;

export function CrmClient({
  events,
  contacts,
  googleConnected,
  tokenExpired,
  selectedCalendarId,
  hasCalendar,
  hasCrm,
  isAdmin,
}: {
  events: CalendarEvent[];
  contacts: Contact[];
  googleConnected: boolean;
  tokenExpired: boolean;
  selectedCalendarId: string;
  hasCalendar: boolean;
  hasCrm: boolean;
  isAdmin: boolean;
}) {
  const t = useTranslations("DashboardCrm");

  const showCalendar = hasCalendar || isAdmin;
  const showCrm = hasCrm || isAdmin;

  // ── Métadata des tuiles (même structure que config-form.tsx) ─────────
  const TILES = useMemo<(TileDef & { id: TileId })[]>(() => {
    const all: (TileDef & { id: TileId; gated: boolean })[] = [
      {
        id: "calendar",
        label: t("tileCalendarLabel"),
        tagline: t("tileCalendarTagline"),
        summary: t("tileCalendarSummary", { count: events.length }),
        accent: "from-[#06b6d4] to-[#0e7490]",
        gated: showCalendar,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        ),
      },
      {
        id: "customers",
        label: t("tileCustomersLabel"),
        tagline: t("tileCustomersTagline"),
        summary: t("tileCustomersSummary", {
          count: contacts.filter((c) => c.name || c.phone || c.email).length,
        }),
        accent: "from-[#be185d] to-[#ec4899]",
        gated: showCrm,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        id: "orders",
        label: t("tileOrdersLabel"),
        tagline: t("tileOrdersTagline"),
        summary: t("tileOrdersSummary"),
        accent: "from-[#f59e0b] to-[#b45309]",
        gated: showCrm,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
            <path d="M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1z" />
            <path d="M9 12h6M9 16h6M9 8h.01" />
          </svg>
        ),
      },
    ];
    return all
      .filter((tile) => tile.gated)
      .map((tile): TileDef & { id: TileId } => ({
        id: tile.id,
        label: tile.label,
        tagline: tile.tagline,
        summary: tile.summary,
        accent: tile.accent,
        icon: tile.icon,
      }));
  }, [t, events.length, contacts, showCalendar, showCrm]);

  // Tuile active par défaut : la 1re visible (calendar quand dispo, sinon
  // la 1re tuile CRM). null si aucune tuile n'est accessible.
  const [activeTile, setActiveTile] = useState<TileId | null>(
    TILES[0]?.id ?? null,
  );

  const active = TILES.find((tile) => tile.id === activeTile) ?? null;

  // Aucune tuile visible (ni calendar ni CRM, et pas admin) → message.
  if (TILES.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        {t("noFeatureAvailable")}
      </div>
    );
  }

  return (
    <div>
      <style>{CRM_ANIM_CSS}</style>

      {/* Intro : explique les 3 options au-dessus des tuiles. */}
      <div className="mb-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4 sm:p-5">
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {t("introLead")}
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {TILES.map((tile) => {
            const introKey =
              tile.id === "calendar"
                ? "introCalendar"
                : tile.id === "customers"
                  ? "introCustomers"
                  : "introOrders";
            return (
              <li key={tile.id} className="flex flex-wrap gap-x-1.5">
                <span className="font-semibold text-[var(--color-foreground)]">
                  {tile.label}
                </span>
                <span className="text-[var(--color-muted-foreground)]">
                  — {t(introKey)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Grille de tuiles (style config-form) ─────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {TILES.map((tile, i) => (
          <Tile
            key={tile.id}
            tile={tile}
            active={activeTile === tile.id}
            onClick={() =>
              setActiveTile((curr) => (curr === tile.id ? null : tile.id))
            }
            delay={120 + i * 60}
          />
        ))}
      </div>

      {/* ── Workspace de la tuile active ─────────────────────────────── */}
      {active && (
        <div
          key={active.id}
          className="anim-fade-up mt-5 overflow-hidden rounded-[2rem] border border-[var(--color-border)] bg-white shadow-sm"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-muted)]/30 px-6 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${active.accent} text-white shadow-md`}
              >
                {active.icon}
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg tracking-tight text-[var(--color-foreground)] sm:text-xl">
                  {active.label}
                </h2>
                <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                  {active.summary}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveTile(null)}
              aria-label={t("closeAria")}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[var(--color-muted-foreground)] shadow-sm transition-all hover:bg-red-50 hover:text-[var(--color-destructive)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-4 w-4" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div className="px-6 py-6 sm:px-8 sm:py-7">
            {!googleConnected ? (
              <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                <p>{t("googleNotConnected")}</p>
                <ConnectGoogleLink className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--color-primary)]">
                  {t("connectButton")}
                </ConnectGoogleLink>
              </div>
            ) : active.id === "calendar" ? (
              tokenExpired ? (
                <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                  <p>{t("tokenExpired")}</p>
                  <ConnectGoogleLink className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--color-primary)]">
                    {t("reconnectButton")}
                  </ConnectGoogleLink>
                </div>
              ) : (
                <>
                  <CalendarSettings initialSelectedId={selectedCalendarId} />
                  <CalendarTable initialEvents={events} />
                </>
              )
            ) : active.id === "customers" ? (
              <div className="space-y-5">
                <SheetPicker type="customers" />
                {tokenExpired ? (
                  <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                    <p>{t("tokenExpired")}</p>
                    <ConnectGoogleLink className="rounded-full bg-[var(--color-foreground)] px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--color-primary)]">
                      {t("reconnectButton")}
                    </ConnectGoogleLink>
                  </div>
                ) : (
                  <ContactsTable initial={contacts} />
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <SheetPicker type="orders" />
                <OrdersTable />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
