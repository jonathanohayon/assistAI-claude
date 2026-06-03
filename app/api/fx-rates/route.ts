import { NextResponse } from "next/server";

// Proxy serveur des taux de change EUR→USD/ILS.
//
// Pourquoi : le composant pricing (useExchangeRates) fetchait
// api.frankfurter.app DIRECTEMENT depuis le navigateur, mais l'API ne renvoie
// plus le header Access-Control-Allow-Origin → bloqué par CORS. On fetch donc
// côté serveur (server-to-server, pas de CORS) et on renvoie les taux au client
// depuis notre propre origine. Cache 6h (les taux ECB bougent peu intra-day).

const FALLBACK = { EUR: 1, USD: 1.08, ILS: 4.05 };

export async function GET() {
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=EUR&to=USD,ILS",
      { next: { revalidate: 21600 } }, // 6h
    );
    if (!res.ok) throw new Error(`fx http ${res.status}`);
    const data = (await res.json()) as {
      rates?: { USD?: number; ILS?: number };
    };
    const usd = data.rates?.USD;
    const ils = data.rates?.ILS;
    if (typeof usd !== "number" || typeof ils !== "number") {
      throw new Error("fx missing rates");
    }
    return NextResponse.json({ EUR: 1, USD: usd, ILS: ils });
  } catch {
    // Filet de sécurité — le client a aussi son propre fallback.
    return NextResponse.json({ ...FALLBACK, fallback: true });
  }
}
