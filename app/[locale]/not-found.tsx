import Link from "next/link";

// 404 inside the localized root layout (/fr/does-not-exist, notFound() in a
// localized page). Plain trilingual text so it needs no translation lookup.
export default function LocaleNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">404</h1>
      <p>Page introuvable · Page not found · הדף לא נמצא</p>
      <Link href="/" className="underline">
        Tamara
      </Link>
    </main>
  );
}
