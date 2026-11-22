// Fake "next-intl/server" for email-render-harness.ts: getTranslations over
// the repo's messages/<locale>.json, through next-intl's own translator.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";

const ROOT = new URL("../../../", import.meta.url).pathname;

export async function getTranslations({ locale, namespace }: { locale: string; namespace: string }) {
  const messages = JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createTranslator({ locale, namespace: namespace as any, messages });
}
