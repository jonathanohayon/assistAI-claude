"use client";

// ADMIN-ONLY "Catalogue des produits": the "Moteur imposé" line per product
// (GET/PUT /api/admin/product-catalogue, engineOverrides + engineOptions).
// Resolution on every call: client > product (this screen) > account's choice.
// Costs: the rate card (GET /api/admin/cost-rates) through the server's own
// perMinuteUsdFor. Never imported by a tenant page.

import { useEffect, useState, useTransition } from "react";

import { perMinuteUsdFor, type CostRates } from "@/lib/finance/rates";
import type { ProductEntry, ProductNames } from "@/lib/product-values";

import { EngineChoiceRow } from "./EngineChoiceRow";
import {
  CATALOGUE_LINES,
  PRODUCT_LANGUAGES,
  cataloguePutBody,
  catalogueFieldErrors,
  engineChoiceLabel,
  languageWarning,
  missingLanguages,
  putJson,
  type CatalogueEngineData,
  type EngineOverride,
} from "./engine-ui";

type Rates = Pick<CostRates, "perMinuteUsd" | "openaiUsdPerMinute">;

const initialChoices = (d: CatalogueEngineData): Record<ProductEntry, EngineOverride | null> => ({
  reception: d.engineOverrides.reception ?? null,
  sales: d.engineOverrides.sales ?? null,
  connect: d.engineOverrides.connect ?? null,
});

export function ProductCatalogueForm({
  initial,
  names,
  rates,
  fetchFn,
}: {
  initial: CatalogueEngineData;
  /** The products' names (DashboardNav.<entry>, French: lib/product-names.ts). */
  names: ProductNames;
  /** null = the rate card didn't load: every cost shows "—". */
  rates: Rates | null;
  fetchFn?: typeof fetch;
}) {
  const [data, setData] = useState(initial);
  const [choices, setChoices] = useState(() => initialChoices(initial));
  const [errors, setErrors] = useState<ReturnType<typeof catalogueFieldErrors>>({ byEntry: {}, other: [] });
  const [message, setMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const body = cataloguePutBody(data.engineOverrides, choices);
  const dirty = Object.keys(body.catalogue).length > 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const r = await putJson(fetchFn ?? fetch, "/api/admin/product-catalogue", body);
      if (!r.ok) {
        if (r.kind === "fields") setErrors(catalogueFieldErrors(r.fields));
        else setMessage(r.kind === "not_found" ? "Catalogue introuvable." : r.message);
        return;
      }
      const j = r.json as { engineOverrides?: CatalogueEngineData["engineOverrides"] } | null;
      if (j?.engineOverrides) {
        const next = { ...data, engineOverrides: j.engineOverrides };
        setData(next);
        setChoices(initialChoices(next));
      }
      setErrors({ byEntry: {}, other: [] });
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">Catalogue des produits</p>
        <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">Moteur imposé par produit</h3>
        <p className="mb-2 mt-2 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          À chaque appel : le moteur imposé pour le client (bandeau du tenant) passe en premier, puis celui du produit (ici), sinon le
          choix du compte. « Aucun » laisse le choix du compte. Les coûts viennent de la grille Finance.
        </p>
        <div className="divide-y divide-[var(--color-border)]">
          {CATALOGUE_LINES.map((line) => {
            const p = line.products[0]!;
            const options = data.engineOptions[p]?.options ?? [];
            const choice = choices[line.entry];
            const multi = line.entry === "reception" ? data.engineOverrides.reception_multi : undefined;
            const differs =
              multi !== undefined &&
              JSON.stringify(multi ?? null) !== JSON.stringify(data.engineOverrides.reception ?? null);
            return (
              <EngineChoiceRow
                key={line.entry}
                label={names[line.entry]}
                options={options}
                choice={choice}
                onChange={(c) => setChoices((s) => ({ ...s, [line.entry]: c }))}
                costPerMinUsd={choice && rates ? perMinuteUsdFor(rates, choice.engine, choice.model) : null}
                warning={languageWarning(missingLanguages(options, choice, PRODUCT_LANGUAGES), "product")}
                errors={errors.byEntry[line.entry]}
                note={
                  differs
                    ? `Réception multi-sites a aujourd'hui un autre moteur imposé (${multi ? engineChoiceLabel(multi.engine, multi.model) : "aucun"}) : l'enregistrement aligne les deux.`
                    : null
                }
              />
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[var(--color-muted-foreground)]" aria-live="polite">
            {message ? (
              <span className="text-red-600">{message}</span>
            ) : errors.other.length ? (
              <span className="text-red-600">Refusé par le serveur : {errors.other.join(", ")}</span>
            ) : savedAt && !dirty ? (
              <span className="text-emerald-700">Enregistré à {savedAt}</span>
            ) : dirty ? (
              "Modifications non enregistrées"
            ) : (
              "À jour"
            )}
          </p>
          <button
            type="submit"
            disabled={isPending || !dirty}
            className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Enregistrement…" : "Enregistrer les moteurs imposés"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** The admin tile: loads the catalogue and the rate card, then the form. */
export function ProductCatalogueAdmin({ names }: { names: ProductNames }) {
  const [state, setState] = useState<{ data: CatalogueEngineData; rates: Rates | null } | "error" | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/admin/product-catalogue", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      fetch("/api/admin/cost-rates", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([cat, rates]) => {
        if (live) setState({ data: cat as CatalogueEngineData, rates: (rates as { rates?: Rates } | null)?.rates ?? null });
      })
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, []);
  if (state === null) return <p className="text-sm text-[var(--color-muted-foreground)]">Chargement…</p>;
  if (state === "error") return <p className="text-sm text-red-600">Le catalogue n&apos;a pas pu être chargé.</p>;
  return <ProductCatalogueForm initial={state.data} names={names} rates={state.rates} />;
}
