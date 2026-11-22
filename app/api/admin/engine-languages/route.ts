import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/auth-guards";
import { engineLanguagesWrite } from "@/lib/engine-languages";
import { engineLanguagesEditEvent, getEngineLanguages, setEngineLanguages } from "@/lib/engine-languages-storage";
import { logEvent } from "@/lib/logger";

// /api/admin/engine-languages — ADMIN ONLY. The languages each speech
// engine (and optionally each model) speaks (app_settings
// "engine_languages_v1", lib/engine-languages.ts). Unknown = not supported.
// Read by nothing on the call path yet (E2 wires the engine resolver).

// GET — the table in force (the stored row, else the defaults).
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ languages: await getEngineLanguages() });
}

// PUT — body `{ languages: <partial> }`. Only the engines / entries present
// are written; everything omitted keeps its stored value (an empty body
// changes nothing). null removes a per-model entry. Any unknown key or bad
// list → 400 naming every offending path, and nothing is written. Every
// write that changes something logs who and what (before/after lists).
export async function PUT(req: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => ({}))) as unknown;
  const stored = await getEngineLanguages();
  const w = engineLanguagesWrite(stored, body);
  if (!w.ok) return NextResponse.json({ error: w.error, fields: w.fields }, { status: 400 });
  if (w.changed) {
    await setEngineLanguages(w.value);
    await logEvent(engineLanguagesEditEvent(guard.admin.id, w.changes));
  }
  return NextResponse.json({ ok: true, languages: w.value });
}
