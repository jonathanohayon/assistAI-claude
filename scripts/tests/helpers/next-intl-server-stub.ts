// Test-only stand-in for "next-intl/server" outside Next (DB suites run route
// handlers with tsx). The real getTranslations needs the react-server
// condition and the Next plugin's "next-intl/config" alias; this one builds
// the same translator from the same message files (use-intl's
// createTranslator, which next-intl uses underneath). Mapped in by the shared
// test tsconfig written by scripts/lib/next-intl-stub-tsconfig.sh (sourced by
// the DB suites that need it), never imported by the app.

import { createTranslator } from "use-intl/core";

import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import he from "../../../messages/he.json";

const MESSAGES = { en, fr, he } as const;

export async function getTranslations(opts: { locale: string; namespace?: string }) {
  const locale = (opts.locale in MESSAGES ? opts.locale : "fr") as keyof typeof MESSAGES;
  const t = createTranslator({ locale, messages: MESSAGES[locale] as Record<string, unknown>, namespace: opts.namespace as never });
  return t as unknown as (key: string, vars?: Record<string, unknown>) => string;
}

/** i18n/request.ts's default export is never called here; keep its shape. */
export function getRequestConfig<T>(f: T): T {
  return f;
}
