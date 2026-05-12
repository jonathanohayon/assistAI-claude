import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { Logo } from "@/components/ui/Logo";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { CancelButton, RestartLink } from "./cancel-controls";
import { VerifyForm } from "./verify-form";

export default async function VerifyEmailPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ email?: string }>;
}) {
  const { locale } = await props.params;
  const { email: emailParam = "" } = await props.searchParams;

  // Le user vient juste de signup → il est loggué mais emailVerified=false.
  // Si déjà vérifié OU pas loggué, on dégage de cette page.
  const session = await auth();
  let email = emailParam;
  if (session?.user?.id) {
    const [me] = await db
      .select({ email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    if (me?.emailVerified) {
      redirect("/onboarding");
    }
    if (me?.email && !email) email = me.email;
  } else if (!emailParam) {
    redirect(`/${locale}/login`);
  }

  const t = await getTranslations({ locale, namespace: "VerifyEmail" });

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="relative flex flex-col gap-5 rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur">
          <CancelButton />

          <div className="space-y-1 pr-7">
            <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)]">
              {t("title")}
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {t("subtitlePrefix")}{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                {email || t("yourEmail")}
              </span>
              .
            </p>
          </div>
          <VerifyForm email={email} />
          <p className="text-center text-[11px] text-[var(--color-muted-foreground)]">
            {t("codeExpires")}
          </p>
          <RestartLink />
        </div>
      </div>
    </main>
  );
}
