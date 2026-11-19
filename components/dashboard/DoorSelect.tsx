"use client";

/**
 * "My main use": the account's door, changed by the customer (account
 * settings) or by an admin for a tenant (admin tenant view, `asUserId`).
 * It only reorders the dashboard: same settings, same rights. Settings use
 * the bricks' choice chips (a radio group); the admin banner a native select.
 */

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { DOORS, type Door } from "@/lib/door-values";
import { ChipGroup } from "@/components/bricks/controls";
import { doorChangeNeeded, doorOf, doorPutRequest, TILE_ORDER_KEY } from "@/lib/doors-ui";

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
    // The same door: no PUT, the saved tile order is kept.
    if (!doorChangeNeeded(door, next)) return;
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

  const errorLine = error && (
    <p id={`${id}-error`} role="alert" className="mt-2 text-xs font-semibold text-[#b91c1c]">
      {t("doorSaveError")}
    </p>
  );

  // Admin banner: a compact native select.
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-xs font-medium">
          {t("doorLabel")}
        </label>
        <select
          id={id}
          value={door}
          disabled={saving}
          aria-busy={saving}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error || undefined}
          onChange={(e) => void choose(doorOf(e.target.value))}
          title={t("doorResetNote")}
          className="min-h-9 rounded-full border border-[#d97706]/40 bg-white px-3 text-xs text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0e7490] disabled:cursor-wait disabled:opacity-60"
        >
          {DOORS.map((d) => (
            <option key={d} value={d}>
              {t(OPTION_KEY[d])}
            </option>
          ))}
        </select>
        {errorLine}
      </div>
    );
  }

  // Account settings: the bricks' own choice chips (a radio group: arrows,
  // roving focus, cyan focus ring, RTL-aware; selected = brand magenta).
  return (
    <div aria-busy={saving} className={saving ? "cursor-wait opacity-80" : undefined}>
      <ChipGroup
        label={t("doorLabel")}
        options={DOORS.map((d) => ({ id: d, label: t(OPTION_KEY[d]) }))}
        selected={door}
        onPick={(d) => {
          if (!saving) void choose(doorOf(d));
        }}
      />
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted-foreground)]">{t("doorHint")}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-muted-foreground)]">{t("doorResetNote")}</p>
      {errorLine}
    </div>
  );
}
