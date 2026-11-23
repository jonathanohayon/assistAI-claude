"use client";

// ADMIN-ONLY "Catalogue des produits" → "Prix et minutes": per product and
// currency, the monthly price, the add-on price, the included minutes and the
// overage per minute (annual = 10 × monthly, derived, read-only). Logic in
// ./catalogue-prices-ui.ts (save = touched fields only, after a re-read that
// refuses on any concurrent change). Never imported by a tenant page.

import { useEffect, useState, useTransition } from "react";

import { CATALOGUE_CURRENCIES, type CatalogueCurrency, type ProductCatalogue } from "@/lib/product-catalogue";
import { PRODUCTS, type Product, type ProductNames } from "@/lib/product-values";

import {
  CONFIRM_LINE,
  CONFLICT_LINE,
  FIELD_LABEL,
  NOT_SOLD_AS_ADDON,
  annualOf,
  deriveAnnual,
  diffSummary,
  productLabels,
  draftErrors,
  fetchCatalogue,
  fieldKey,
  formatAmount,
  isEditable,
  parseFieldInput,
  patchIsEmpty,
  pricesPatch,
  savePrices,
  type Drafts,
  type EditableField,
  type FieldKey,
} from "./catalogue-prices-ui";

const CURRENCY_SIGN: Record<CatalogueCurrency, string> = { EUR: "€", ILS: "₪" };

