import { AuthError } from "next-auth";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Logo } from "@/components/ui/Logo";
import { Link } from "@/i18n/navigation";

// Page localisée /<fr|he|en>/login — la version racine /login a été
// déplacée ici pour bénéficier du NextIntlClientProvider de [locale]/layout
// et exposer la copy via useTranslations/getTranslations. Une page racine
// /login reste comme back-compat redirect pour les anciens redirects
// server-side (auth middleware, page guards, etc.).
export default async function LoginPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    error?: string;
    callbackUrl?: string;
    reason?: string;
  }>;
}) {
  const { locale } = await props.params;
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error, callbackUrl = "/dashboard", reason } = await props.searchParams;
  const t = await getTranslations({ locale, namespace: "Login" });

  async function handleLogin(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect(`/${locale}/login?error=${e.type}`);
      }
      throw e;
    }
  }

  async function signInWithGoogle() {
    "use server";
    // Pas de cookie plan ici : un nouveau compte cree depuis le login prend le
    // plan par defaut (cf. auth.ts → callbacks.signIn). Un compte existant est
    // simplement relié par email.
    await signIn("google", { redirectTo: "/dashboard" });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 gradient-mesh"
      />

      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link href="/">
            <Logo />
          </Link>
        </div>

        <form
          action={handleLogin}
          className="relative flex flex-col gap-4 rounded-3xl border border-[var(--color-border)] bg-white/85 p-7 shadow-lg backdrop-blur"
        >
          <div className="space-y-1">
            <h1 className="font-display text-2xl tracking-tight text-[var(--color-foreground)]">
              {t("title")}
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {t("subtitle")}
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              {t("errBadCredentials")}
            </p>
          )}
          {reason === "idle" && !error && (
            <p
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              {t("idleNotice")}
            </p>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-[var(--color-foreground)]">{t("emailLabel")}</span>
            <input
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-[var(--color-foreground)]">{t("passwordLabel")}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 focus:border-[var(--color-primary)] focus:outline-none focus:ring-4 focus:ring-[var(--color-primary)]/15"
            />
          </label>

          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <button
            type="submit"
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.01] active:scale-[0.99]"
          >
            {t("submitButton")}
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            {t("noAccount")}{" "}
            <Link
              href="/signup"
              className="text-[var(--color-primary)] hover:underline"
            >
              {t("signupLink")}
            </Link>
          </p>
        </form>

        <div className="my-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--color-border)]" />
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted-foreground)]">
            {t("orDivider")}
          </span>
          <span className="h-px flex-1 bg-[var(--color-border)]" />
        </div>

        <form action={signInWithGoogle}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2.5 rounded-full border border-[var(--color-border)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--color-foreground)] shadow-xs transition-colors hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-muted)]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
              />
            </svg>
            {t("continueWithGoogle")}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--color-muted-foreground)]">
          <Link href="/" className="hover:text-[var(--color-foreground)]">
            {t("backHome")}
          </Link>
        </p>
      </div>
    </main>
  );
}
