"use client";

/**
 * Section "Soins & tarifs" de la tuile Business : recherche + filtre par
 * centre, table desktop / cards mobile, actions ligne (éditer/dupliquer/
 * supprimer) et ouverture du modal d'édition (service-edit-modal.tsx).
 * Contient aussi CentreBadges (badges des centres d'un soin, exporté pour
 * le modal) et ServiceRowAction (bouton d'action icône).
 *
 * Utilisé par : business-panel.tsx.
 */

import { useMemo, useState } from "react";

import { formatDuration, formatPriceILS, newId } from "./formatting";
import { ServiceEditModal } from "./service-edit-modal";
import { EmptyState } from "./shared-ui";
import type { BusinessCentre, BusinessService, Translator } from "./types";

export function ServicesSection({
  services,
  centres,
  onChange,
  t,
}: {
  services: BusinessService[];
  centres: BusinessCentre[];
  onChange: (services: BusinessService[]) => void;
  t: Translator;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterCentre, setFilterCentre] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (filterCentre !== "all") {
        if (s.centreIds === "all") return true;
        if (!s.centreIds.includes(filterCentre)) return false;
      }
      return true;
    });
  }, [services, search, filterCentre]);

  const centreNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of centres) m[c.id] = c.name || t("businessServicesCentreNoName");
    return m;
  }, [centres, t]);

  const addService = () => {
    const id = newId("svc");
    const next: BusinessService = {
      id,
      name: "",
      durationMinutes: 60,
      priceILS: 200,
      centreIds: "all",
      description: "",
    };
    onChange([...services, next]);
    setEditingId(id);
  };

  const patchService = (id: string, partial: Partial<BusinessService>) =>
    onChange(services.map((s) => (s.id === id ? { ...s, ...partial } : s)));

  const removeService = (id: string) => {
    onChange(services.filter((s) => s.id !== id));
    setEditingId((curr) => (curr === id ? null : curr));
  };

  const duplicateService = (id: string) => {
    const src = services.find((s) => s.id === id);
    if (!src) return;
    const copy: BusinessService = {
      ...src,
      id: newId("svc"),
      name: `${src.name} ${t("businessActionDuplicateSuffix")}`.trim(),
    };
    const idx = services.findIndex((s) => s.id === id);
    const next = [...services];
    next.splice(idx + 1, 0, copy);
    onChange(next);
  };

  const editing = services.find((s) => s.id === editingId) ?? null;

  return (
    <section
      className="anim-fade-up rounded-2xl border border-[#e2e8f0] bg-white/70 shadow-sm"
      style={{ animationDelay: "180ms" }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[#e2e8f0] px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] text-white shadow-md">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
            <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-extrabold tracking-tight text-[#18181b]">
            {t("businessServicesTitle")}
          </h3>
          <p className="text-[11px] text-[#475569]">
            {services.length === 0
              ? t("businessServicesEmptyLabel")
              : t("businessServicesCountActive", { count: services.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={addService}
          className="group inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#b45309] px-4 py-2 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-95"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 transition-transform group-hover:rotate-90">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-3 w-3">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          {t("businessServicesAdd")}
        </button>
      </header>

      {services.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-5 py-3">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("businessServicesSearchPlaceholder")}
              aria-label={t("businessServicesSearchAria")}
              className="w-full min-h-[40px] rounded-xl border border-[#e2e8f0] bg-white pl-9 pr-3 py-2 text-sm text-[#18181b] shadow-xs transition-colors placeholder:text-[#cbd5e1] focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
            />
          </div>
          <select
            value={filterCentre}
            onChange={(e) => setFilterCentre(e.target.value)}
            aria-label={t("businessServicesFilterAria")}
            className="min-h-[40px] rounded-xl border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#18181b] shadow-xs transition-colors focus:border-[#f59e0b] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/15"
          >
            <option value="all">{t("businessServicesFilterAll")}</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || t("businessServicesCentreNoName")}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="px-5 py-5">
        {services.length === 0 ? (
          <EmptyState
            icon={
              <>
                <path d="M12 3l1.9 5.8L20 10l-5 4.8 1.5 6.2L12 17.8 7.5 21 9 14.8 4 10l6.1-1.2z" />
              </>
            }
            title={t("businessServicesEmptyLabel")}
            body={t("businessServicesEmptyBody")}
            cta={{ label: t("businessServicesEmptyCta"), onClick: addService }}
          />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-base font-semibold text-[#475569]">
              {t("businessServicesNoMatchTitle")}
            </p>
            <p className="mt-1 text-[12px] text-[#94a3b8]">
              {t("businessServicesNoMatchHint")}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-2xl border border-[#e2e8f0] sm:block">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-[#fffbeb] text-left text-[10px] font-bold uppercase tracking-wider text-[#92400e]">
                  <tr>
                    <th className="px-4 py-3">{t("businessServicesColName")}</th>
                    <th className="px-4 py-3">{t("businessServicesColDuration")}</th>
                    <th className="px-4 py-3">{t("businessServicesColPrice")}</th>
                    <th className="px-4 py-3">{t("businessServicesColCentres")}</th>
                    <th className="px-4 py-3 text-right">{t("businessServicesColActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr
                      key={s.id}
                      className="anim-fade-up border-t border-[#f1f5f9] bg-white transition-colors hover:bg-[#fff7ed]/50"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setEditingId(s.id)}
                          className="block max-w-full text-left text-sm font-semibold text-[#18181b] hover:text-[#b45309] focus:outline-none focus-visible:underline"
                        >
                          {s.name || (
                            <span className="italic text-[#94a3b8]">{t("businessServicesNoName")}</span>
                          )}
                        </button>
                        {s.description && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-[#94a3b8]">
                            {s.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] text-[#475569]">
                        {formatDuration(s.durationMinutes)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12px] font-semibold text-[#b45309]">
                        {formatPriceILS(s.priceILS)}
                      </td>
                      <td className="px-4 py-3">
                        <CentreBadges
                          centreIds={s.centreIds}
                          centreNameById={centreNameById}
                          t={t}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <ServiceRowAction
                            label={t("businessActionEdit")}
                            onClick={() => setEditingId(s.id)}
                            icon={
                              <>
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </>
                            }
                          />
                          <ServiceRowAction
                            label={t("businessActionDuplicate")}
                            onClick={() => duplicateService(s.id)}
                            icon={
                              <>
                                <rect x="9" y="9" width="13" height="13" rx="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </>
                            }
                          />
                          <ServiceRowAction
                            label={t("businessActionDelete")}
                            danger
                            onClick={() => removeService(s.id)}
                            icon={
                              <>
                                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              </>
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="flex flex-col gap-3 sm:hidden">
              {filtered.map((s, i) => (
                <div
                  key={s.id}
                  className="anim-fade-up rounded-2xl border border-[#e2e8f0] bg-white p-4 shadow-sm"
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => setEditingId(s.id)}
                    className="block w-full text-left"
                  >
                    <p className="text-sm font-semibold text-[#18181b]">
                      {s.name || (
                        <span className="italic text-[#94a3b8]">{t("businessServicesNoName")}</span>
                      )}
                    </p>
                    {s.description && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-[#94a3b8]">
                        {s.description}
                      </p>
                    )}
                  </button>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfeff] px-2 py-0.5 font-mono font-semibold text-[#0e7490]">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {formatDuration(s.durationMinutes)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fffbeb] px-2 py-0.5 font-mono font-semibold text-[#b45309]">
                      {formatPriceILS(s.priceILS)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <CentreBadges
                      centreIds={s.centreIds}
                      centreNameById={centreNameById}
                      t={t}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <ServiceRowAction
                      label={t("businessActionEdit")}
                      block
                      onClick={() => setEditingId(s.id)}
                      icon={
                        <>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </>
                      }
                    />
                    <ServiceRowAction
                      label={t("businessActionDuplicate")}
                      onClick={() => duplicateService(s.id)}
                      icon={
                        <>
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </>
                      }
                    />
                    <ServiceRowAction
                      label={t("businessActionDelete")}
                      danger
                      onClick={() => removeService(s.id)}
                      icon={
                        <>
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </>
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {editing && (
        <ServiceEditModal
          service={editing}
          centres={centres}
          onPatch={(partial) => patchService(editing.id, partial)}
          onDelete={() => removeService(editing.id)}
          onClose={() => setEditingId(null)}
          t={t}
        />
      )}
    </section>
  );
}

function CentreBadges({
  centreIds,
  centreNameById,
  t,
}: {
  centreIds: BusinessService["centreIds"];
  centreNameById: Record<string, string>;
  t: Translator;
}) {
  if (centreIds === "all") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-[#10b981]/15 to-[#059669]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#047857] ring-1 ring-inset ring-[#10b981]/30">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-2.5 w-2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {t("businessCentreBadgesAll")}
      </span>
    );
  }
  if (centreIds.length === 0) {
    return (
      <span className="text-[10px] italic text-[#94a3b8]">{t("businessCentreBadgesNone")}</span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {centreIds.slice(0, 3).map((id) => (
        <span
          key={id}
          className="inline-flex items-center rounded-full bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold text-[#92400e] ring-1 ring-inset ring-[#fde68a]"
        >
          {centreNameById[id] ?? t("businessCentreBadgesUnknown")}
        </span>
      ))}
      {centreIds.length > 3 && (
        <span className="inline-flex items-center rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-semibold text-[#475569]">
          +{centreIds.length - 3}
        </span>
      )}
    </div>
  );
}

function ServiceRowAction({
  label,
  onClick,
  icon,
  danger = false,
  block = false,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 ${block ? "flex-1 px-3 text-xs font-semibold" : "w-9 justify-center"} items-center gap-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
        danger
          ? "border-red-200 bg-white text-red-600 hover:bg-red-50 focus-visible:ring-red-400"
          : "border-[#e2e8f0] bg-white text-[#475569] hover:border-[#0e7490] hover:bg-[#ecfeff] hover:text-[#0e7490] focus-visible:ring-[#0e7490]"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        {icon}
      </svg>
      {block && <span>{label}</span>}
    </button>
  );
}