function FieldCell({
  product,
  productLabel,
  currency,
  field,
  loaded,
  drafts,
  error,
  onChange,
}: {
  product: Product;
  productLabel: string;
  currency: CatalogueCurrency;
  field: EditableField;
  loaded: ProductCatalogue;
  drafts: Drafts;
  error?: string;
  onChange: (k: FieldKey, v: string) => void;
}) {
  const k = fieldKey(product, currency, field);
  const stored = loaded[product][currency][field];
  if (!isEditable(product, field)) {
    return (
      <td className="px-2 py-2 align-top">
        <span className="text-xs italic text-[var(--color-muted-foreground)]">{NOT_SOLD_AS_ADDON}</span>
      </td>
    );
  }
  const value = drafts[k] ?? formatAmount(stored);
  const touched = drafts[k] !== undefined;
  const a = annualOf(field);
  const parsed = parseFieldInput(field, value);
  const annual = a ? (parsed.ok ? deriveAnnual(parsed.value) : null) : undefined;
  const unit = field === "minutes" ? "min" : CURRENCY_SIGN[currency];
  return (
    <td className="px-2 py-2 align-top">
      <label className="flex items-center gap-1">
        <input
          type="text"
          aria-label={`${productLabel} ${currency} ${FIELD_LABEL[field]}`}
          inputMode={field === "minutes" ? "numeric" : "decimal"}
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(k, e.target.value)}
          className={`w-20 rounded-lg border px-2 py-1 text-sm tabular-nums ${
            error ? "border-red-500" : touched ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"
          }`}
        />
        <span className="text-xs text-[var(--color-muted-foreground)]">{unit}</span>
      </label>
      {annual !== undefined && (
        <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
          Annuel : {annual === null ? "—" : `${formatAmount(annual)} ${unit}`}
        </p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </td>
  );
}

export function ProductPricesForm({
  initial,
  names,
  fetchFn,
}: {
  initial: ProductCatalogue;
  /** The products' names (DashboardNav.<entry>, French: lib/product-names.ts). */
  names: ProductNames;
  fetchFn?: typeof fetch;
}) {
  const labels = productLabels(names);
  const [loaded, setLoaded] = useState(initial);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [other, setOther] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [conflict, setConflict] = useState<ProductCatalogue | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inlineErrors = { ...serverErrors, ...draftErrors(drafts) };
  const hasErrors = Object.keys(draftErrors(drafts)).length > 0;
  const patch = pricesPatch(loaded, drafts);
  const diff = diffSummary(loaded, patch, labels);
  const dirty = !patchIsEmpty(patch);

  const onChange = (k: FieldKey, v: string) => {
    setDrafts((d) => ({ ...d, [k]: v }));
    setServerErrors((e) => {
      const { [k]: _gone, ...rest } = e;
      void _gone;
      return rest;
    });
    setReviewing(false);
    setSavedAt(null);
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const r = await savePrices(fetchFn ?? fetch, loaded, patch);
      if (!r.ok) {
        if (r.kind === "conflict") setConflict(r.latest);
        else if (r.kind === "fields") {
          setServerErrors(r.byField);
          setOther(r.other);
        } else setMessage(r.message);
        setReviewing(false);
        return;
      }
      setLoaded(r.catalogue);
      setDrafts({});
      setServerErrors({});
      setOther([]);
      setConflict(null);
      setReviewing(false);
      setSavedAt(new Date().toLocaleTimeString("fr-FR"));
    });
  };

  // Reload: the latest catalogue becomes the base; the drafts stay, so the
  // diff is recomputed against what the server holds now.
  const reload = () => {
    setMessage(null);
    startTransition(async () => {
      const latest = conflict ?? (await fetchCatalogue(fetchFn ?? fetch));
      if (!latest) return setMessage("Le catalogue n'a pas pu être rechargé.");
      setLoaded(latest);
      setConflict(null);
      setReviewing(false);
    });
  };

  return (
    <div className="rounded-3xl border border-[var(--color-border)] bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-primary)]">Catalogue des produits</p>
      <h3 className="mt-1 font-display text-base text-[var(--color-foreground)]">Prix et minutes par produit</h3>
      <p className="mb-3 mt-2 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        Prix mensuels, prix en option, minutes incluses et dépassement, en EUR et en ILS. L&apos;annuel vaut 10 × le mensuel (deux mois
        offerts) et se recalcule seul. Seuls les champs modifiés sont enregistrés.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wider text-[var(--color-muted-foreground)]">
              <th className="px-2 py-2 font-medium">Produit</th>
              <th className="px-2 py-2 font-medium">Devise</th>
              <th className="px-2 py-2 font-medium">{FIELD_LABEL.monthly}</th>
              <th className="px-2 py-2 font-medium">{FIELD_LABEL.addonMonthly}</th>
              <th className="px-2 py-2 font-medium">{FIELD_LABEL.minutes}</th>
              <th className="px-2 py-2 font-medium">{FIELD_LABEL.overagePerMin}</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTS.map((p) =>
              CATALOGUE_CURRENCIES.map((c, i) => (
                <tr key={`${p}.${c}`} className={i === CATALOGUE_CURRENCIES.length - 1 ? "border-b border-[var(--color-border)]" : ""}>
                  <td className="px-2 py-2 align-top font-medium text-[var(--color-foreground)]">{i === 0 ? labels[p] : ""}</td>
                  <td className="px-2 py-2 align-top text-xs text-[var(--color-muted-foreground)]">{c}</td>
                  {(["monthly", "addonMonthly", "minutes", "overagePerMin"] as const).map((f) => (
                    <FieldCell
                      key={f}
                      product={p}
                      productLabel={labels[p]}
                      currency={c}
                      field={f}
                      loaded={loaded}
                      drafts={drafts}
                      error={inlineErrors[fieldKey(p, c, f)]}
                      onChange={onChange}
                    />
                  ))}
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {conflict && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
          <p>{CONFLICT_LINE}</p>
          <button type="button" onClick={reload} disabled={isPending} className="mt-2 font-semibold underline">
            Recharger le catalogue (vos modifications sont conservées)
          </button>
        </div>
      )}

      {reviewing && dirty && !conflict && (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted,#f8fafc)] p-4" aria-live="polite">
          <p className="text-xs font-semibold text-[var(--color-foreground)]">Modifications à enregistrer</p>
          <ul className="mt-2 space-y-1 text-xs tabular-nums text-[var(--color-foreground)]">
            {diff.map((d) => (
              <li key={d.path}>
                {d.label} : <span className="text-[var(--color-muted-foreground)] line-through">{formatAmount(d.from)}</span> →{" "}
                <span className="font-semibold">{formatAmount(d.to)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-amber-800">{CONFIRM_LINE}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Enregistrement…" : "Confirmer et enregistrer"}
            </button>
            <button type="button" onClick={() => setReviewing(false)} className="rounded-full border px-4 py-2 text-xs font-semibold">
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-muted-foreground)]" aria-live="polite">
          {message ? (
            <span className="text-red-600">{message}</span>
          ) : other.length ? (
            <span className="text-red-600">Refusé par le serveur : {other.join(", ")}</span>
          ) : savedAt && !dirty ? (
            <span className="text-emerald-700">Enregistré à {savedAt}</span>
          ) : hasErrors ? (
            <span className="text-red-600">Corrigez les champs en rouge.</span>
          ) : dirty ? (
            `${diff.length} modification${diff.length > 1 ? "s" : ""} non enregistrée${diff.length > 1 ? "s" : ""}`
          ) : (
            "À jour"
          )}
        </p>
        <button
          type="button"
          onClick={() => setReviewing(true)}
          disabled={isPending || !dirty || hasErrors || reviewing || conflict !== null}
          className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Vérifier les modifications
        </button>
      </div>
    </div>
  );
}

/** Loads the catalogue, then the form. */
export function ProductPricesAdmin({ names }: { names: ProductNames }) {
  const [state, setState] = useState<ProductCatalogue | "error" | null>(null);
  useEffect(() => {
    let live = true;
    fetchCatalogue(fetch).then((c) => live && setState(c ?? "error"));
    return () => {
      live = false;
    };
  }, []);
  if (state === null) return <p className="text-sm text-[var(--color-muted-foreground)]">Chargement…</p>;
  if (state === "error") return <p className="text-sm text-red-600">Les prix du catalogue n&apos;ont pas pu être chargés.</p>;
  return <ProductPricesForm initial={state} names={names} />;
}
