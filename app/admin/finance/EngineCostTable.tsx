// ADMIN-ONLY: "Coût par moteur" table of the admin Finance page (global and
// per tenant, via FinanceDashboard's userId). Renders the server's `byEngine`
// rows as-is; no tenant page may import this module
// (scripts/tests/finance-engine-cost-ui.test.ts guards it).
//
// Display rules:
//   - only rateBasis "worker-reported" is a measured cost; every other basis
//     gets an "estimation" label next to its Coût and Coût/min figures;
//   - "openai-flat" adds one caveat line under the table (one OpenAI rate for
//     every model);
//   - a null figure shows "—", never 0;
//   - Σ costUsd is checked against the OpenAI total shown on the page: a gap
//     over one cent shows a quiet warning line, the rows stay visible.

import { fmtInt, fmtMinutes, fmtUsd, fmtUsdPrecise } from "./format";
import type { EngineCost, EngineRateBasis } from "./types";

export const DASH = "—";
export const ESTIMATE_LABEL = "estimation";
export const FLAT_RATE_CAVEAT =
  "Coût OpenAI calculé avec un seul tarif OpenAI (grille tarifaire), appliqué à tous les modèles OpenAI.";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  xai: "Grok (xAI)",
  unknown: "Inconnu",
  unmetered: "Non mesuré",
};

/** Plain French engine name ("OpenAI", "Non mesuré", ...); an unlisted provider shows as-is. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/** Only the worker's own figure is a measured cost. */
export function isMeasured(basis: EngineRateBasis): boolean {
  return basis === "worker-reported";
}

/** Σ costUsd, rounded to the cent like totals.openai. */
export function engineCostSum(rows: EngineCost[]): number {
  return Math.round(rows.reduce((s, r) => s + r.costUsd, 0) * 100) / 100;
}

/** True when the rows add up to the OpenAI total (one-cent tolerance for per-row rounding). */
export function sumMatchesTotal(rows: EngineCost[], openaiTotal: number): boolean {
  return Math.abs(engineCostSum(rows) - openaiTotal) <= 0.01 + 1e-9;
}

function Estimate() {
  return (
    <span
      data-estimate
      className="ml-1.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-800"
    >
      {ESTIMATE_LABEL}
    </span>
  );
}

function Money({ value, precise, estimated }: { value: number | null; precise?: boolean; estimated: boolean }) {
  if (value === null) return <>{DASH}</>;
  return (
    <>
      {precise ? fmtUsdPrecise(value) : fmtUsd(value)}
      {estimated ? <Estimate /> : null}
    </>
  );
}

const TH = "px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]";

export default function EngineCostTable({ rows, openaiTotal }: { rows: EngineCost[]; openaiTotal: number }) {
  if (!rows.length) {
    return (
      <div className="flex h-24 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-white">
        <p className="text-sm text-[var(--color-muted-foreground)]">Aucun coût moteur sur cette période.</p>
      </div>
    );
  }
  const sum = engineCostSum(rows);
  const matches = sumMatchesTotal(rows, openaiTotal);
  const hasFlat = rows.some((r) => r.rateBasis === "openai-flat");
  const anyEstimate = rows.some((r) => !isMeasured(r.rateBasis));

  return (
    <div data-engine-cost-table>
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/40">
                <th className={`${TH} text-left`}>Moteur</th>
                <th className={`${TH} text-right`}>Appels</th>
                <th className={`${TH} text-right`}>Minutes</th>
                <th className={`${TH} text-right`}>Coût</th>
                <th className={`${TH} text-right`}>Coût/min</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const est = !isMeasured(r.rateBasis);
                return (
                  <tr
                    key={`${r.provider}|${r.model ?? ""}|${r.rateBasis}`}
                    data-engine-row={`${r.provider}|${r.model ?? ""}|${r.rateBasis}`}
                    className="border-b border-[var(--color-border)]/60"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--color-foreground)]">{providerLabel(r.provider)}</p>
                      {r.provider !== "unmetered" ? (
                        <p data-model className="text-[12px] text-[var(--color-muted-foreground)]">
                          {r.model ?? DASH}
                        </p>
                      ) : null}
                    </td>
                    <td data-col="calls" className="px-4 py-3 text-right tabular-nums text-[var(--color-muted-foreground)]">
                      {r.calls === null ? DASH : fmtInt(r.calls)}
                    </td>
                    <td data-col="minutes" className="px-4 py-3 text-right tabular-nums text-[var(--color-muted-foreground)]">
                      {fmtMinutes(r.minutes)}
                    </td>
                    <td data-col="cost" className="px-4 py-3 text-right font-medium tabular-nums text-[var(--color-foreground)]">
                      <Money value={r.costUsd} estimated={est} />
                    </td>
                    <td data-col="per-minute" className="px-4 py-3 text-right tabular-nums text-[var(--color-muted-foreground)]">
                      <Money value={r.costPerMinuteUsd} precise estimated={est} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr data-engine-total className="bg-[var(--color-muted)]/30">
                <td className="px-4 py-3 font-semibold text-[var(--color-foreground)]">Total</td>
                <td />
                <td />
                <td data-col="cost" className="px-4 py-3 text-right font-semibold tabular-nums text-[var(--color-foreground)]">
                  <Money value={sum} estimated={anyEstimate} />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {hasFlat ? (
        <p data-flat-caveat className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">
          {FLAT_RATE_CAVEAT}
        </p>
      ) : null}
      {!matches ? (
        <p data-sum-mismatch className="mt-1 text-[12px] text-[var(--color-muted-foreground)]">
          La somme des moteurs ({fmtUsd(sum)}) ne correspond pas au coût OpenAI affiché ({fmtUsd(openaiTotal)}).
        </p>
      ) : null}
    </div>
  );
}
