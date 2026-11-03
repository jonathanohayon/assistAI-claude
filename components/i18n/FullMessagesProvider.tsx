import { eq } from "drizzle-orm";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { auth } from "@/auth";
import { ADMIN_ONLY_NAMESPACES } from "@/i18n/public-namespaces";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

// Re-provides the translations the dashboard's client components need, which
// [locale]/layout no longer ships to public pages (see i18n/public-namespaces).
// Admin-only namespaces (they name suppliers, e.g. the engine picker) are
// left out unless the signed-in user is an admin, so tenants never receive
// them, not even in the page payload. Rendered under [locale], so a language
// switch re-renders it with the new locale's messages.
export async function FullMessagesProvider({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();
  const session = await auth();
  let isAdmin = false;
  if (session?.user?.id) {
    const [me] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    isAdmin = me?.role === "admin";
  }
  const scoped = isAdmin
    ? messages
    : Object.fromEntries(
        Object.entries(messages).filter(([ns]) => !ADMIN_ONLY_NAMESPACES.includes(ns)),
      );
  return <NextIntlClientProvider messages={scoped}>{children}</NextIntlClientProvider>;
}
