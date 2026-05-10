import { NextRequest, NextResponse } from "next/server";

import { getGlobalInstructions } from "@/lib/settings";
import { resolveTenant } from "@/lib/tenant";

// Read-only endpoint consumed by the LiveKit agent worker at session start.
// Routes by `?phone=<called number>` to load the right tenant's config.
//
// Effective instructions = [global system prompt set by admin] + [tenant persona]
// — that way every tenant inherits cross-cutting rules (anti-silence, tool
// description, response length, etc.) without each having to re-paste them.
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone");
  const tenant = await resolveTenant(phone);
  if (!tenant) {
    return NextResponse.json({ error: "No tenant" }, { status: 404 });
  }

  const { config } = tenant;
  const globalInstructions = await getGlobalInstructions();

  const langLabel: Record<string, string> = {
    fr: "français",
    he: "hébreu",
    en: "anglais (US)",
  };
  const primary = config.primaryLanguage ?? "fr";
  const languageDirective = `LANGUE PAR DÉFAUT DU TENANT : ${langLabel[primary] ?? "français"} (code: ${primary}).
- Utilise cette langue UNIQUEMENT pour le tout premier message d'accueil.
- Dès que la cliente parle, détecte sa langue et réponds STRICTEMENT dans la sienne.
- Si elle bascule à une autre langue, suis-la immédiatement.`;

  const mergedInstructions = [globalInstructions, languageDirective, config.instructions]
    .filter(Boolean)
    .join("\n\n──────────────────────────────────────────\n\n");

  // Strip internal IDs — the agent only needs the runtime values.
  const { id: _id, userId: _userId, updatedAt, ...runtime } = config;
  void _id;
  void _userId;
  return NextResponse.json({
    ...runtime,
    instructions: mergedInstructions,
    updatedAt,
  });
}
