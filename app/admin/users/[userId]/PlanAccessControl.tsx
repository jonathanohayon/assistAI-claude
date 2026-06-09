"use client";

import { useState } from "react";

import { PLANS } from "@/lib/plans";

/**
 * Contrôle admin : assigne un plan au tenant + accorde/révoque un accès
 * illimité GRATUIT (compte 'active' sans expiration ni facturation).
 */
export function PlanAccessControl({
  userId,
  initialPlan,
  initialUnlimited,
}: {
  userId: string;
  initialPlan: string;
  initialUnlimited: boolean;
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [unlimited, setUnlimited] = useState(initialUnlimited);
  const [busy, setBusy] = useState(false);

  const patch = async (body: { plan?: string; freeUnlimited?: boolean }) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } finally {
      setBusy(false);
    }
  };

  const onPlan = async (next: string) => {
    const prev = plan;
    setPlan(next);
    if (!(await patch({ plan: next }))) setPlan(prev);
  };

  const onToggleUnlimited = async () => {
    const next = !unlimited;
    if (await patch({ freeUnlimited: next })) setUnlimited(next);
  };

  return (
    <div className="flex items-center gap-2">
      <select
        value={plan}
        onChange={(e) => onPlan(e.target.value)}
        disabled={busy}
        title="Plan du tenant"
        className="rounded-full border border-[var(--color-border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--color-foreground)] disabled:opacity-50"
      >
        {PLANS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onToggleUnlimited}
        disabled={busy}
        title="Accès illimité gratuit (sans expiration ni facturation)"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-50 ${
          unlimited
            ? "border-emerald-600 bg-emerald-600 text-white hover:opacity-90"
            : "border-[var(--color-border)] bg-white text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
        }`}
      >
        <span>{unlimited ? "∞✓" : "∞"}</span>
        {unlimited ? "Illimité gratuit" : "Accès illimité gratuit"}
      </button>
    </div>
  );
}
