import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/api/auth-guards";
import { parseJsonBody } from "@/lib/api/request-parsing";
import { isProductEntry, recordNotifyRequest } from "@/lib/product-notify";
import { menuForAccount } from "@/lib/product-gates";
import { shownAsOwned } from "@/lib/product-menu";
import { accountProducts } from "@/lib/products";

export const dynamic = "force-dynamic";

// POST { product } — "Prévenez-moi": records that the account wants to be
// told when a product entry it does not own becomes available. A record
// only: no email is sent, and no message string is returned (the
// confirmation copy is the front end's). Scoped by resolveTargetUserId (the
// tenant; an admin via ?asUserId).
//   201 { product, requestedAt }  the first request
//   200 { product, requestedAt }  a repeat: the ORIGINAL requestedAt (idempotent)
//   400 invalid_product           the body names no entry (reception | sales | connect)
//   409 product_owned             the dashboard menu shows that entry as OWNED
//                                 (entitled AND its gate on, or an admin
//                                 account); entitled with the gate off is a
//                                 "soon" preview, so it is accepted
//   404                           the target account does not exist (admin asUserId)
export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = await parseJsonBody<{ product?: unknown }>(req);
  if (!parsed.ok) return NextResponse.json({ error: "invalid_product" }, { status: 400 });
  const product = parsed.data?.product;
  if (!isProductEntry(product)) return NextResponse.json({ error: "invalid_product" }, { status: 400 });

  const owned = await accountProducts(r.userId);
  if (owned.base === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The SAME menu the layouts render: the target account's own role and plan
  // features (an admin's ?asUserId sees what the tenant sees).
  if (shownAsOwned(await menuForAccount(r.userId, owned), product)) {
    return NextResponse.json({ error: "product_owned" }, { status: 409 });
  }

  const { created, record } = await recordNotifyRequest(r.userId, product);
  return NextResponse.json(
    { product: record.product, requestedAt: record.requestedAt.toISOString() },
    { status: created ? 201 : 200 },
  );
}
