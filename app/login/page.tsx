import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  const { error, callbackUrl = "/dashboard" } = await props.searchParams;

  async function handleLogin(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/dashboard",
      });
    } catch (e) {
      // AuthError = bad creds. Redirect back to /login with a flag so the
      // form can render an inline error. Anything else (especially the
      // NEXT_REDIRECT thrown on success) must propagate.
      if (e instanceof AuthError) {
        redirect(`/login?error=${e.type}`);
      }
      throw e;
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <form
        action={handleLogin}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 flex flex-col gap-4"
      >
        <h1 className="text-xl font-semibold text-zinc-900">Connexion</h1>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
            Identifiants incorrects.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600">Email</span>
          <input
            name="email"
            type="email"
            required
            autoFocus
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600">Mot de passe</span>
          <input
            name="password"
            type="password"
            required
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>

        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        <button
          type="submit"
          className="rounded-lg bg-blue-600 text-white text-sm font-medium px-4 py-2 hover:bg-blue-700"
        >
          Se connecter
        </button>
      </form>
    </main>
  );
}
