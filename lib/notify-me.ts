// "Prévenez-moi" (notify-me) on a "soon" product page — CLIENT-SAFE: no db,
// no env, type-only imports. The POST and its outcome live here, outside the
// component, so the tests can drive them without a DOM.
//
//   POST /api/dashboard/products/notify { product }  (admin: ?asUserId=<id>)
//   201 / 200      "done":  the request is stored (200 = it already was)
//   409            "gone":  the product is owned; the page reflects it on reload
//   400/404/other  "error": a plain inline error, the button stays
//   network error  "error"

import type { ProductEntry } from "./product-values";

export type NotifyOutcome = "done" | "gone" | "error";

/** What the header shows under "Bientôt disponible.". */
export type NotifyPhase = "idle" | "pending" | NotifyOutcome;

export function notifyUrl(asUserId?: string | null): string {
  const qs = asUserId ? `?${new URLSearchParams({ asUserId })}` : "";
  return `/api/dashboard/products/notify${qs}`;
}

export function notifyOutcome(status: number): NotifyOutcome {
  if (status === 201 || status === 200) return "done";
  if (status === 409) return "gone";
  return "error";
}

export type NotifyFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ status: number }>;

export async function postNotify(
  product: ProductEntry,
  asUserId: string | null | undefined,
  fetchImpl: NotifyFetch = (url, init) => fetch(url, init),
): Promise<NotifyOutcome> {
  try {
    const res = await fetchImpl(notifyUrl(asUserId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    return notifyOutcome(res.status);
  } catch {
    return "error";
  }
}

/**
 * One request at a time: a call made while another is in flight returns null
 * and sends nothing, so a double click stores the request once.
 */
export function notifySubmitter(post: () => Promise<NotifyOutcome>): () => Promise<NotifyOutcome | null> {
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
