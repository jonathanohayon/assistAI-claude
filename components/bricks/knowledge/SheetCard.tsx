"use client";

/**
 * Knowledge brick, level 1 parts:
 *   - LearnFromSite: the full block (empty sheet) or one line ("Learned from
 *     … on … · Learn again") once the sheet has facts;
 *   - LearnReview: what a learn would change, in plain rows, Apply / Cancel;
 *   - SheetCard: the company sheet as a summary someone checks in ten
 *     seconds — one plain row per fact, tap a row to edit it in place.
 */

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { CentreEditDrawer } from "@/app/[locale]/dashboard/config/centres-section";
import { newId, structuredCloneCompat } from "@/app/[locale]/dashboard/config/formatting";
import { ServiceEditModal } from "@/app/[locale]/dashboard/config/service-edit-modal";
import { DEFAULT_WEEKLY_HOURS } from "@/app/[locale]/dashboard/config/types";
import { FOCUS, HINT, LABEL } from "@/components/bricks/controls";
import type { CompanySheet, SheetLocation, SheetService } from "@/lib/knowledge/contract";

import { hoursSummary, learnedDate, scanCounts, widened, type ScanChange } from "./knowledge-ui";

export const INPUT =
  "w-full rounded-xl border border-[#e2e8f0] bg-white px-3 text-sm text-[#18181b] placeholder:text-[#64748b] focus:border-[#0e7490] focus:outline-none focus:ring-2 focus:ring-[#0e7490]/20";
export const BUTTON = `inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-gradient-to-br from-[#be185d] to-[#db2777] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;
export const GHOST = `inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm font-semibold text-[#18181b] hover:border-[#be185d]/40 ${FOCUS}`;
const LINK = `inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-[#0e7490] underline-offset-2 hover:underline ${FOCUS} rounded-lg`;
const MUTED = "text-[#64748b]";

/** Lists past this many show the first five and "See all N". */
const LONG_LIST = 8;
const SHORT_LIST = 5;

const host = (url: string) =>
  url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "");

// ── Learn ────────────────────────────────────────────────────────────────

