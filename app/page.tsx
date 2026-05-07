import Link from "next/link";

import { Logo } from "@/components/ui/Logo";
import VoiceAgent from "@/components/VoiceAgent";

const FEATURES = [
  {
    title: "Prise de rendez-vous",
    body: "Vérifie le calendrier, propose les créneaux libres, confirme la réservation — tout vocalement.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="m9 14 2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Bilingue français · hébreu",
    body: "Détecte automatiquement la langue de votre cliente et bascule en cours d'appel sans rupture.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    title: "CRM automatique",
    body: "Chaque appel enregistre la cliente dans votre Google Sheet. Aucune fiche perdue, aucun double appel.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 9h18M9 4v16" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
];

const STATS = [
  { value: "24/7", label: "Disponible" },
  { value: "<300ms", label: "Latence vocale" },
  { value: "2 langues", label: "Français · עברית" },
];

export default function Home() {
  return (
    <main className="relative flex flex-col">
      {/* Background mesh */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] gradient-mesh"
      />

      {/* Nav */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/dashboard"
            className="hidden rounded-full px-4 py-2 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] sm:inline-flex"
          >
            Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-foreground)] px-4 py-2 font-medium text-white shadow-sm transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Se connecter
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-6 pb-20 pt-10 lg:grid-cols-12 lg:gap-12 lg:pt-16">
        <div className="lg:col-span-7">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/70 px-3 py-1 text-xs font-medium text-[var(--color-foreground)] shadow-xs backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            En ligne — répond aux appels en temps réel
          </span>

          <h1 className="mt-5 font-display text-5xl leading-[1.05] tracking-tight text-[var(--color-foreground)] sm:text-6xl lg:text-7xl">
            La réceptionniste qui ne <span className="text-[var(--color-primary)]">manque</span> aucun appel.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--color-muted-foreground)] sm:text-lg">
            Johana répond en français ou en hébreu, propose des créneaux,
            confirme les rendez-vous dans votre Google Calendar et enregistre
            chaque cliente — pendant que vous travaillez.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-3 font-medium text-white shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Accéder au dashboard
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <a
              href="#demo"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/80 px-5 py-3 font-medium text-[var(--color-foreground)] shadow-xs backdrop-blur transition-colors hover:bg-white"
            >
              Essayer la voix
            </a>
          </div>

          <dl className="mt-10 grid grid-cols-3 gap-4 max-w-md">
            {STATS.map((s) => (
              <div key={s.label} className="rounded-xl border border-[var(--color-border)] bg-white/60 p-4 text-center shadow-xs backdrop-blur">
                <dt className="font-display text-2xl text-[var(--color-foreground)]">{s.value}</dt>
                <dd className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Voice demo card */}
        <div id="demo" className="lg:col-span-5">
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-2 rounded-[2.5rem] bg-gradient-to-br from-[#fbcfe8]/60 via-transparent to-[#c4b5fd]/40 blur-2xl"
            />
            <div className="relative rounded-3xl border border-[var(--color-border)] bg-white/80 p-6 shadow-lg backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="font-display text-lg text-[var(--color-foreground)]">
                    Démo en direct
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Parlez à Johana depuis votre navigateur
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-muted)] px-2.5 py-1 text-[11px] text-[var(--color-foreground)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
                  WebRTC
                </span>
              </div>
              <VoiceAgent />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-[var(--color-border)]/60 bg-white/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
              Pourquoi Prestige
            </p>
            <h2 className="mt-3 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
              Une secrétaire qui ne dort pas, ne s&apos;énerve pas, ne se trompe pas.
            </h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#fce7f3] to-[#ede9fe] text-[var(--color-primary)] transition-colors group-hover:from-[#fbcfe8] group-hover:to-[#ddd6fe]">
                  {f.icon}
                </div>
                <h3 className="mt-4 font-display text-lg text-[var(--color-foreground)]">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-foreground)] to-[#5b1233] p-8 sm:p-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#f9a8d4]/40 to-[#c4b5fd]/30 blur-3xl"
          />
          <div className="relative max-w-2xl">
            <h2 className="font-display text-3xl tracking-tight text-white sm:text-4xl">
              Personnalisez la voix de votre salon en deux clics.
            </h2>
            <p className="mt-4 text-base text-pink-100/80">
              Centres, horaires, durée des prestations, ton de la secrétaire —
              tout se règle depuis un dashboard simple. Vos changements s&apos;appliquent au prochain appel.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium text-[var(--color-foreground)] shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Configurer mon agent
              </Link>
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-3 font-medium text-white backdrop-blur transition-colors hover:bg-white/10"
              >
                Tester d&apos;abord
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto w-full max-w-6xl border-t border-[var(--color-border)]/60 px-6 py-8 text-xs text-[var(--color-muted-foreground)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Logo />
          <p>© {new Date().getFullYear()} Prestige · Réceptionniste vocale IA</p>
        </div>
      </footer>
    </main>
  );
}
