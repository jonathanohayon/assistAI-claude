import { NextRequest, NextResponse } from "next/server";

import { resolveTargetUserId } from "@/lib/campaigns/scope";
import { learnFromSites, MAX_LEARN_URLS } from "@/lib/campaigns/learn";

// Node runtime (cheerio + dns dans le crawler).
export const dynamic = "force-dynamic";

// POST { urls: string[], language? } — crawle le(s) site(s) et renvoie une
// fiche de connaissance métier distillée. N'INSÈRE RIEN : le client la place
// dans la persona du brouillon de campagne puis sauvegarde.
export async function POST(req: NextRequest) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    urls?: unknown;
    language?: unknown;
  };
  const urls = Array.isArray(body.urls)
    ? body.urls.filter((u): u is string => typeof u === "string")
    : [];
  if (!urls.length)
    return NextResponse.json({ error: "no_urls" }, { status: 400 });
  if (urls.length > MAX_LEARN_URLS)
    return NextResponse.json(
      { error: "too_many_urls", max: MAX_LEARN_URLS },
      { status: 400 },
    );

  const language = typeof body.language === "string" ? body.language : "fr";

  try {
    const result = await learnFromSites(urls, language);
    if (!result.knowledge)
      return NextResponse.json(
        { error: "scan_failed", failed: result.failed },
        { status: 422 },
      );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "scan_error", detail: e instanceof Error ? e.message : "" },
      { status: 500 },
    );
  }
}
