"use client";

// The connectors LIST (C1): one card per connector, then "+ Ajouter un agent"
// last; ONE large card when there is none. What each card shows is decided by
// lib/connectors/list-view.ts (pure); this file only draws it.
// UI ONLY: the switch, Tester, Modifier, Ajouter and Supprimer call the
// injected callbacks, nothing else (no request). Mounted on the live Connect
// page by components/connectors/ConnectorsPanel.tsx (C1b), which wires the
// actions that have a real route and marks the others "soon".

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";

import { FOCUS } from "@/components/bricks/controls";
import { formatPhone } from "@/lib/format-phone";
import {
  connectorsListView,
  formatConnectorPrice,
  type AddCardView,
  type CardPill,
  type ConnectorBasePrice,
  type ConnectorCardView,
  type ConnectorExtraPrice,
  type EmptyOfferView,
} from "@/lib/connectors/list-view";
import { menuKeyAction } from "@/lib/connectors/menu-keys";
import type { ConnectorsPageView } from "@/lib/connectors/types";

export type ConnectorsListCallbacks = {
  onToggle?: (id: string, enabled: boolean) => void;
  onTest?: (id: string) => void;
  onEdit?: (id: string) => void;
  onAdd?: () => void;
  /** Called only after the confirmation dialog's "Supprimer". */
  onDelete?: (id: string) => void;
};

/**
 * C1b: how a card's actions behave, per card.
 *   live = the switch, Tester and Modifier call the callbacks;
 *   soon = they are disabled, no "…" menu, and ONE plain line says the
 *          settings come later (a card whose actions have no route yet).
 * `busy` disables the switch while its save runs; `note` is one status line
 * under the actions (a test result, a refused save).
 */
export type CardActions = { mode: "live" | "soon"; busy?: boolean; note?: ReactNode };

export type ConnectorsListProps = ConnectorsListCallbacks & {
  page: ConnectorsPageView;
  /** The extra-connector monthly price, read from the catalogue by the caller. */
  extraPrice: ConnectorExtraPrice | null;
  /** The connect product's base offer (connectorBasePrice(catalogue, currency)), for the empty card. */
  basePrice: ConnectorBasePrice | null;
  /** "Now" for the relative dates (tests and captures pin it). */
  now?: string | Date;
  /** C1b: per card (default: live, not busy, no note). */
  actionsFor?: (card: ConnectorCardView) => CardActions;
  /**
   * C1b: the add wizard (C2) does not exist yet: an OPEN add card is drawn
   * disabled (its title and price line kept) with "Bientôt : ajoutez vos
   * agents ici.". Locked cards (trial / max / soon) keep their own words.
   */
  addSoon?: boolean;
};

