/**
 * HYP / Yaad Pay-Protocol helpers (signature faite côté HYP via APISign).
 * Docs: https://hypay.docs.apiary.io/introduction/pay-protocol
 *
 * Porté depuis le projet shabespresso puis adapté à l'abonnement Tamara :
 *   - paiement one-shot d'une période (mensuel/annuel), pas de panier
 *   - bi-devise ILS (Coin=1) / EUR (Coin=3) résolue depuis la locale tenant
 *   - l'Order envoyé à HYP = l'uuid d'une ligne payment_orders (opaque), le
 *     handler de retour s'y fie pour connaître plan/montant/devise attendus.
 *
 * On réutilise le compte marchand HYP de shabespresso (mêmes env vars).
 */

export const HYP_BASE_URL = process.env.HYP_API_URL || "https://icom.yaad.net/p/";

// Template `tmp` HYP. Le "7" (forme courte) ne rend PAS le logo client lié au
// masof — vérifié empiriquement : le template par défaut affiche
// logoes/<masof>.png (= le logo shabespresso vu qu'on réutilise son masof),
// tmp=7 ne l'affiche pas. C'est aussi le template utilisé par shabespresso.
export const HYP_TEMPLATE_ID = "7";

/** Code devise HYP (`Coin`). 1 = ILS, 3 = EUR dans le Pay-Protocol. */
export const CURRENCY_COIN = { ILS: "1", EUR: "3" } as const;
export type Currency = keyof typeof CURRENCY_COIN;

/**
 * Devise de facturation selon la locale du tenant : hébreu → Israël → ILS,
 * français / anglais → Europe → EUR. (Décision produit 2026-06-03.)
 */
export function currencyForLocale(locale: string): Currency {
  return locale === "he" ? "ILS" : "EUR";
}

/**
 * `PageLang` HYP. Le masof 5603776126 n'a que les templates HEB et ENG, donc
 * le français retombe sur l'anglais (cf. shabespresso).
 */
export function pageLangFor(locale: string): "HEB" | "ENG" {
  return locale === "he" ? "HEB" : "ENG";
}

function creds() {
  const Masof = process.env.HYP_TERMINAL;
  const PassP = process.env.HYP_PASSP;
  const KEY = process.env.HYP_KEY;
  if (!Masof || !PassP || !KEY) {
    throw new Error(
      "HYP non configuré (HYP_TERMINAL / HYP_PASSP / HYP_KEY manquants)",
    );
  }
  return { Masof, PassP, KEY };
}

export type CreatePaymentInput = {
  /** uuid de la ligne payment_orders — envoyé tel quel comme `Order`. */
  orderId: string;
  /** Montant dans la devise choisie (ex : 129 pour 129 €). */
  amount: number;
  /** Code `Coin` HYP : "1" (ILS) | "3" (EUR). */
  coin: string;
  /** Libellé visible sur la page de paiement (≤ 160 chars). */
  info: string;
  pageLang: "HEB" | "ENG";
  /** URL de retour succès (le handler /callback). */
  successUrl: string;
  /** URL de retour annulation. */
  cancelUrl: string;
  email?: string;
  /** Prénom client — HYP/la société de crédit exige un nom prénom OU nom. */
  clientName?: string;
  /** Nom de famille client. */
  clientLName?: string;
};

/**
 * Construit l'URL de paiement HYP (page hébergée). Passe par APISign&What=SIGN
 * pour que HYP signe lui-même la requête (HMAC-SHA256 côté HYP). Renvoie l'URL
 * finale vers laquelle rediriger le tenant.
 */
export async function createPaymentUrl(input: CreatePaymentInput): Promise<string> {
  const { Masof, PassP, KEY } = creds();

  const params = new URLSearchParams({
    action: "APISign",
    What: "SIGN",
    KEY,
    PassP,
    Masof,
    Amount: Number(input.amount).toFixed(2),
    Info: input.info.slice(0, 160) || "Tamara",
    Order: input.orderId,
    UTF8: "True",
    UTF8out: "True",
    Sign: "True",
    MoreData: "True",
    PageLang: input.pageLang,
    tmp: HYP_TEMPLATE_ID,
    Coin: input.coin,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
  });
  if (input.email) params.set("email", input.email);
  // ClientName/ClientLName : la société de crédit refuse sans prénom NI nom
  // ("חובה להזין שם פרטי או משפחה"). Le template tmp court n'a pas de champ
  // nom à saisir, donc on le passe en paramètre.
  if (input.clientName) params.set("ClientName", input.clientName);
  if (input.clientLName) params.set("ClientLName", input.clientLName);

  const res = await fetch(`${HYP_BASE_URL}?${params.toString()}`);
  const body = (await res.text()).trim();

  if (!res.ok || !body.includes("signature=")) {
    throw new Error(`HYP APISign failed: ${body.slice(0, 300)}`);
  }

  return `${HYP_BASE_URL}?${body}`;
}

/**
 * Vérifie le retour HYP via APISign&What=VERIFY. HYP re-valide sa propre
 * signature → un retour forgé ne peut pas falsifier le résultat. `CCode === "0"`
 * = succès. Le binding Order/Amount/Coin vs la DB se fait côté appelant.
 */
export async function verifyPayment(
  redirectParams: Record<string, string>,
): Promise<{ ok: boolean; ccode: string | null; raw: Record<string, string> }> {
  const { Masof, PassP, KEY } = creds();

  const params = new URLSearchParams({
    action: "APISign",
    What: "VERIFY",
    KEY,
    PassP,
    Masof,
    ...redirectParams,
  });

  const res = await fetch(`${HYP_BASE_URL}?${params.toString()}`);
  const body = (await res.text()).trim();
  const parsed: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) parsed[k] = v;

  return {
    ok: parsed["CCode"] === "0",
    ccode: parsed["CCode"] ?? null,
    raw: parsed,
  };
}
