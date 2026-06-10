/**
 * Parsing centralisé du body JSON des routes API.
 *
 * Remplace le pattern répété `await req.json().catch(() => ({}))` qui
 * masquait silencieusement les bodies malformés. Ici on distingue :
 *   - body JSON valide   → { ok: true, data }
 *   - body absent/invalide → { ok: false, response } (400 prêt à retourner)
 *
 * Usage :
 *   const body = await parseJsonBody<{ name?: string }>(req);
 *   if (!body.ok) return body.response;
 *   const { name } = body.data;
 *
 * NB : le type T n'est PAS validé à l'exécution (pas de schéma) — c'est une
 * simple assertion TypeScript. Valider les champs critiques individuellement
 * après parsing, comme avant.
 */
import { NextRequest, NextResponse } from "next/server";

export async function parseJsonBody<T = Record<string, unknown>>(
  req: NextRequest,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  try {
    const data = (await req.json()) as T;
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_json" }, { status: 400 }),
    };
  }
}
