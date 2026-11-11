"use client";

import { useTranslations } from "next-intl";

import { showLevel3 } from "@/components/bricks/level3";
import { useDeveloperMode } from "@/components/bricks/use-developer-mode";

import { LogsView } from "./logs-view";

/**
 * The engineering console of the Calls tab (latency chart + raw event
 * timeline). Level-3 content: shown only when showLevel3() says so — admins
 * always, tenants only with developer mode on.
 *
 * Off means nothing in the DOM: LogsView (events poll every 3 s) and the
 * LatencyChart it renders (call-metrics poll every 10 s) are mounted ONLY
 * from inside the gate, so a hidden console never fetches. While the
 * developer-mode flag is still loading, `on` is false, so a tenant's console
 * stays hidden until the flag says otherwise.
 */
export function DeveloperConsole({
  isAdmin,
  asUserId,
}: {
  isAdmin: boolean;
  /** Admin tenant view: scope the console (and the flag) to this tenant. */
  asUserId?: string;
}) {
  const dev = useDeveloperMode(asUserId);
  return <DeveloperConsoleGate isAdmin={isAdmin} developerMode={dev.on} asUserId={asUserId} />;
}

/** The gate itself, without the store (rendered as-is by the tests). */
export function DeveloperConsoleGate({
  isAdmin,
  developerMode,
  asUserId,
}: {
  isAdmin: boolean;
  developerMode: boolean;
  asUserId?: string;
}) {
  const t = useTranslations("DashboardLogs");
  if (!showLevel3({ isAdmin, developerMode })) return null;
  return (
    <section aria-labelledby="developer-console-title" data-developer-console="">
      <div className="pt-14">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">
          {t("header")}
        </p>
        <h2
          id="developer-console-title"
          className="mt-2 font-display text-3xl tracking-tight text-[var(--color-foreground)] sm:text-4xl"
        >
          {t("title")}
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-[var(--color-muted-foreground)]">
          {t("subtitle")}
        </p>
      </div>
      <div className="py-8 pb-20">
        {/* Engine/model per call is admin-only (supplier names never reach
            tenants; the events API strips that data for them too). */}
        <LogsView asUserId={asUserId} showEngine={isAdmin} />
      </div>
    </section>
  );
}
