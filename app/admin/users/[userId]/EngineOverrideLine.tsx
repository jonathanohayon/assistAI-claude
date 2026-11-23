"use client";

// ADMIN-ONLY line of the tenant banner: the engine each of the account's
// products RESOLVES to (GET /api/admin/users/[userId]/engine — the same
// decision as the call path), and the account's sales override (PUT, OpenAI
// only today). Product names come from the server (`names`, read from
// DashboardNav.<entry> in French: lib/product-names.ts). The Réception
// client setting is the existing one (agent_configs realtime_provider +
// model, edited in Voix → paramètres développeur, VoiceAdminFields): linked,
// not duplicated.
// Never imported by a tenant page.

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";

import { EngineChoiceRow } from "@/app/admin/engine-override/EngineChoiceRow";
import {
  NOT_FOUND_LINE,
  SOURCE_LABEL,
  costLabel,
  engineChoiceLabel,
  findOption,
  ignoredLine,
  languageName,
  languageWarning,
  missingLanguages,
  putJson,
  salesFieldErrors,
  salesPutBody,
  type BannerEngineData,
  type BannerProduct,
  type EngineOption,
  type EngineOverride,
  type FieldSlot,
  type ResolvedRow,
} from "@/app/admin/engine-override/engine-ui";
import { perMinuteUsdFor, type CostRates } from "@/lib/finance/rates";
import type { ProductNames } from "@/lib/product-values";

type Rates = Pick<CostRates, "perMinuteUsd" | "openaiUsdPerMinute">;
export type EngineLineData = {
  engine: BannerEngineData;
  /** engineOptions from GET /api/admin/product-catalogue (reception for the language note, sales for the select). */
  options: { reception: EngineOption[]; sales: EngineOption[] };
  rates: Rates | null;
};

/** The languages a sales override must speak: the sales agents' (call path), else "fr" (its fallback). */
export function salesLanguages(products: readonly BannerProduct[]): string[] {
  const s = products.find((p) => p.product === "sales");
  if (!s || s.resolved === null) return ["fr"];
  const rows = "byLanguage" in s && s.byLanguage?.length ? s.byLanguage : [s as ResolvedRow];
  return [...new Set(rows.map((r) => r.language))];
}

function ResolvedText({ row }: { row: ResolvedRow }) {
  const r = row.resolved;
  return (
    <>
      <strong className="font-semibold">{engineChoiceLabel(r.engine, r.model)}</strong> · <span data-source>{SOURCE_LABEL[r.source]}</span> ·{" "}
      <span data-cost>{costLabel(row.costPerMinUsd)}</span>
    </>
  );
}

function ProductLine({ p, receptionOptions, names }: { p: BannerProduct; receptionOptions: EngineOption[]; names: ProductNames }) {
  if (p.resolved === null) {
    return (
      <li data-product={p.product}>
        <span className="font-medium">{names[p.entry]}</span> : l&apos;agent du client répond, aucun moteur imposé.
      </li>
    );
  }
  const rows: ResolvedRow[] = p.byLanguage?.length ? p.byLanguage : [p];
  return (
    <li data-product={p.product}>
      <span className="font-medium">{names[p.entry]}</span>
      {p.product === "reception_multi" ? " (multi-sites)" : ""} :{" "}
      {rows.map((row, i) => {
        const ig = ignoredLine(row.ignored, row.language);
        // The client setting is applied as is (no language guard on that level): say so when it doesn't speak the language.
        const clientMute =
          p.entry === "reception" &&
          row.resolved.source === "client" &&
          missingLanguages(receptionOptions, { engine: row.resolved.engine, model: row.resolved.model }, [row.language]).length > 0;
        return (
          <span key={row.language} className="block sm:inline">
            {i > 0 && <span className="hidden sm:inline"> · </span>}
            {rows.length > 1 && <span>{languageName(row.language)} : </span>}
            <ResolvedText row={row} />
            {ig && (
              <span role="note" data-ignored className="block font-semibold text-[#b45309]">
                {ig}
              </span>
            )}
            {clientMute && (
              <span role="note" className="block font-semibold text-[#b45309]">
                Ce moteur ne parle pas {languageName(row.language)} (langue inconnue = non prise en charge) ; le réglage du client
                s&apos;applique quand même.
              </span>
            )}
          </span>
        );
      })}
    </li>
  );
}

