import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { Logo } from "@/components/ui/Logo";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

import { CancelButton, RestartLink } from "./cancel-controls";
import { VerifyForm } from "./verify-form";

export default async function VerifyEmailPage(props: {
  searchParams: Promise<{ email?: string }>;
}) {
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
    // Prefill l'email depuis la session si pas dans le query string
    if (me?.email && !email) email = me.email;
  } else if (!emailParam) {
    // Pas loggué et pas d'email dans l'URL → rien à valider, retour login.
    redirect("/login");
  }

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
          {/* Bouton fermer (×) en haut à droite : signOut + retour /. Le
              compte reste en DB (le user pourra reprendre la verif au
              prochain login). */}
          <CancelButton />

          <div className="space-y-1 pr-7">
            <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)]">
              Vérifiez votre email
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Entrez le code à 4 chiffres envoyé à{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                {email || "votre email"}
              </span>
              .
            </p>
          </div>
          <VerifyForm email={email} />
          <p className="text-center text-[11px] text-[var(--color-muted-foreground)]">
            Le code expire dans 15 minutes.
          </p>
          {/* Recommencer à zéro : delete le compte unverified + redirige
              /signup. Permet de changer d'email ou repartir clean. */}
          <RestartLink />
        </div>
      </div>
    </main>
  );
}
