import Link from "next/link";

import { Logo } from "@/components/ui/Logo";

const LINKS = {
  Produit: [
    { label: "Démo", href: "#demo" },
    { label: "Fonctionnalités", href: "#features" },
    { label: "Comment ça marche", href: "#how" },
  ],
  Compte: [
    { label: "Connexion", href: "/login" },
    { label: "Dashboard", href: "/dashboard" },
  ],
  Métiers: [
    { label: "Cabinets médicaux", href: "#industries" },
    { label: "Salons de beauté", href: "#industries" },
    { label: "Coiffeurs", href: "#industries" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)]/60 bg-white/40">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-[var(--color-muted-foreground)]">
              Conciergerie vocale temps réel pour cabinets médicaux, salons et
              coiffeurs. Hébreu et français natifs.
            </p>
          </div>
          {Object.entries(LINKS).map(([cat, links]) => (
            <div key={cat}>
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
                {cat}
              </p>
              <ul className="mt-4 space-y-2.5">
                {links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)]/60 pt-6 text-xs text-[var(--color-muted-foreground)]">
          <p>© {new Date().getFullYear()} Prestige · Conciergerie vocale IA</p>
          <p>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
              Tous les services en ligne
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
}
