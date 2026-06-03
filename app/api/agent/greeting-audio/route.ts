import { NextRequest, NextResponse } from "next/server";

import { buildOpenerText, openerHash } from "@/lib/opener";
import {
  getGreetingAudio,
  putGreetingAudio,
} from "@/lib/greeting-audio-storage";
import { renderOpenerAudio } from "@/lib/greeting-render";
import { resolveTenantByPhone } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Endpoint interne consommé par le worker au décroché : renvoie l'audio
// d'accueil pré-généré (PCM16 24kHz mono) pour jouer un opener instantané.
// Gated INTERNAL_SECRET (comme /api/agent/config). Per-tenant : la voix, la
// langue et le texte viennent de la config du tenant résolu par le numéro.
//
// - 200 + corps binaire PCM (headers x-voice, x-sample-rate) → cache hit.
// - 204 → rien à jouer (tenant introuvable / greeting vide / voix→render KO) :
//   le worker retombe sur l'accueil modèle. Sur cache miss on lance la
//   génération en arrière-plan (jamais bloquant) pour que le prochain appel
//   soit instantané.
export async function GET(req: NextRequest) {
  if (req.headers.get("x-internal-secret") !== process.env.INTERNAL_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "phone requis" }, { status: 400 });
  }

  // Résolution EXACTE par numéro — pas de fallback default tenant ici (on ne
  // veut pas pré-render l'accueil d'un autre tenant).
  const tenant = await resolveTenantByPhone(phone);
  if (!tenant) return new NextResponse(null, { status: 204 });

  const { user, config } = tenant;
  const language = config.primaryLanguage ?? "fr";
  // v1 : on pré-render uniquement le greeting EXPLICITE du tenant. Vide →
  // 204, le modèle gère (y compris le fallback admin per-plan).
  const text = buildOpenerText(config.greetingInstructions ?? "", language);
  if (!text) return new NextResponse(null, { status: 204 });

  const key = {
    userId: user.id,
    textHash: openerHash(text),
    voice: config.voice,
    language,
  };

  const hit = await getGreetingAudio(key);
  if (hit) {
    return new NextResponse(new Uint8Array(hit.audioPcm), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
        "x-voice": hit.voice,
        "x-sample-rate": String(hit.sampleRate),
        // Texte de l'opener (base64 UTF-8 → safe pour l'hébreu) : le worker le
        // passe à session.say({ addToChatCtx }) pour que le modèle sache qu'il
        // a déjà accueilli et ne resalue pas.
        "x-opener-text": Buffer.from(text, "utf8").toString("base64"),
      },
    });
  }

  // Miss → génère en arrière-plan, ne bloque jamais l'appel.
  void renderOpenerAudio({ text, voice: config.voice, model: config.model })
    .then((r) => putGreetingAudio(key, r.pcm, r.sampleRate))
    .catch(() => {
      /* best-effort : le worker fallback au modèle */
    });
  return new NextResponse(null, { status: 204 });
}