export function EngineOverridePanel({
  userId,
  data,
  names,
  onSaved,
  defaultOpen = false,
  initialSalesChoice,
  initialErrors = {},
  fetchFn,
}: {
  userId: string;
  data: EngineLineData;
  /** The products' names (DashboardNav.<entry>, French). */
  names: ProductNames;
  onSaved?: () => void;
  defaultOpen?: boolean;
  /** Tests / captures: start the sales select on this choice instead of the stored one. */
  initialSalesChoice?: EngineOverride | null;
  initialErrors?: Partial<Record<FieldSlot, string>>;
  fetchFn?: typeof fetch;
}) {
  const stored = data.engine.salesOverride;
  const [choice, setChoice] = useState<EngineOverride | null>(initialSalesChoice !== undefined ? initialSalesChoice : stored);
  const [errors, setErrors] = useState(initialErrors);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [syncedStored, setSyncedStored] = useState(stored);
  if (syncedStored !== stored) {
    setSyncedStored(stored);
    setChoice(stored);
  }

  const products = data.engine.products;
  const hasSales = products.some((p) => p.product === "sales");
  const body = salesPutBody(stored, choice);
  const dirty = "salesOverride" in body;
  const options = data.options.sales;
  const cost = choice && data.rates ? perMinuteUsdFor(data.rates, choice.engine, choice.model) : null;

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const r = await putJson(fetchFn ?? fetch, `/api/admin/users/${userId}/engine`, body);
      if (!r.ok) {
        if (r.kind === "fields") setErrors(salesFieldErrors(r.fields));
        else setMessage(r.kind === "not_found" ? NOT_FOUND_LINE : r.message);
        return;
      }
      setErrors({});
      setMessage("Enregistré.");
      onSaved?.();
    });
  };

  return (
    <details open={defaultOpen} className="w-full border-t border-[#fde68a] pt-2">
      <summary className="cursor-pointer select-none font-medium">Moteur vocal par produit (admin)</summary>
      <ul className="mt-2 space-y-1">
        {products.length === 0 && <li>Aucun produit souscrit.</li>}
        {products.map((p) => (
          <ProductLine key={p.product} p={p} receptionOptions={data.options.reception} names={names} />
        ))}
      </ul>
      <p className="mt-1">
        Réception : le moteur imposé pour ce client est le réglage existant,{" "}
        <Link href={`/admin/users/${userId}/my-agent?tile=voice`} className="underline">
          Voix → paramètres développeur
        </Link>
        .
      </p>
      <div className="mt-2 rounded-xl bg-white/70 px-3">
        <EngineChoiceRow
          label={`${names.sales} : imposé pour ce client`}
          options={options}
          choice={choice}
          onChange={(c) => {
            setChoice(c);
            setErrors({});
          }}
          costPerMinUsd={cost}
          warning={languageWarning(missingLanguages(options, choice, salesLanguages(products)), "account")}
          errors={errors}
          noneLabel="Aucun (pas de moteur imposé pour ce client)"
          note={hasSales ? null : `Ce compte n'a pas le produit ${names.sales} : le réglage s'appliquera s'il le souscrit.`}
        />
        <div className="flex flex-wrap items-center gap-3 pb-3">
          <button
            type="button"
            onClick={save}
            disabled={isPending || !dirty || (choice !== null && !findOption(options, choice)?.honoured)}
            className="rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {isPending ? "Enregistrement…" : `Enregistrer ${names.sales}`}
          </button>
          {message && (
            <span role="status" className={message === "Enregistré." ? "text-emerald-700" : "text-red-600"}>
              {message}
            </span>
          )}
        </div>
      </div>
    </details>
  );
}

/** Loads the three admin reads, then the panel; reloads after a save. */
export function EngineOverrideLine({ userId, names }: { userId: string; names: ProductNames }) {
  const [state, setState] = useState<EngineLineData | "not_found" | "error" | null>(null);
  const load = useCallback(async () => {
    try {
      const [eRes, cRes, rRes] = await Promise.all([
        fetch(`/api/admin/users/${userId}/engine`, { cache: "no-store" }),
        fetch("/api/admin/product-catalogue", { cache: "no-store" }),
        fetch("/api/admin/cost-rates", { cache: "no-store" }).catch(() => null),
      ]);
      if (eRes.status === 404) return setState("not_found");
      if (!eRes.ok || !cRes.ok) return setState("error");
      const engine = (await eRes.json()) as BannerEngineData;
      const cat = (await cRes.json()) as { engineOptions?: Record<string, { options?: EngineOption[] }> };
      const rates = rRes?.ok ? (((await rRes.json()) as { rates?: Rates }).rates ?? null) : null;
      setState({
        engine,
        options: { reception: cat.engineOptions?.reception?.options ?? [], sales: cat.engineOptions?.sales?.options ?? [] },
        rates,
      });
    } catch {
      setState("error");
    }
  }, [userId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client fetch after mount
    void load();
  }, [load]);
  if (state === null) return <p className="w-full border-t border-[#fde68a] pt-2">Moteur vocal : chargement…</p>;
  if (state === "not_found") return <p className="w-full border-t border-[#fde68a] pt-2">{NOT_FOUND_LINE}</p>;
  if (state === "error") return <p className="w-full border-t border-[#fde68a] pt-2">Moteur vocal : lecture impossible.</p>;
  return <EngineOverridePanel userId={userId} names={names} data={state} onSaved={() => void load()} />;
}
