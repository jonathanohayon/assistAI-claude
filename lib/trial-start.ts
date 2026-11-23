// "Essayer gratuitement" (F4): the POST and its outcome — CLIENT-SAFE: no db,
// no env, type-only imports, so the tests drive it without a DOM.
//
//   POST /api/dashboard/products/trial { product }  (admin: ?asUserId=<id>)
//   (statuses and bodies: app/api/dashboard/products/trial/route.ts)
//   201                          "started":     refresh, the menu shows the product owned
//   409 product_owned            "refresh":     already owned, refresh shows it
//   409 trial_used               "used":        inline error, no new attempt offered
//   409 product_unavailable      "unavailable": inline error
//   400/401/403/404/5xx/network  "error":       inline error, the button stays

import type { ProductEntry } from "./product-values";

export type TrialStartOutcome = "started" | "refresh" | "used" | "unavailable" | "error";

export function trialStartUrl(asUserId?: string | null): string {
  const qs = asUserId ? `?${new URLSearchParams({ asUserId })}` : "";
  return `/api/dashboard/products/trial${qs}`;
}

export function trialStartOutcome(status: number, error: unknown): TrialStartOutcome {
  if (status === 201) return "started";
  if (status === 409 && error === "product_owned") return "refresh";
  if (status === 409 && error === "trial_used") return "used";
  if (status === 409 && error === "product_unavailable") return "unavailable";
  return "error";
}

export type TrialFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export async function postTrialStart(
  product: ProductEntry,
  asUserId: string | null | undefined,
  fetchImpl: TrialFetch = (url, init) => fetch(url, init),
): Promise<TrialStartOutcome> {
  try {
    const res = await fetchImpl(trialStartUrl(asUserId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    let error: unknown = null;
    if (res.status !== 201) {
      try {
        const body = (await res.json()) as { error?: unknown } | null;
        error = body?.error ?? null;
      } catch {
        error = null;
      }
    }
    return trialStartOutcome(res.status, error);
  } catch {
    return "error";
  }
}

/**
 * One request at a time: a call made while another is in flight returns null
 * and sends nothing, so a double click starts the trial with ONE POST.
 */
export function trialStartSubmitter(post: () => Promise<TrialStartOutcome>): () => Promise<TrialStartOutcome | null> {
  let inFlight = false;
  return async () => {
    if (inFlight) return null;
    inFlight = true;
    try {
      return await post();
    } finally {
      inFlight = false;
    }
  };
}
