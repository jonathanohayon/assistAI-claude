import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { isProduct } from "@/lib/product-trials";
import { startProductTrial } from "@/lib/product-trials-start";

export const dynamic = "force-dynamic";

// POST { product } — "Essayer gratuitement" (P3): starts a 7-day / 30-minute
// per-product trial, once per account × product. Scoped by
// resolveTargetUserId (the tenant; an admin via ?asUserId).
//   400 invalid_product      the body names no catalogue product
//   409 product_unavailable  the product cannot be trialled now (its flag is
//                            off, or its trial cap is not enforced)
//   409 product_owned        the account already has it
//   409 trial_used           it was already trialled (unique per product)
//   201 { trial }            the new trial
export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await parseJsonBody<{ product?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  const product = parsed.data?.product;
  if (!isProduct(product)) return NextResponse.json({ error: "invalid_product" }, { status: 400 });

  const res = await startProductTrial(r.userId, product);
  if (!res.ok) {
    if (res.code === "account_not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: res.code }, { status: 409 });
  }
  const t = res.trial;
  return NextResponse.json(
    {
      trial: {
        product: t.product,
        startedAt: t.startedAt.toISOString(),
        endsAt: t.endsAt.toISOString(),
        minutesIncluded: t.minutesIncluded,
      },
    },
    { status: 201 },
  );
}
