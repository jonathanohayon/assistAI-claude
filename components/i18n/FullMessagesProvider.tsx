import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

// Re-provides EVERY namespace to the client components below it. Used by the
// dashboard (and its preview), whose client components read namespaces that
// [locale]/layout no longer ships to public pages (see i18n/public-namespaces).
// Rendered under [locale], so a language switch re-renders it with the new
// locale's messages.
export async function FullMessagesProvider({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