export function LearnFromSite({
  compact,
  lastSource,
  onLearn,
  onManual,
}: {
  /** The sheet has facts: one line instead of the block. */
  compact: boolean;
  lastSource: CompanySheet["sources"][number] | null;
  onLearn: (url: string) => void;
  /** Empty sheet only: "Fill in by hand". */
  onManual?: () => void;
}) {
  const t = useTranslations("KnowledgeBrick");
  const locale = useLocale();
  const [open, setOpen] = useState(!compact);
  const [url, setUrl] = useState("");
  const id = useId();
  const submit = () => {
    if (url.trim()) onLearn(url.trim());
  };

  if (compact && !open) {
    const date = lastSource ? learnedDate(lastSource.learnedAt, locale) : "";
    return (
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-[#475569]">
        {lastSource ? (
          <>
            <span>
              {date
                ? t.rich("learnedFrom", { site: host(lastSource.url), date, b: (c) => <bdi dir="ltr">{c}</bdi> })
                : t.rich("learnedFromNoDate", { site: host(lastSource.url), b: (c) => <bdi dir="ltr">{c}</bdi> })}
            </span>
            <span aria-hidden>·</span>
            <button type="button" onClick={() => onLearn(lastSource.url)} className={LINK}>
              {t("sourcesLearnAgain")}
            </button>
            <span aria-hidden>·</span>
            <button type="button" onClick={() => setOpen(true)} className={LINK}>
              {t("learnOther")}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className={LINK}>
            {t("learnTitle")}
          </button>
        )}
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-4">
      <label htmlFor={id} className={LABEL}>
        {t("learnTitle")}
      </label>
      <p className={HINT}>{t("learnHint")}</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          type="url"
          inputMode="url"
          autoComplete="url"
          dir="ltr"
          value={url}
          placeholder={t("learnPlaceholder")}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          className={`min-h-11 ${INPUT}`}
        />
        <button type="button" onClick={submit} disabled={!url.trim()} className={BUTTON}>
          {t("learnCta")}
        </button>
      </div>
      {onManual && (
        <button type="button" onClick={onManual} className={`mt-1 ${LINK}`}>
          {t("fillByHand")}
        </button>
      )}
    </div>
  );
}

export function LearnReview({
  url,
  changes,
  onApply,
  onCancel,
}: {
  url: string;
  changes: ScanChange[];
  /** The ids of the lines the customer unticked. */
  onApply: (skip: ReadonlySet<string>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("KnowledgeBrick");
  // Every line ticked by default; unticked = not applied.
  const [skip, setSkip] = useState<ReadonlySet<string>>(() => new Set());
  const kept = changes.length - skip.size;
  const toggle = (id: string) =>
    setSkip((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const n = scanCounts(changes);
  const parts = [
    n.servicesAdded && t("countServicesAdded", { n: n.servicesAdded }),
    n.servicesChanged && t("countServicesChanged", { n: n.servicesChanged }),
    n.locationsAdded && t("countLocationsAdded", { n: n.locationsAdded }),
    n.locationsChanged && t("countLocationsChanged", { n: n.locationsChanged }),
    n.identityChanged && t("countIdentityChanged", { n: n.identityChanged }),
    n.notesAdded && t("countNotesAdded"),
  ].filter(Boolean);
  return (
    <section aria-labelledby="kb-review-title" className="rounded-2xl border border-[#0e7490]/30 bg-[#ecfeff]/40 p-4">
      <h3 id="kb-review-title" className={LABEL}>
        {t.rich("reviewTitle", { site: host(url), b: (c) => <bdi dir="ltr">{c}</bdi> })}
      </h3>
      <p className="mt-0.5 text-sm text-[#18181b]">{changes.length ? parts.join(", ") : t("reviewNothing")}</p>
      {changes.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-[#e2e8f0] rounded-xl border border-[#e2e8f0] bg-white">
          {changes.map((c) => {
            const on = !skip.has(c.id);
            const boxId = `kb-review-${c.id}`;
            return (
              <li key={c.id} className={`flex items-start gap-3 px-3 py-2 text-sm ${on ? "text-[#18181b]" : "text-[#64748b]"}`}>
                {/* A real checkbox with a 44 px hit area; the label is the whole line. */}
                <span className="-m-2.5 flex h-11 w-11 shrink-0 items-center justify-center">
                  <input
                    id={boxId}
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(c.id)}
                    className={`h-5 w-5 cursor-pointer accent-[#be185d] ${FOCUS}`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor={boxId} className={`block cursor-pointer ${on ? "" : "line-through decoration-[#94a3b8]"}`}>
                    <ChangeRow c={c} />
                  </label>
                  {/* Its only new location is unticked: say where it would be offered. */}
                  {widened(c, skip) && (
                    <p className="mt-0.5 text-xs text-[#475569]" aria-live="polite">
                      {t("widenedNote")}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {changes.length > 0 && (
          <button type="button" onClick={() => onApply(skip)} disabled={kept === 0} className={BUTTON}>
            {kept === changes.length ? t("reviewApply") : t("reviewApplySome", { n: kept, total: changes.length })}
          </button>
        )}
        <button type="button" onClick={onCancel} className={GHOST}>
          {changes.length ? t("reviewCancel") : t("reviewClose")}
        </button>
      </div>
    </section>
  );
}

function ChangeRow({ c }: { c: ScanChange }) {
  const t = useTranslations("KnowledgeBrick");
  const locale = useLocale();
  switch (c.kind) {
    case "identity":
      return <ValueChange label={t(`identityField.${c.field}`)} before={c.before} after={c.after} />;
    case "locationAdded":
      return (
        <>
          <p className="text-xs font-semibold text-[#475569]">{t("addedLocation")}</p>
          <Line first={c.name} rest={locationFacts(c, locale, t("closed"))} />
        </>
      );
    case "locationChanged":
      return (
        <>
          <Line first={c.name} rest={[]} />
          {c.address && <ValueChange label={t("fieldAddress")} before={c.address.before} after={c.address.after} />}
          {c.hours && (
            <div className="mt-1 text-sm">
              <p className="text-xs font-semibold text-[#475569]">{t("fieldHours")}</p>
              <p className="text-[#64748b]">
                <span className="sr-only">{t("before")} </span>
                <bdi dir="auto">{hoursSummary(c.hours.before, locale, t("closed"))}</bdi>
              </p>
              <p className="text-[#18181b]">
                <span className="sr-only">{t("after")} </span>
                <bdi dir="auto">{hoursSummary(c.hours.after, locale, t("closed"))}</bdi>
              </p>
            </div>
          )}
        </>
      );
    case "serviceAdded":
      return (
        <>
          <p className="text-xs font-semibold text-[#475569]">{t("addedService")}</p>
          <Line first={c.name} rest={serviceFacts(c, t)} />
        </>
      );
    case "serviceChanged":
      return (
        <>
          <Line first={c.name} rest={[]} />
          {c.price && <ValueChange label={t("fieldPrice")} before={c.price.before ? t("price", { n: c.price.before }) : ""} after={t("price", { n: c.price.after })} />}
          {c.duration && (
            <ValueChange
              label={t("fieldDuration")}
              before={c.duration.before ? t("minutes", { n: c.duration.before }) : ""}
              after={t("minutes", { n: c.duration.after })}
            />
          )}
          {c.description && <ValueChange label={t("fieldDescription")} before={c.description.before} after={c.description.after} />}
        </>
      );
    case "notesAdded":
      return <>{t("changeNotesAdded")}</>;
  }
}

/** "Label : before → after"; an empty before reads "(empty)"; the arrow follows the page direction. */
function ValueChange({ label, before, after }: { label: string; before: string; after: string }) {
  const t = useTranslations("KnowledgeBrick");
  return (
    <p className="mt-0.5 text-sm text-[#18181b]">
      {/* French puts a space before the colon, English and Hebrew don't. */}
      <span className="text-[#475569]">{t("fieldLabel", { label })} </span>
      <span className="sr-only">{t("before")} </span>
      <bdi dir="auto" className="text-[#64748b]">
        {before.trim() ? before : t("emptyValue")}
      </bdi>
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-1 inline h-3.5 w-3.5 align-[-2px] text-[#94a3b8] rtl:rotate-180">
        <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">{t("after")} </span>
      <bdi dir="auto" className="font-semibold">
        {after}
      </bdi>
    </p>
  );
}

/** A location's facts, in the sheet's row format. */
function locationFacts(l: Pick<SheetLocation, "address" | "hours">, locale: string, closed: string): string[] {
  const open = Object.values(l.hours).some((h) => h.open);
  return [l.address.trim(), open ? hoursSummary(l.hours, locale, closed) : ""].filter(Boolean);
}

/** A service's facts, in the sheet's row format. */
function serviceFacts(s: { durationMinutes: number; priceILS: number }, t: ReturnType<typeof useTranslations>): string[] {
  return [s.durationMinutes > 0 ? t("minutes", { n: s.durationMinutes }) : "", s.priceILS > 0 ? t("price", { n: s.priceILS }) : ""].filter(Boolean);
}

// ── The sheet, as plain rows ─────────────────────────────────────────────

type Editing = { kind: "identity" } | { kind: "location"; id: string; fresh: boolean } | { kind: "service"; id: string; fresh: boolean } | null;

export function SheetCard({
  sheet,
  onChange,
  note,
}: {
  sheet: CompanySheet;
  onChange: (next: CompanySheet) => void;
  /** Outbound while the agent doesn't read the sheet yet. */
  note?: string;
}) {
  const t = useTranslations("KnowledgeBrick");
  const tc = useTranslations("DashboardConfig");
  const locale = useLocale();
  const [editing, setEditing] = useState<Editing>(null);
  const [allServices, setAllServices] = useState(false);

  const services = sheet.services;
  const shown = services.length > LONG_LIST && !allServices ? services.slice(0, SHORT_LIST) : services;
  const locById = (id: string) => sheet.locations.find((l) => l.id === id);

  const patchLocation = (id: string, p: Partial<SheetLocation>) =>
    onChange({ ...sheet, locations: sheet.locations.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const removeLocation = (id: string) =>
    onChange({
      ...sheet,
      locations: sheet.locations.filter((l) => l.id !== id),
      // A service offered only there would point at a location that's gone.
      services: sheet.services.map((s) =>
        s.locationIds === "all" ? s : { ...s, locationIds: s.locationIds.filter((x) => x !== id) },
      ),
    });
  const patchService = (id: string, p: Partial<SheetService>) =>
    onChange({ ...sheet, services: sheet.services.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const removeService = (id: string) => onChange({ ...sheet, services: sheet.services.filter((s) => s.id !== id) });

  /** Closing an editor on an item still without a name drops it (it can't be saved). */
  const close = () => {
    if (editing?.kind === "location" && !locById(editing.id)?.name.trim()) removeLocation(editing.id);
    if (editing?.kind === "service" && !sheet.services.find((s) => s.id === editing.id)?.name.trim()) removeService(editing.id);
    setEditing(null);
  };

  const addLocation = () => {
    const id = newId("ctr");
    onChange({ ...sheet, locations: [...sheet.locations, { id, name: "", address: "", hours: structuredCloneCompat(DEFAULT_WEEKLY_HOURS) }] });
    setEditing({ kind: "location", id, fresh: true });
  };
  const addService = () => {
    const id = newId("svc");
    onChange({
      ...sheet,
      services: [...sheet.services, { id, name: "", durationMinutes: 60, priceILS: 0, locationIds: "all", description: "" }],
    });
    setEditing({ kind: "service", id, fresh: true });
    setAllServices(true);
  };

  const identityLine = [sheet.identity.name, sheet.identity.tagline, sheet.identity.email].filter((x) => x.trim());
  const editingLocation = editing?.kind === "location" ? locById(editing.id) : undefined;
  const editingService = editing?.kind === "service" ? sheet.services.find((s) => s.id === editing.id) : undefined;

  return (
    <section aria-labelledby="kb-sheet-title" className="rounded-2xl border border-[#e2e8f0] bg-white">
      <div className="px-4 pt-4">
        <h3 id="kb-sheet-title" className={LABEL}>
          {t("sheetTitle")}
        </h3>
        <p className={HINT}>{t("sheetShared")}</p>
        {note && (
          <p role="note" className="mt-2 rounded-xl bg-[#f1f5f9] px-3 py-2 text-xs text-[#334155]">
            {note}
          </p>
        )}
      </div>

      {/* Identity */}
      <Group title={t("groupCompany")}>
        {editing?.kind === "identity" ? (
          <IdentityForm sheet={sheet} onChange={onChange} onDone={() => setEditing(null)} />
        ) : (
          <Row onClick={() => setEditing({ kind: "identity" })} label={t("editCompany")}>
            {identityLine.length ? (
              <Line first={identityLine[0]} rest={identityLine.slice(1)} />
            ) : (
              <span className={MUTED}>{t("companyMissing")}</span>
            )}
          </Row>
        )}
      </Group>

      {/* Locations */}
      <Group title={t("groupLocations")} action={<AddButton onClick={addLocation} label={t("addLocation")} />}>
        {sheet.locations.length === 0 && <p className={`px-4 py-2 text-sm ${MUTED}`}>{t("locationsEmpty")}</p>}
        {sheet.locations.map((l) => {
          const open = Object.values(l.hours).some((h) => h.open);
          const facts = locationFacts(l, locale, t("closed"));
          return (
            <Row key={l.id} onClick={() => setEditing({ kind: "location", id: l.id, fresh: false })} label={t("editItem", { name: l.name })}>
              <Line first={l.name || t("unnamed")} rest={facts} />
              {!open && <span className={`block text-xs ${MUTED}`}>{t("hoursMissing")}</span>}
            </Row>
          );
        })}
      </Group>

      {/* Services */}
      <Group title={t("groupServices")} action={<AddButton onClick={addService} label={t("addService")} />}>
        {services.length === 0 && <p className={`px-4 py-2 text-sm ${MUTED}`}>{t("servicesEmpty")}</p>}
        {shown.map((s) => {
          const where =
            s.locationIds === "all" || sheet.locations.length < 2
              ? ""
              : s.locationIds.map((id) => locById(id)?.name).filter(Boolean).join(", ");
          const facts = [...serviceFacts(s, t), where].filter(Boolean);
          return (
            <Row key={s.id} onClick={() => setEditing({ kind: "service", id: s.id, fresh: false })} label={t("editItem", { name: s.name })}>
              <Line first={s.name || t("unnamed")} rest={facts} />
              {s.priceILS <= 0 && <span className={`block text-xs ${MUTED}`}>{t("priceMissing")}</span>}
            </Row>
          );
        })}
        {shown.length < services.length && (
          <div className="px-4 pb-2">
            <button type="button" onClick={() => setAllServices(true)} className={LINK}>
              {t("seeAllServices", { n: services.length })}
            </button>
          </div>
        )}
      </Group>

      {editingLocation && (
        <CentreEditDrawer
          centre={editingLocation}
          onPatch={(p) => patchLocation(editingLocation.id, p)}
          onDelete={() => {
            removeLocation(editingLocation.id);
            setEditing(null);
          }}
          onClose={close}
          t={tc}
        />
      )}
      {editingService && (
        <ServiceEditModal
          service={{ ...editingService, centreIds: editingService.locationIds }}
          centres={sheet.locations}
          onPatch={(p) => {
            const { centreIds, ...rest } = p;
            patchService(editingService.id, centreIds !== undefined ? { ...rest, locationIds: centreIds } : rest);
          }}
          onDelete={() => {
            removeService(editingService.id);
            setEditing(null);
          }}
          onClose={close}
          t={tc}
        />
      )}
    </section>
  );
}

function Group({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-[#f1f5f9] pb-1">
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <h4 className="text-xs font-semibold text-[#475569]">{title}</h4>
        {action}
      </div>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

function Row({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`flex min-h-11 w-full cursor-pointer items-center gap-2 px-4 py-2 text-start hover:bg-[#f8fafc] ${FOCUS}`}
      >
        <span className="min-w-0 flex-1">{children}</span>
        <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-[#94a3b8] rtl:rotate-180">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </li>
  );
}

/**
 * Name on the first line, the facts on the second; each line is cut with an
 * ellipsis at its logical end (page direction), never wrapped. Each fact is
 * its own isolate (a Latin name or address on a Hebrew page, or the reverse,
 * keeps its own direction) while the facts follow the page's order.
 */
function Line({ first, rest }: { first: string; rest: string[] }) {
  return (
    <span className="block min-w-0 text-sm">
      <span className="block truncate font-semibold text-[#18181b]">
        <bdi dir="auto">{first}</bdi>
      </span>
      {rest.length > 0 && (
        <span className="block truncate text-[#475569]" title={rest.join(" · ")}>
          {rest.map((part, i) => (
            <span key={i}>
              {i > 0 && <span className="text-[#94a3b8]"> · </span>}
              <bdi dir="auto">{part}</bdi>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} className={LINK}>
      + {label}
    </button>
  );
}

function IdentityForm({ sheet, onChange, onDone }: { sheet: CompanySheet; onChange: (s: CompanySheet) => void; onDone: () => void }) {
  const t = useTranslations("KnowledgeBrick");
  const set = (f: keyof CompanySheet["identity"], v: string) => onChange({ ...sheet, identity: { ...sheet.identity, [f]: v } });
  return (
    <li className="flex flex-col gap-2 px-4 py-2">
      {(["name", "tagline", "email"] as const).map((f) => (
        <label key={f} className="text-xs font-semibold text-[#18181b]">
          {t(`identityField.${f}`)}
          <input
            dir={f === "email" ? "ltr" : "auto"}
            type={f === "email" ? "email" : "text"}
            autoComplete={f === "email" ? "email" : f === "name" ? "organization" : "off"}
            value={sheet.identity[f]}
            maxLength={f === "name" ? 120 : f === "tagline" ? 200 : 160}
            onChange={(e) => set(f, e.target.value)}
            className={`mt-1 min-h-11 ${INPUT}`}
          />
        </label>
      ))}
      <button type="button" onClick={onDone} className={`self-start ${GHOST}`}>
        {t("done")}
      </button>
    </li>
  );
}
