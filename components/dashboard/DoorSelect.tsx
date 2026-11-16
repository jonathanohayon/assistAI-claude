"use client";

/**
 * "My main use": the account's door, changed by the customer (account
 * settings) or by an admin for a tenant (admin tenant view, `asUserId`).
 * It only reorders the dashboard: same settings, same rights. A native
 * select, so it is keyboard and screen-reader friendly as is.
 */

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { DOORS, type Door } from "@/lib/door-values";
import { doorOf, doorPutRequest, TILE_ORDER_KEY } from "@/lib/doors-ui";

const OPTION_KEY: Record<Door, "doorOptionReception" | "doorOptionSales" | "doorOptionConnect"> = {
  reception: "doorOptionReception",
  sales: "doorOptionSales",
  connect: "doorOptionConnect",
};

export function DoorSelect({
  initialDoor,
  asUserId,
  compact = false,
}: {
  initialDoor: Door;
  /** Admin acting for a tenant: the PUT goes to that account. */
  asUserId?: string | null;
  /** One line, no hint (the admin banner). */
  compact?: boolean;
}) {
  const t = useTranslations("DashboardSettings");
  const router = useRouter();
  const id = useId();
  const [door, setDoor] = useState<Door>(initialDoor);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [, startTransition] = useTransition();

  const choose = async (next: Door) => {
    const previous = door;
    setDoor(next);
    setSaving(true);
    setError(false);
    try {
      const { url, init } = doorPutRequest(next, asUserId);
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json().catch(() => null)) as { door?: unknown } | null;
      setDoor(doorOf(body?.door ?? next));
      // A new door shows its own tile order: forget the order dragged here.
      try {
        localStorage.removeItem(TILE_ORDER_KEY);
      } catch {
        /* storage unavailable: nothing saved to forget */
      }
      startTransition(() => router.refresh());
    } catch {
      setDoor(previous);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : ""}>
      <label
        htmlFor={id}
        className={compact ? "text-xs font-medium" : "block text-sm font-semibold text-[var(--color-foreground)]"}
      >
        {t("doorLabel")}
      </label>
      {!compact && (
        <p id={`${id}-hint`} className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          {t("doorHint")}
        </p>
      )}
      <select
        id={id}
        value={door}
        disabled={saving}
        aria-busy={saving}
        aria-describedby={[compact ? null : `${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined}
        aria-invalid={error || undefined}
        onChange={(e) => void choose(doorOf(e.target.value))}
        className={
          compact
            ? "min-h-9 rounded-full border border-[#d97706]/40 bg-white px-3 text-xs text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] disabled:cursor-wait disabled:opacity-60"
            : "mt-3 block min-h-11 w-full rounded-xl border border-[#cbd5e1] bg-white px-3 text-sm text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] disabled:cursor-wait disabled:opacity-60 sm:w-auto sm:min-w-72"
        }
      >
        {DOORS.map((d) => (
          <option key={d} value={d}>
            {t(OPTION_KEY[d])}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-xs font-semibold text-[#b91c1c]">
          {t("doorSaveError")}
        </p>
      )}
    </div>
  );
}
