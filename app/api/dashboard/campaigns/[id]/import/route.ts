import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";
import { resolveTargetUserId } from "@/lib/campaigns/scope";
import {
  extractSpreadsheetId,
  fetchSheet,
  parseCsv,
  parseXlsx,
} from "@/lib/campaigns/import";

// Node runtime requis (xlsx + buffers).
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

// POST — parse un fichier (multipart CSV/XLSX) OU un Google Sheet
// ({source:"sheets", spreadsheetId?, range?}) et renvoie { headers, rows }.
// N'INSÈRE RIEN : le client mappe les colonnes puis POST sur .../contacts.
export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await resolveTargetUserId(req);
  if ("unauthorized" in r)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ("forbidden" in r)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await ctx.params;
  const [campaign] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, r.userId)))
    .limit(1);
  if (!campaign)
    return NextResponse.json({ error: "not_found" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";

  try {
    // ── Fichier (multipart/form-data) ───────────────────────────────────
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        return NextResponse.json({ error: "no_file" }, { status: 400 });
      const name = file.name.toLowerCase();
      const buf = await file.arrayBuffer();
      const parsed =
        name.endsWith(".csv") || file.type === "text/csv"
          ? parseCsv(new TextDecoder().decode(buf))
          : parseXlsx(buf);
      return NextResponse.json(parsed);
    }

    // ── Google Sheets (JSON) ────────────────────────────────────────────
    const body = (await req.json().catch(() => ({}))) as {
      source?: string;
      spreadsheetId?: string;
      range?: string;
    };
    if (body.source === "sheets") {
      const sheetId = extractSpreadsheetId(body.spreadsheetId ?? "");
      const result = await fetchSheet(r.userId, sheetId, body.range ?? "");
      if ("notConnected" in result)
        return NextResponse.json({ error: "not_connected" }, { status: 409 });
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: "parse_failed", detail: e instanceof Error ? e.message : "" },
      { status: 422 },
    );
  }
}
