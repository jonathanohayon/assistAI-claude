import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { agentConfigs, phoneNumbers } from "@/lib/db/schema";

import { ForwardingWizard } from "./forwarding-wizard";

export const dynamic = "force-dynamic";

/** Call-forwarding wizard: forward the salon's usual number to Tamara, then test it. */
export default async function ForwardingPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/${locale}/login`);

  const [[number], [config]] = await Promise.all([
    db
      .select({ phoneNumber: phoneNumbers.phoneNumber })
      .from(phoneNumbers)
      .where(eq(phoneNumbers.userId, session.user.id))
      .limit(1),
    db
      .select({ ownerWhatsapp: agentConfigs.ownerWhatsapp })
      .from(agentConfigs)
      .where(eq(agentConfigs.userId, session.user.id))
      .limit(1),
  ]);

  const t = await getTranslations({ locale, namespace: "DashboardForwarding" });

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
      <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)]">{t("title")}</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("subtitle")}</p>
      <div className="mt-6">
        <ForwardingWizard
          tenantNumber={number?.phoneNumber ?? null}
          defaultOwnerPhone={config?.ownerWhatsapp ?? ""}
        />
      </div>
    </main>
  );
}
