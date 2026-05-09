import { LogsView } from "./logs-view";

export const dynamic = "force-dynamic";

export default function LogsPage() {
  return (
    <main>
      <section className="mx-auto w-full max-w-5xl px-6 pt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          Logs
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl">
          Activité en temps réel.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          Tous les événements end-to-end : appels reçus, tools agent (RDV,
          contacts), récaps WhatsApp, login, modifications de config. Auto-refresh
          toutes les 3 secondes.
        </p>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-8 pb-20">
        <LogsView />
      </section>
    </main>
  );
}
