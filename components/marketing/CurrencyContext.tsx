"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Currency = "EUR" | "USD" | "ILS";

// Symbole + locale Intl pour le formatage. La locale détermine la
// position du symbole et le séparateur de milliers.
export const CURRENCY_META: Record<
  Currency,
  { symbol: string; locale: string }
> = {
  EUR: { symbol: "€", locale: "fr-FR" },
  USD: { symbol: "$", locale: "en-US" },
  ILS: { symbol: "₪", locale: "he-IL" },
};

// Filet de sécurité si frankfurter.app KO. Valeurs approximatives mai 2026.
const FALLBACK_RATES: Record<Currency, number> = {
  EUR: 1,
  USD: 1.08,
  ILS: 4.05,
};

const FX_CACHE_KEY = "fx_rates_eur_v1";
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // rates ECB bougent peu intra-day
const CURRENCY_PREF_KEY = "currency_pref_v1";

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  rates: Record<Currency, number>;
  /** Convertit un montant EUR vers la devise active, formaté avec symbole. */
  format: (amountEur: number) => string;
}

const Ctx = createContext<CurrencyContextValue | null>(null);

function isCurrency(v: unknown): v is Currency {
  return v === "EUR" || v === "USD" || v === "ILS";
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("EUR");
  const [rates, setRates] = useState<Record<Currency, number>>(FALLBACK_RATES);

  // Restore la préférence devise du visiteur (sticky cross-visit).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CURRENCY_PREF_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydratation localStorage post-mount (SSR-safe), pattern voulu
      if (isCurrency(saved)) setCurrencyState(saved);
    } catch {
      // localStorage indispo (mode privé Safari, etc.) → stick à EUR
    }
  }, []);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(CURRENCY_PREF_KEY, c);
    } catch {
      // best-effort
    }
  };

  // Fetch FX rates avec cache sessionStorage 6h.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FX_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          ts: number;
          rates: Record<Currency, number>;
        };
        if (Date.now() - parsed.ts < FX_CACHE_TTL_MS) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- hydratation du cache sessionStorage post-mount (SSR-safe), pattern voulu
          setRates(parsed.rates);
          return;
        }
      }
    } catch {
      // cache pourri ou indispo → fresh fetch
    }

    const ctrl = new AbortController();
    fetch("https://api.frankfurter.app/latest?from=EUR&to=USD,ILS", {
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fx http"))))
      .then((data: { rates?: { USD?: number; ILS?: number } }) => {
        const usd = data.rates?.USD;
        const ils = data.rates?.ILS;
        if (typeof usd !== "number" || typeof ils !== "number") return;
        const next: Record<Currency, number> = { EUR: 1, USD: usd, ILS: ils };
        setRates(next);
        try {
          sessionStorage.setItem(
            FX_CACHE_KEY,
            JSON.stringify({ ts: Date.now(), rates: next }),
          );
        } catch {
          // best-effort
        }
      })
      .catch(() => {
        // garde le fallback
      });

    return () => ctrl.abort();
  }, []);

  const format = (amountEur: number) => {
    const converted = Math.round(amountEur * rates[currency]);
    return new Intl.NumberFormat(CURRENCY_META[currency].locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(converted);
  };

  return (
    <Ctx.Provider value={{ currency, setCurrency, rates, format }}>
      {children}
    </Ctx.Provider>
  );
}

// Fallback no-op pour les pages sans provider (dashboard, signup) :
// renvoie toujours EUR. Permet à Pricing.tsx d'être utilisable ailleurs
// sans crasher.
const NOOP_FORMAT_EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function useCurrency(): CurrencyContextValue {
  const v = useContext(Ctx);
  if (v) return v;
  return {
    currency: "EUR",
    setCurrency: () => {},
    rates: FALLBACK_RATES,
    format: (amountEur) => NOOP_FORMAT_EUR.format(Math.round(amountEur)),
  };
}