const CARD = "rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm sm:p-6";
const BUTTON = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
const DANGER = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-3 text-sm font-semibold text-[#b91c1c] hover:bg-[#fef2f2] ${FOCUS}`;
const PRIMARY = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full bg-[#be185d] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#9d174d] ${FOCUS}`;

// Record<CardPill, …>: tsc fails when a state has no colour. Red is ONLY
// "unreachable"; setup_incomplete is the app's amber (the warning chips'
// border/bg/text and dot); "unknown" (a state this build does not know) is
// neutral, like "off".
const PILL: Record<CardPill, string> = {
  online: "border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]",
  off: "border-[#e2e8f0] bg-[#f1f5f9] text-[#475569]",
  unreachable: "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]",
  setup_incomplete: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
  unknown: "border-[#e2e8f0] bg-[#f1f5f9] text-[#475569]",
};
const DOT: Record<CardPill, string> = {
  online: "bg-[#059669]",
  off: "bg-[#94a3b8]",
  unreachable: "bg-[#dc2626]",
  setup_incomplete: "bg-[#f59e0b]",
  unknown: "bg-[#94a3b8]",
};

export function ConnectorsList({ page, extraPrice, basePrice, now, actionsFor, addSoon = false, ...cb }: ConnectorsListProps) {
  const t = useTranslations("ConnectorsList");
  const view = connectorsListView({ page, extraPrice, basePrice });
  const [deleting, setDeleting] = useState<ConnectorCardView | null>(null);

  if (view.kind === "empty") return <EmptyConnectorsCard add={view.add} offer={view.offer} onAdd={cb.onAdd} />;

  return (
    <section aria-label={t("listLabel")}>
      <ul className="grid list-none gap-4 p-0 sm:grid-cols-2" data-connectors-list>
        {view.cards.map((c) => {
          const actions = actionsFor?.(c) ?? LIVE;
          return (
            <li key={c.id} className="min-w-0">
              <ConnectorCard
                card={c}
                now={now}
                {...cb}
                actions={actions}
                onDelete={c.deletable && actions.mode === "live" ? () => setDeleting(c) : undefined}
              />
            </li>
          );
        })}
        <li className="min-w-0">
          <AddConnectorCard add={view.add} onAdd={cb.onAdd} soon={addSoon} />
        </li>
      </ul>
      {deleting && (
        <DeleteConnectorDialog
          name={deleting.name ?? t("defaultName")}
          number={deleting.number}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            cb.onDelete?.(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </section>
  );
}

const LIVE: CardActions = { mode: "live" };

export function ConnectorCard({
  card,
  now,
  onToggle,
  onTest,
  onEdit,
  onDelete,
  actions = LIVE,
}: {
  card: ConnectorCardView;
  now?: string | Date;
  actions?: CardActions;
  onToggle?: (id: string, enabled: boolean) => void;
  onTest?: (id: string) => void;
  onEdit?: (id: string) => void;
  /** Absent = no "Supprimer" (the derived card and the first connector). */
  onDelete?: () => void;
}) {
  const t = useTranslations("ConnectorsList");
  const format = useFormatter();
  const name = card.name ?? t("defaultName");
  const nameId = `connector-${card.id}-name`;
  const soon = actions.mode === "soon";
  const soonId = `connector-${card.id}-soon`;
  return (
    <article
      aria-labelledby={nameId}
      className={`${CARD} flex h-full flex-col gap-3`}
      data-connector={card.id}
      data-state={card.pill}
      data-derived={card.derived ? "true" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={nameId} className="min-w-0 break-words font-display text-lg text-[var(--color-foreground)]">
          {name}
        </h3>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${PILL[card.pill]}`}
          data-pill={card.pill}
        >
          <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[card.pill]}`} />
          {t(`pill.${card.pill}`)}
        </span>
      </div>

      {card.unreachableNote && (
        <p className="-mt-1 text-sm font-medium text-[#b91c1c]" data-unreachable-note>
          {t("unreachableNote")}
        </p>
      )}

      {card.setupLine && (
        <p
          className={`-mt-1 text-sm font-medium ${card.pill === "setup_incomplete" ? "text-[#92400e]" : "text-[#475569]"}`}
          data-setup-line={card.setupLine}
        >
          {t(`setupLine.${card.setupLine}`)}
        </p>
      )}

      {card.numberLine === "own" && card.number ? (
        <NumberLine e164={card.number} label={card.numberLabel} />
      ) : (
        <p className="text-sm font-medium text-[#334155]" data-number-line={card.numberLine}>
          {t(card.numberLine === "main" ? "mainNumber" : "noNumber")}
        </p>
      )}

      <p className="text-sm text-[#475569]">{t(`mode.${card.mode}`)}</p>
      <p className="text-xs text-[var(--color-muted-foreground)]">
        {card.lastCallAt
          ? t("lastCall", { when: format.relativeTime(new Date(card.lastCallAt), now ? new Date(now) : undefined) })
          : t("noCall")}
      </p>

      {/* ONE row that never wraps: every card's actions take the same height. */}
      <div className="mt-auto flex flex-nowrap items-center gap-2 border-t border-[#f1f5f9] pt-3" data-actions={actions.mode}>
        <Switch
          checked={card.enabled}
          label={t("switchLabel", { name })}
          disabled={soon || actions.busy === true}
          describedBy={soon ? soonId : undefined}
          onChange={(v) => onToggle?.(card.id, v)}
        />
        <button type="button" className={BUTTON} disabled={soon} aria-describedby={soon ? soonId : undefined} onClick={() => onTest?.(card.id)} data-test-action>
          {t("test")}
        </button>
        <button type="button" className={BUTTON} disabled={soon} aria-describedby={soon ? soonId : undefined} onClick={() => onEdit?.(card.id)} data-edit-action>
          {t("edit")}
        </button>
        {card.deletable && onDelete && !soon && <CardMenu label={t("moreActions", { name })} onDelete={onDelete} />}
      </div>
      {soon && (
        <p id={soonId} className="-mt-1 text-sm text-[#475569]" data-actions-soon>
          {t("actionsSoon")}
        </p>
      )}
      {actions.note && (
        <div role="status" aria-live="polite" className="-mt-1 text-sm" data-card-note>
          {actions.note}
        </div>
      )}
    </article>
  );
}

/**
 * The card's "…" menu button (WAI-ARIA menu button): one item, "Supprimer",
 * which opens the confirmation dialog. Rendered only on a deletable card.
 * Keys: lib/connectors/menu-keys.ts. A click outside closes it.
 */
export function CardMenu({ label, onDelete, defaultOpen = false }: { label: string; onDelete: () => void; defaultOpen?: boolean }) {
  const t = useTranslations("ConnectorsList");
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  return (
    <div ref={root} className="relative ms-auto shrink-0" data-card-menu>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={label}
        className={`inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-lg font-bold leading-none text-[#475569] hover:bg-[#f1f5f9] ${FOCUS}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          const a = menuKeyAction("button", open, e.key);
          if (a === "open") {
            e.preventDefault();
            setOpen(true);
          } else if (a === "close") {
            e.preventDefault();
            close(true);
          }
        }}
        data-card-menu-button
      >
        <span aria-hidden>…</span>
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          className="absolute bottom-full end-0 z-20 mb-1 min-w-40 rounded-xl border border-[#e2e8f0] bg-white p-1 shadow-lg"
          onKeyDown={(e) => {
            const a = menuKeyAction("menu", open, e.key);
            if (a === "close") {
              if (e.key === "Escape") e.preventDefault();
              close(e.key === "Escape");
            }
          }}
        >
          <button
            ref={item}
            type="button"
            role="menuitem"
            className={`${DANGER} w-full justify-start`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            data-delete
          >
            {t("delete")}
          </button>
        </div>
      )}
    </div>
  );
}

function NumberLine({ e164, label }: { e164: string; label: string | null }) {
  const t = useTranslations("ConnectorsList");
  const [copied, setCopied] = useState(false);
  const shown = formatPhone(e164);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span dir="ltr" className="select-all font-display text-2xl tabular-nums tracking-tight text-[#18181b] sm:text-3xl" data-number>
        {shown}
      </span>
      <button
        type="button"
        className={`inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-sm font-semibold text-[#0e7490] underline-offset-2 hover:underline ${FOCUS}`}
        onClick={() => {
          navigator.clipboard?.writeText(e164).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
      >
        <span aria-live="polite">{copied ? t("copied") : t("copyNumber")}</span>
      </button>
      {label && <span className="w-full text-xs text-[var(--color-muted-foreground)]">{label}</span>}
    </div>
  );
}

function Switch({
  checked,
  label,
  onChange,
  disabled = false,
  describedBy,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group me-1 inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-full px-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden
        className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 group-focus-visible:ring-2 group-focus-visible:ring-[#0e7490] group-focus-visible:ring-offset-2 ${
          checked ? "bg-gradient-to-r from-[#be185d] to-[#db2777]" : "bg-[#94a3b8]"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200 motion-reduce:transition-none ${
            checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

/** The line a locked add card (or the empty card) shows instead of its action. */
function LockLine({ add }: { add: Exclude<AddCardView, { kind: "add" }> }) {
  const t = useTranslations("ConnectorsList");
  if (add.kind === "soon") {
    return (
      <span className="inline-flex rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs font-semibold text-[#475569]" data-add-lock="soon">
        {t("add.soon")}
      </span>
    );
  }
  return (
    <p className="text-sm text-[#475569]" data-add-lock={add.kind}>
      {t(add.kind === "trial" ? "add.trial" : "add.max", { max: add.max })}
    </p>
  );
}

export function AddConnectorCard({ add, onAdd, soon = false }: { add: AddCardView; onAdd?: () => void; soon?: boolean }) {
  const t = useTranslations("ConnectorsList");
  const locale = useLocale();
  // Pre-C2: the open add card's words, but nothing to click (no hover, no handler).
  if (add.kind === "add" && soon) {
    return (
      <div
        aria-disabled="true"
        className="flex h-full min-h-40 w-full cursor-not-allowed flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] p-5 text-center"
        data-add-card="add"
        data-add-soon
      >
        <span className="font-display text-lg text-[#64748b]">{t("add.title")}</span>
        <span className="text-sm text-[#475569]" data-add-price>
          {add.price ? t("add.price", { price: formatConnectorPrice(add.price, locale) }) : t("add.noPrice")}
        </span>
        <span className="mt-1 text-sm font-semibold text-[#475569]" data-add-soon-line>
          {t("add.soonLine")}
        </span>
      </div>
    );
  }
  if (add.kind === "add") {
    return (
      <button
        type="button"
        onClick={onAdd}
        className={`flex h-full min-h-40 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[#f9a8d4] bg-[#fdf2f8]/40 p-5 text-center hover:border-[#be185d] hover:bg-[#fdf2f8] ${FOCUS}`}
        data-add-card="add"
      >
        <span className="font-display text-lg text-[#be185d]">{t("add.title")}</span>
        <span className="text-sm text-[#475569]" data-add-price>
          {add.price ? t("add.price", { price: formatConnectorPrice(add.price, locale) }) : t("add.noPrice")}
        </span>
      </button>
    );
  }
  return (
    <div
      aria-disabled="true"
      className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] p-5 text-center"
      data-add-card={add.kind}
    >
      <span className="font-display text-lg text-[#64748b]">{t("add.title")}</span>
      <LockLine add={add} />
    </div>
  );
}

export function EmptyConnectorsCard({ add, offer, onAdd }: { add: AddCardView; offer: EmptyOfferView; onAdd?: () => void }) {
  const t = useTranslations("ConnectorsList");
  const locale = useLocale();
  return (
    <section className={`${CARD} flex flex-col items-center gap-3 px-6 py-12 text-center sm:py-16`} data-connectors-empty>
      <h2 className="font-display text-2xl tracking-tight text-[var(--color-foreground)] sm:text-3xl">{t("empty.title")}</h2>
      <p className="max-w-md text-sm text-[#475569]">{t("empty.body")}</p>
      {offer && (
        <p className="text-sm font-semibold text-[#be185d]" data-empty-offer={offer.kind}>
          {offer.kind === "trial"
            ? t("empty.offerTrial")
            : t("empty.offer", { price: formatConnectorPrice(offer.price, locale), minutes: offer.price.minutes })}
        </p>
      )}
      {add.kind === "add" ? (
        <button type="button" className={`${PRIMARY} mt-2`} onClick={onAdd} data-empty-cta>
          {t("empty.cta")}
        </button>
      ) : (
        <LockLine add={add} />
      )}
    </section>
  );
}

/**
 * The number line of the delete dialog. Until BE step B5, deleting a
 * connector frees the number FROM THE CONNECTOR but the number stays on the
 * account: "reste sur votre compte". Only the server may say otherwise, with
 * `numberKept: false` (B5); nothing here ever guesses "libéré".
 */
export function deleteNumberLine(numberKept: boolean | undefined): "kept" | "released" {
  return numberKept === false ? "released" : "kept";
}

export function DeleteConnectorDialog({
  name,
  number,
  numberKept,
  onCancel,
  onConfirm,
}: {
  name: string;
  /** E.164, or null when the connector has no number (no number line). */
  number: string | null;
  /** The server's word on the number (B5). Absent or true = it stays on the account. */
  numberKept?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("ConnectorsList.deleteDialog");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f172a]/40 p-4 sm:items-center" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="connector-delete-title"
        aria-describedby="connector-delete-body"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        data-delete-dialog
      >
        <h2 id="connector-delete-title" className="font-display text-lg text-[#18181b]">
          {t("title", { name })}
        </h2>
        <div id="connector-delete-body" className="mt-2 space-y-2 text-sm text-[#334155]">
          {number && (
            <p data-delete-number={deleteNumberLine(numberKept)}>
              {/* LRI … PDI: the number stays left-to-right inside Hebrew text. */}
              {t(deleteNumberLine(numberKept), { number: `⁦${formatPhone(number)}⁩` })}
            </p>
          )}
          <p data-delete-billing>{t("billing")}</p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {/* Cancel first and focused: deleting is the deliberate choice. */}
          <button type="button" className={BUTTON} onClick={onCancel} autoFocus>
            {t("cancel")}
          </button>
          <button
            type="button"
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-[#b91c1c] px-4 text-sm font-semibold text-white hover:bg-[#991b1b] ${FOCUS}`}
            onClick={onConfirm}
            data-delete-confirm
          >
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
