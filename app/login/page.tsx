import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/ui/Logo";
import { auth, signIn } from "@/auth";

export default async function LoginPage(props: {
  searchParams: Promise<{
    error?: string;
    callbackUrl?: string;
    reason?: string;
  }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error, callbackUrl = "/dashboard", reason } = await props.searchParams;

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
        redirect(`/login?error=${e.type}`);
      }
      throw e;
    }
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
              Connexion
            </h1>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Accède à la configuration de ta secrétaire vocale.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              Identifiants incorrects.
            </p>
          )}
          {reason === "idle" && !error && (
            <p
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              ⏰ Vous avez été déconnecté après 1 heure d&apos;inactivité.
              Reconnectez-vous pour reprendre.
            </p>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-[var(--color-foreground)]">Email</span>
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
            <span className="font-medium text-[var(--color-foreground)]">Mot de passe</span>
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
            Se connecter
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <p className="text-center text-xs text-[var(--color-muted-foreground)]">
            Pas encore de compte ?{" "}
            <Link
              href="/signup"
              className="text-[var(--color-primary)] hover:underline"
            >
              Créer un compte
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--color-muted-foreground)]">
          <Link href="/" className="hover:text-[var(--color-foreground)]">
            ← Retour
          </Link>
        </p>
      </div>
    </main>
  );
}
