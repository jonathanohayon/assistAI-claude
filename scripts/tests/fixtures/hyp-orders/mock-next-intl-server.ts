// Test double for next-intl/server (getTranslations only), used outside a
// React Server Components runtime: the same translator next-intl builds in
// production (use-intl createTranslator over messages/<locale>.json, which
// is all i18n/request.ts configures: no formats, no time zone).
import { createTranslator } from "use-intl/core";

import en from "../../../../messages/en.json";
import fr from "../../../../messages/fr.json";
import he from "../../../../messages/he.json";

const MESSAGES = { fr, he, en } as const;

export async function getTranslations(opts: { locale: string; namespace?: string }) {
  const locale = (opts.locale in MESSAGES ? opts.locale : "fr") as keyof typeof MESSAGES;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createTranslator({ locale, messages: MESSAGES[locale] as any, namespace: opts.namespace as any }) as any;
}

export function getRequestConfig<T>(fn: T): T {
  return fn;
}
